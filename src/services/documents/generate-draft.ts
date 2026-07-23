/**
 * document.generate_draftの中核処理：subjectType（dispatch_assignment／job_order_referral）に応じた
 * subject行のconditionsTypedからテンプレートを差し込み、GCS/MinIOへcontent-addressableに保存し、
 * documentsをdraftとして作成する（§7・§6ステップ⑤）。
 * docTypeはdoc-type-registry.tsで解決するため、新しいdocTypeの追加はレジストリへの1件追記のみで済む
 *
 * Core logic for document.generate_draft: renders the template from the subject row's conditionsTyped
 * (subject row resolved per subjectType — dispatch_assignment or job_order_referral), stores it
 * content-addressably, and creates a documents row as draft (§7, §6 step 5). docType is resolved via
 * doc-type-registry.ts, so adding a new docType requires only one new registry entry
 *
 * Logika inti document.generate_draft: merender template dari conditionsTyped baris subjek (baris
 * subjek diresolusikan per subjectType — dispatch_assignment atau job_order_referral), menyimpannya
 * secara content-addressable, dan membuat baris documents sebagai draft (§7, langkah 5 §6). docType
 * diresolusikan via doc-type-registry.ts, sehingga menambah docType baru hanya memerlukan satu entri
 * registry baru
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { documents } from "../../db/schema/documents.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { renderTemplate } from "./render-template.js";
import { getDocTypeDefinition } from "./doc-type-registry.js";
import { buildSubjectRenderValues } from "./subject-values.js";
import { loadSubjectRow } from "../rules/subject-lookup.js";
import { putImmutableObject } from "../../lib/storage.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { UserInputError } from "../../lib/errors.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

const RULE_SET_VERSION = "v1";

export interface GenerateDraftInput {
  tenantId: string;
  docType: string;
  // 判定対象のID（dispatch_assignment.id または job_order_referral.id、docTypeのsubjectTypeで決まる）
  // Target subject id (dispatch_assignment.id or job_order_referral.id, decided by the docType's subjectType)
  // ID subjek target (dispatch_assignment.id atau job_order_referral.id, ditentukan oleh subjectType docType)
  subjectId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  // 同一操作の再実行でdraftが重複作成されないようにするための冪等キー / Idempotency key preventing duplicate drafts on retry / Kunci idempotensi agar draft tidak duplikat saat retry
  idempotencyKey: string;
  reason: string;
}

export interface GenerateDraftResult {
  documentId: string;
  logicalDocumentId: string;
  version: number;
  generatedSha256: string;
  generatedObjectUri: string;
}

export async function generateDocumentDraft(db: Db, input: GenerateDraftInput): Promise<GenerateDraftResult> {
  const docTypeDefinition = getDocTypeDefinition(input.docType);
  if (!docTypeDefinition) {
    throw new UserInputError(
      `未対応のdocTypeです / Unsupported docType: ${input.docType}`,
      `対応済みのdocType一覧はdocs/document-catalog.mdを参照してください / See docs/document-catalog.md for supported docTypes`,
    );
  }

  // 冪等キーが既に処理済みなら、レンダリング・アップロードを行わず既存documentをそのまま返す
  // If the idempotency key was already processed, skip rendering/upload and return the existing document
  // Jika kunci idempotensi sudah diproses, lewati rendering/upload dan kembalikan document yang sudah ada
  const [existingOutboxEntry] = await db
    .select()
    .from(transactionalOutbox)
    .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingOutboxEntry?.externalReference) {
    const [existingDocument] = await db.select().from(documents).where(eq(documents.id, existingOutboxEntry.externalReference));
    if (existingDocument?.generatedObjectUri && existingDocument.generatedSha256) {
      return {
        documentId: existingDocument.id,
        logicalDocumentId: existingDocument.logicalDocumentId,
        version: existingDocument.version,
        generatedSha256: existingDocument.generatedSha256,
        generatedObjectUri: existingDocument.generatedObjectUri,
      };
    }
  }

  const subjectRow = await loadSubjectRow(db, docTypeDefinition.subjectType, input.subjectId);
  if (!subjectRow) {
    throw new UserInputError(
      `${docTypeDefinition.subjectType} ${input.subjectId} が見つかりません / ${docTypeDefinition.subjectType} ${input.subjectId} not found`,
      "subjectIdを確認してください / Please verify subjectId",
    );
  }

  const values = buildSubjectRenderValues(docTypeDefinition, subjectRow);

  const bytes = renderTemplate(docTypeDefinition.templateFileName, values);
  const { objectUri, sha256 } = await putImmutableObject(docTypeDefinition.storagePrefix, bytes, "text/plain; charset=utf-8");

  const documentId = randomUUID();
  const logicalDocumentId = randomUUID();
  const inputSnapshotHash = sha256Hex(canonicalJsonString(values));

  await db.transaction(async (tx) => {
    await tx.insert(documents).values({
      id: documentId,
      tenantId: input.tenantId,
      logicalDocumentId,
      version: 1,
      docType: docTypeDefinition.docType,
      subjectType: docTypeDefinition.subjectType,
      subjectId: input.subjectId,
      templateVersion: docTypeDefinition.templateFileName.replace(/\.txt$/, ""),
      ruleSetVersion: RULE_SET_VERSION,
      inputSnapshotHash,
      generatedObjectUri: objectUri,
      generatedSha256: sha256,
      contentStatus: "draft",
    });

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: documentId,
      aggregateVersion: 1,
      eventType: "document.draft_generated",
      afterHash: sha256,
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: documentId,
      eventType: "document.draft_generated",
      payload: { documentId, docType: docTypeDefinition.docType, subjectId: input.subjectId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: documentId,
    });
  });

  return { documentId, logicalDocumentId, version: 1, generatedSha256: sha256, generatedObjectUri: objectUri };
}

/**
 * 後方互換ラッパー（M1スコープ）。新規呼び出しはgenerateDocumentDraftへdocTypeを明示して渡すこと
 * Backward-compatible wrapper (M1 scope). New call sites should call generateDocumentDraft with an explicit docType
 * Wrapper yang kompatibel ke belakang (lingkup M1). Pemanggilan baru harus memanggil generateDocumentDraft dengan docType eksplisit
 */
export async function generateLaborConditionsNoticeDraft(
  db: Db,
  input: Omit<GenerateDraftInput, "docType">,
): Promise<GenerateDraftResult> {
  return generateDocumentDraft(db, { ...input, docType: "labor_conditions_notice" });
}
