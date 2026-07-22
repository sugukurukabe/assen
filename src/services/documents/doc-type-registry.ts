/**
 * docType→{zodスキーマ, テンプレートファイル, mappingファイル, subjectType}の対応集約。
 * document.generate_draft・document.preview・compliance.evaluateが共通で参照し、新しいdocTypeを
 * 追加する際はここへ1件追記するだけでよい（doc-catalog.mdのカタログとlegal/{templates,mapping}実体を紐づける層）
 *
 * Centralizes docType -> {zod schema, template file, mapping file, subjectType}. Shared by
 * document.generate_draft, document.preview, and compliance.evaluate; adding a new docType requires
 * only one new entry here (the layer that binds docs/document-catalog.md to the legal/{templates,mapping} assets)
 *
 * Memusatkan docType -> {skema zod, file template, file mapping, subjectType}. Dipakai bersama oleh
 * document.generate_draft, document.preview, dan compliance.evaluate; menambah docType baru hanya
 * memerlukan satu entri baru di sini (lapisan yang menghubungkan docs/document-catalog.md dengan aset legal/{templates,mapping})
 */
import type { ZodType } from "zod";
import { laborConditionsNoticeSchema } from "../../domain/labor-conditions-notice.js";
import { dispatchIndividualContractSchema } from "../../domain/dispatch-individual-contract.js";
import { workingConditionsNoticeSchema } from "../../domain/working-conditions-notice.js";
import { dispatchWorkerNoticeSchema } from "../../domain/dispatch-worker-notice.js";

export interface DocTypeDefinition {
  docType: string;
  docTypeLabel: string;
  subjectType: "dispatch_assignment";
  templateFileName: string;
  mappingFileName: string;
  // 保存先ディレクトリ（putImmutableObjectのprefixに使う） / Storage prefix passed to putImmutableObject / Prefix penyimpanan yang diteruskan ke putImmutableObject
  storagePrefix: string;
  schema: ZodType;
}

export const DOC_TYPE_REGISTRY: Record<string, DocTypeDefinition> = {
  labor_conditions_notice: {
    docType: "labor_conditions_notice",
    docTypeLabel: "労働条件通知書（派遣） / Written notice of working conditions (dispatch) / Pemberitahuan tertulis kondisi kerja (dispatch)",
    subjectType: "dispatch_assignment",
    templateFileName: "labor-conditions-notice.v1.txt",
    mappingFileName: "labor-conditions-notice.json",
    storagePrefix: "documents/labor-conditions-notice",
    schema: laborConditionsNoticeSchema,
  },
  dispatch_individual_contract: {
    docType: "dispatch_individual_contract",
    docTypeLabel: "労働者派遣個別契約書（A2） / Worker dispatch individual contract (A2) / Kontrak dispatch tenaga kerja individual (A2)",
    subjectType: "dispatch_assignment",
    templateFileName: "dispatch-individual-contract.v1.txt",
    mappingFileName: "dispatch-individual-contract.json",
    storagePrefix: "documents/dispatch-individual-contract",
    schema: dispatchIndividualContractSchema,
  },
  dispatch_working_conditions_notice: {
    docType: "dispatch_working_conditions_notice",
    docTypeLabel: "就業条件明示書（A3） / Working-conditions notice (A3) / Pemberitahuan ketentuan kerja (A3)",
    subjectType: "dispatch_assignment",
    templateFileName: "working-conditions-notice.v1.txt",
    mappingFileName: "working-conditions-notice.json",
    storagePrefix: "documents/working-conditions-notice",
    schema: workingConditionsNoticeSchema,
  },
  dispatch_worker_notice: {
    docType: "dispatch_worker_notice",
    docTypeLabel: "派遣先通知（派遣労働者通知書、A10） / Notification of dispatched worker (A10) / Pemberitahuan pekerja dispatch (A10)",
    subjectType: "dispatch_assignment",
    templateFileName: "dispatch-worker-notice.v1.txt",
    mappingFileName: "dispatch-worker-notice.json",
    storagePrefix: "documents/dispatch-worker-notice",
    schema: dispatchWorkerNoticeSchema,
  },
};

export const SUPPORTED_DOC_TYPES = Object.keys(DOC_TYPE_REGISTRY) as [string, ...string[]];

export function getDocTypeDefinition(docType: string): DocTypeDefinition | undefined {
  return DOC_TYPE_REGISTRY[docType];
}
