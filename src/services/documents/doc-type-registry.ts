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
import { t2pJobOrderNoticeSchema } from "../../domain/t2p-job-order-notice.js";
import { t2pConsentFormSchema } from "../../domain/t2p-consent-form.js";
import { t2pIndividualContractSchema } from "../../domain/t2p-individual-contract.js";
import { t2pConversionMemoSchema } from "../../domain/t2p-conversion-memo.js";
import { t2pNonHireReasonRequestSchema } from "../../domain/t2p-non-hire-reason-request.js";
import { t2pNonHireReasonNoticeSchema } from "../../domain/t2p-non-hire-reason-notice.js";

export interface DocTypeDefinition {
  docType: string;
  docTypeLabel: string;
  // dispatch_assignment: dispatchAssignments.conditionsTypedから差し込む（A2/A3/A10/M1/⑥） / Renders from dispatchAssignments.conditionsTyped (A2/A3/A10/M1/⑥) / Merender dari dispatchAssignments.conditionsTyped (A2/A3/A10/M1/⑥)
  // job_order_referral: jobOrderReferrals.conditionsTyped（+一部typed column）から差し込む（④⑤⑦⑧⑨） / Renders from jobOrderReferrals.conditionsTyped (+ some typed columns) (④⑤⑦⑧⑨) / Merender dari jobOrderReferrals.conditionsTyped (+ beberapa kolom bertipe) (④⑤⑦⑧⑨)
  subjectType: "dispatch_assignment" | "job_order_referral";
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
  t2p_job_order_notice: {
    docType: "t2p_job_order_notice",
    docTypeLabel: "求人条件明示書（④） / Job-order conditions notice (④) / Pemberitahuan ketentuan lowongan (④)",
    subjectType: "job_order_referral",
    templateFileName: "t2p-job-order-notice.v1.txt",
    mappingFileName: "t2p-job-order-notice.json",
    storagePrefix: "documents/t2p-job-order-notice",
    schema: t2pJobOrderNoticeSchema,
  },
  t2p_consent_form: {
    docType: "t2p_consent_form",
    docTypeLabel: "紹介予定派遣に関する説明書 兼 本人同意書（⑤） / T2P explanation & consent form (⑤) / Formulir penjelasan & persetujuan T2P (⑤)",
    subjectType: "job_order_referral",
    templateFileName: "t2p-consent-form.v1.txt",
    mappingFileName: "t2p-consent-form.json",
    storagePrefix: "documents/t2p-consent-form",
    schema: t2pConsentFormSchema,
  },
  t2p_individual_contract: {
    docType: "t2p_individual_contract",
    docTypeLabel: "労働者派遣個別契約書（紹介予定派遣・⑥） / T2P worker dispatch individual contract (⑥) / Kontrak dispatch tenaga kerja individual T2P (⑥)",
    // ⑥はA2と同じdispatch_assignments.conditionsTypedを再利用する（t2pFlag=true時のみ） / ⑥ reuses the same dispatch_assignments.conditionsTyped as A2 (only when t2pFlag=true) / ⑥ menggunakan ulang dispatch_assignments.conditionsTyped yang sama seperti A2 (hanya saat t2pFlag=true)
    subjectType: "dispatch_assignment",
    templateFileName: "t2p-individual-contract.v1.txt",
    mappingFileName: "t2p-individual-contract.json",
    storagePrefix: "documents/t2p-individual-contract",
    schema: t2pIndividualContractSchema,
  },
  t2p_conversion_memo: {
    docType: "t2p_conversion_memo",
    docTypeLabel: "転換条件覚書（⑦） / Conversion terms memo (⑦) / Memo ketentuan konversi (⑦)",
    subjectType: "job_order_referral",
    templateFileName: "t2p-conversion-memo.v1.txt",
    mappingFileName: "t2p-conversion-memo.json",
    storagePrefix: "documents/t2p-conversion-memo",
    schema: t2pConversionMemoSchema,
  },
  t2p_non_hire_reason_request: {
    docType: "t2p_non_hire_reason_request",
    docTypeLabel: "不採用理由明示請求書（⑧） / Request for reason of non-hire (⑧) / Permintaan alasan tidak diterima (⑧)",
    subjectType: "job_order_referral",
    templateFileName: "t2p-non-hire-reason-request.v1.txt",
    mappingFileName: "t2p-non-hire-reason-request.json",
    storagePrefix: "documents/t2p-non-hire-reason-request",
    schema: t2pNonHireReasonRequestSchema,
  },
  t2p_non_hire_reason_notice: {
    docType: "t2p_non_hire_reason_notice",
    docTypeLabel: "不採用理由通知書（⑨） / Written notice of non-hire reason (⑨) / Pemberitahuan tertulis alasan tidak diterima (⑨)",
    subjectType: "job_order_referral",
    templateFileName: "t2p-non-hire-reason-notice.v1.txt",
    mappingFileName: "t2p-non-hire-reason-notice.json",
    storagePrefix: "documents/t2p-non-hire-reason-notice",
    schema: t2pNonHireReasonNoticeSchema,
  },
};

export const SUPPORTED_DOC_TYPES = Object.keys(DOC_TYPE_REGISTRY) as [string, ...string[]];

export function getDocTypeDefinition(docType: string): DocTypeDefinition | undefined {
  return DOC_TYPE_REGISTRY[docType];
}
