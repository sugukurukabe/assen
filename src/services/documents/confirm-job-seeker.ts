/**
 * job_seeker.confirmの中核処理：検証済み事実からjob_seekers確定＋帳簿②posting（§7・§4.2、confirm-job-order.tsと同型パターン）。
 * 氏名・住所・生年月日はpii-crypto.tsでアプリ層暗号化してから保存する（team rule §2「個人情報をハードコードしない」の
 * DB永続化版。復号は必要になった時点のみ行う想定）
 *
 * Core logic for job_seeker.confirm: finalizes job_seekers from verified facts and posts Ledger #2
 * (§7, §4.2; mirrors confirm-job-order.ts). Name/address/birth date are application-layer encrypted via
 * pii-crypto.ts before persisting (the DB-persistence counterpart of never hardcoding personal data;
 * decryption happens only when actually needed)
 *
 * Logika inti job_seeker.confirm: finalisasi job_seekers dari fakta terverifikasi dan posting Buku Besar
 * #2 (§7, §4.2; mencerminkan confirm-job-order.ts). Nama/alamat/tanggal lahir dienkripsi di lapisan
 * aplikasi via pii-crypto.ts sebelum disimpan (versi persistensi DB dari larangan hardcode data pribadi;
 * dekripsi hanya terjadi saat benar-benar diperlukan)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobSeekers } from "../../db/schema/ledgers.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { createPartySnapshot } from "./party-snapshot.js";
import { encryptPii } from "../../lib/pii-crypto.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface JobSeekerPiiInput {
  staffId?: string;
  name: string;
  address: string;
  birthDate: string;
  nationality?: string;
}

export interface PiiConsentInput {
  consentDate: string;
  scope: string;
  recipients: string;
}

export interface ConfirmJobSeekerFields {
  desiredOccupation: string;
  acceptedAt: string;
  validUntil: string;
}

export interface ConfirmJobSeekerInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  seeker: JobSeekerPiiInput;
  piiConsent: PiiConsentInput;
  fields: ConfirmJobSeekerFields;
}

export interface ConfirmJobSeekerResult {
  jobSeekerId: string;
  alreadyProcessed: boolean;
}

export async function confirmJobSeeker(db: Db, input: ConfirmJobSeekerInput): Promise<ConfirmJobSeekerResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing?.externalReference) {
      return { jobSeekerId: existing.externalReference, alreadyProcessed: true };
    }

    const seekerRefId = input.seeker.staffId ?? randomUUID();

    // partyRefIdはPIIを含まないID（暗号化前の氏名・住所は含めない） / partyRefId excludes PII (never includes plaintext name/address) / partyRefId tidak menyertakan PII (tidak pernah menyertakan nama/alamat teks polos)
    const { id: seekerSnapshotId } = await createPartySnapshot(tx, {
      tenantId: input.tenantId,
      partyType: "worker",
      partyRefId: seekerRefId,
      snapshot: { staffId: seekerRefId, nationality: input.seeker.nationality },
      takenReason: "job_seeker_accept",
    });

    const jobSeekerId = randomUUID();
    await tx.insert(jobSeekers).values({
      id: jobSeekerId,
      tenantId: input.tenantId,
      staffId: input.seeker.staffId,
      seekerSnapshotId,
      nameEnc: encryptPii(input.seeker.name),
      addressEnc: encryptPii(input.seeker.address),
      birthDateEnc: encryptPii(input.seeker.birthDate),
      desiredOccupation: input.fields.desiredOccupation,
      acceptedAt: input.fields.acceptedAt,
      validUntil: input.fields.validUntil,
      piiConsent: { ...input.piiConsent },
      status: "active",
    });

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_seeker",
      aggregateId: jobSeekerId,
      aggregateVersion: 1,
      eventType: "job_seeker.confirmed",
      // PII平文はaudit_eventsに残さない（暗号化列とconsentのみをハッシュ対象にする） / Never leak plaintext PII into audit_events (hash only the encrypted columns and consent) / Tidak pernah membocorkan PII teks polos ke audit_events (hash hanya kolom terenkripsi dan consent)
      afterHash: sha256Hex(canonicalJsonString({ jobSeekerId, fields: input.fields, piiConsent: input.piiConsent })),
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_seeker",
      aggregateId: jobSeekerId,
      eventType: "job_seeker.confirmed",
      payload: { jobSeekerId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: jobSeekerId,
    });

    return { jobSeekerId, alreadyProcessed: false };
  });
}
