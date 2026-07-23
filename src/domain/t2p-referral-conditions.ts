/**
 * job_order_referrals.conditionsTypedに格納するT2P（紹介予定派遣）関連書類の統合フィールド定義。
 * ④求人条件明示書・⑤本人同意書・⑦転換条件覚書・⑧不採用理由の明示請求・⑨不採用理由の書面明示は
 * いずれも同一の紹介行（job_order_referrals）を異なるフェーズ・読み手向けに描写するため、同一のJSONBを
 * 共有する。F2（job_order_referral.confirm）で④⑤分を入力し、F6（placement.confirm／
 * placement.record_rejection_reason）で⑦または⑧⑨分を追記（マージ）する。⑥T2P個別契約書は
 * dispatch_assignments.conditionsTyped（dispatch-conditions.ts）を再利用するため、本ファイルの対象外。
 *
 * Unified field catalog stored in job_order_referrals.conditionsTyped. Documents ④ (job-order notice),
 * ⑤ (consent form), ⑦ (conversion memo), ⑧ (request for non-hire reason), ⑨ (written notice of non-hire
 * reason) all describe the same referral row for different phases/audiences, so they share one JSONB blob.
 * ④⑤ fields are populated at F2 (job_order_referral.confirm); ⑦ or ⑧⑨ fields are appended (merged) at F6
 * (placement.confirm / placement.record_rejection_reason). Document ⑥ (T2P individual contract) reuses
 * dispatch_assignments.conditionsTyped (dispatch-conditions.ts) instead and is out of scope here.
 *
 * Katalog field terpadu yang disimpan di job_order_referrals.conditionsTyped. Dokumen ④ (pemberitahuan
 * lowongan), ⑤ (formulir persetujuan), ⑦ (memo konversi), ⑧ (permintaan alasan tidak diterima), ⑨
 * (pemberitahuan tertulis alasan tidak diterima) semuanya mendeskripsikan baris rujukan yang sama untuk
 * fase/audiens berbeda, sehingga berbagi satu blob JSONB. Field ④⑤ diisi saat F2 (job_order_referral.confirm);
 * field ⑦ atau ⑧⑨ ditambahkan (digabung) saat F6 (placement.confirm / placement.record_rejection_reason).
 * Dokumen ⑥ (kontrak individual T2P) memakai dispatch_assignments.conditionsTyped (dispatch-conditions.ts)
 * dan di luar cakupan file ini.
 */
import { z } from "zod";

export const t2pReferralConditionsInputSchema = z.object({
  // --- 共通（④⑤⑦⑧⑨で共有） / Shared across ④⑤⑦⑧⑨ / Bersama di ④⑤⑦⑧⑨ ---
  staffName: z.string().min(1).optional().describe("派遣労働者・求職者の氏名 / Staff/job-seeker name / Nama staf/pencari kerja"),
  clientName: z.string().min(1).optional().describe("派遣先・求人者の名称 / Client company name / Nama perusahaan klien"),
  clientAddress: z.string().min(1).optional().describe("派遣先・求人者の所在地 / Client company address / Alamat perusahaan klien"),
  clientContact: z.string().optional().describe("派遣先・求人者の連絡先 / Client company contact / Kontak perusahaan klien"),
  clientResponsiblePersonName: z.string().optional().describe("派遣先責任者の氏名 / Client-side responsible person name / Nama penanggung jawab pihak klien"),
  dispatchPeriodStart: z.string().min(1).optional().describe("派遣期間の開始日（通算6ヶ月以内） / Dispatch period start (max 6 months total) / Tanggal mulai periode dispatch (maks 6 bulan)"),
  dispatchPeriodEnd: z.string().min(1).optional().describe("派遣期間の終了日 / Dispatch period end / Tanggal akhir periode dispatch"),
  contractDate: z.string().optional().describe("労働者派遣個別契約書（⑥）の締結日 / Execution date of the T2P individual contract (⑥) / Tanggal penandatanganan kontrak individual T2P (⑥)"),
  contractNumber: z.string().optional().describe("労働者派遣個別契約書（⑥）の契約番号 / Contract number of the T2P individual contract (⑥) / Nomor kontrak individual T2P (⑥)"),

  // --- ④求人条件明示書（職安法5条の3） / Job-order conditions notice (Employment Security Act Art. 5-3) / Pemberitahuan ketentuan lowongan (UU Keamanan Kerja Pasal 5-3) ---
  jobDuties: z.string().min(1).optional().describe("業務内容 / Job duties / Uraian tugas"),
  jobDutiesChangeScope: z.string().optional().describe("業務の変更の範囲 / Scope of possible change to duties / Lingkup perubahan tugas"),
  workLocationT2p: z.string().min(1).optional().describe("就業場所 / Work location / Lokasi kerja"),
  workLocationChangeScopeT2p: z.string().optional().describe("就業場所の変更の範囲 / Scope of possible change to work location / Lingkup perubahan lokasi kerja"),
  contractPeriodTerms: z.string().min(1).optional().describe("労働契約の期間・更新の有無・基準・上限 / Contract period, renewal terms and cap / Periode kontrak, ketentuan dan batas perpanjangan"),
  probationPeriodTerms: z.string().optional().describe("試用期間（紹介予定派遣を経た直接雇用の場合は設けられない） / Probation period (none allowed after T2P conversion) / Periode percobaan (tidak diperbolehkan setelah konversi T2P)"),
  workHoursTerms: z.string().min(1).optional().describe("就業時間・休憩・時間外労働 / Work hours, break, overtime / Jam kerja, istirahat, lembur"),
  daysOffTerms: z.string().min(1).optional().describe("休日・休暇 / Days off and leave / Hari libur dan cuti"),
  wageDetails: z.string().min(1).optional().describe("賃金（基本給・諸手当・固定残業代・賞与昇給） / Wage details (base pay, allowances, fixed overtime, bonus/raise) / Detail upah (gaji dasar, tunjangan, lembur tetap, bonus/kenaikan)"),
  socialInsuranceEnrollment: z.string().optional().describe("社会保険・労働保険の加入状況 / Social/labor insurance enrollment / Kepesertaan asuransi sosial/ketenagakerjaan"),
  smokingPreventionMeasures: z.string().optional().describe("受動喫煙防止措置 / Passive-smoking prevention measures / Tindakan pencegahan asap rokok pasif"),
  employmentCategoryT2p: z.string().min(1).optional().describe("雇用形態（直接雇用／紹介予定派遣を経た直接雇用） / Employment category (direct / T2P-conversion) / Kategori kepegawaian (langsung / konversi T2P)"),
  t2pConversionTiming: z.string().optional().describe("直接雇用の打診時期 / Timing of the direct-employment offer / Waktu penawaran kerja langsung"),
  t2pConversionConditions: z.string().optional().describe("転換後の雇用形態・労働条件（見込み） / Expected post-conversion employment terms / Ketentuan kerja pasca konversi (perkiraan)"),
  t2pNonHireReasonPolicy: z
    .string()
    .optional()
    .describe(
      "職業紹介を受けない場合・不採用の場合の理由明示に関する説明 / Explanation of the reason-disclosure policy for non-hire cases / Penjelasan kebijakan pengungkapan alasan untuk kasus tidak diterima",
    ),
  dormitoryAndCommute: z.string().optional().describe("寮・社宅・通勤に関する事項 / Dormitory/commute arrangements / Pengaturan asrama/transportasi"),
  otherRemarks: z.string().optional().describe("その他備考 / Other remarks / Catatan lain"),
  disclosureDate: z.string().optional().describe("④明示年月日 / Disclosure date of ④ / Tanggal pengungkapan ④"),
  disclosureMethod: z.string().optional().describe("④明示方法（書面交付／電子メール等） / Disclosure method of ④ / Metode pengungkapan ④"),
  staffContactPerson: z.string().optional().describe("担当者名 / Staff contact person / Nama petugas"),

  // --- ⑤本人同意書（職安法5条の3・5条の4） / Consent form (Employment Security Act Art. 5-3, 5-4) / Formulir persetujuan (UU Keamanan Kerja Pasal 5-3, 5-4) ---
  directEmploymentStartPlan: z.string().optional().describe("直接雇用への切替予定 / Planned start of direct employment / Rencana mulai kerja langsung"),
  consentDate: z.string().min(1).optional().describe("本人同意の日付 / Date of consent / Tanggal persetujuan"),
  seekerFullNameLatin: z.string().min(1).optional().describe("求職者氏名（ローマ字） / Job seeker's full name (Latin letters) / Nama lengkap pencari kerja (huruf Latin)"),
  explainedBy: z.string().optional().describe("説明者（スグクル担当者） / Explained by (Sugukuru staff) / Dijelaskan oleh (staf Sugukuru)"),
  interpreterPresent: z.string().optional().describe("通訳・同席者 / Interpreter / person present / Penerjemah / pihak yang hadir"),
  explanationLanguage: z.string().optional().describe("説明に使用した言語 / Language used for the explanation / Bahasa yang digunakan untuk penjelasan"),

  // --- ⑦転換条件覚書 / Conversion memo / Memo konversi ---
  staffNationality: z.string().optional().describe("対象派遣労働者の国籍 / Staff nationality / Kewarganegaraan staf"),
  staffResidenceStatusAndExpiry: z.string().optional().describe("在留資格・在留期限 / Residence status and expiry / Status dan tanggal berakhir tinggal"),
  conversionDate: z.string().optional().describe("転換予定時期（特定技能は在留資格変更許可日） / Planned conversion date (permit-grant date for Specified Skilled Worker) / Tanggal konversi yang direncanakan (tanggal izin untuk Tenaga Kerja Terampil Khusus)"),
  postConversionEmploymentType: z.string().optional().describe("転換後の雇用形態（正社員／契約社員） / Post-conversion employment type / Jenis kepegawaian pasca konversi"),
  postConversionWage: z.string().optional().describe("転換後の賃金 / Post-conversion wage / Upah pasca konversi"),
  postConversionWorkLocation: z.string().optional().describe("転換後の就業場所 / Post-conversion work location / Lokasi kerja pasca konversi"),
  postConversionOtherTerms: z.string().optional().describe("転換後のその他条件 / Other post-conversion terms / Ketentuan lain pasca konversi"),
  referralFeeAmount: z.string().optional().describe("紹介手数料額（1名につき・税別） / Referral fee amount per hire (excl. tax) / Jumlah biaya rujukan per perekrutan (tanpa pajak)"),
  feePaymentDueDate: z.string().optional().describe("紹介手数料の支払期日 / Fee payment due date / Tanggal jatuh tempo pembayaran biaya"),
  feePaymentMethod: z.string().optional().describe("紹介手数料の支払方法 / Fee payment method / Metode pembayaran biaya"),
  refundPolicy: z.string().optional().describe("返金規定（早期自己都合退職時の返金率等） / Refund policy for early self-initiated resignation / Kebijakan pengembalian dana untuk pengunduran diri dini"),
  replacementReferralClause: z.string().optional().describe("代替紹介特約 / Replacement-referral clause / Klausul rujukan pengganti"),
  visaProcedureFeeClause: z.string().optional().describe("在留手続費用の取扱い（行政書士との直接契約） / Handling of visa-procedure fees (direct contract with gyoseishoshi) / Penanganan biaya prosedur visa (kontrak langsung dengan gyoseishoshi)"),
  clientRepresentative: z.string().optional().describe("甲（派遣先）の代表者 / Client representative / Perwakilan klien"),
  memoDate: z.string().optional().describe("転換条件覚書の締結日 / Execution date of the conversion memo / Tanggal penandatanganan memo konversi"),

  // --- ⑧不採用理由の明示請求 / Request for reason of non-hire / Permintaan alasan tidak diterima ---
  documentNumber: z.string().optional().describe("文書番号 / Document number / Nomor dokumen"),
  issueDate: z.string().optional().describe("発信日 / Issue date / Tanggal penerbitan"),
  staffManagementNumber: z.string().optional().describe("派遣労働者の管理番号 / Staff management number / Nomor manajemen staf"),
  nonHireCategory: z
    .string()
    .optional()
    .describe(
      "該当区分（職業紹介を受けることを希望しない場合／職業紹介を受けた派遣労働者を雇用しない場合） / Non-hire category / Kategori tidak diterima",
    ),
  replyDueDate: z.string().optional().describe("回答期日 / Reply due date / Tanggal jatuh tempo balasan"),

  // --- ⑨不採用理由の書面明示 / Written notice of non-hire reason / Pemberitahuan tertulis alasan tidak diterima ---
  noticeDate: z.string().optional().describe("⑨通知日 / Notice date of ⑨ / Tanggal pemberitahuan ⑨"),
  noticeMethod: z.string().optional().describe("⑨通知方法（書面交付／電子メール等） / Notice method of ⑨ / Metode pemberitahuan ⑨"),
});

export type T2pReferralConditionsInput = z.infer<typeof t2pReferralConditionsInputSchema>;
