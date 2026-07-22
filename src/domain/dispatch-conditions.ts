/**
 * 派遣就業(dispatch_assignments.conditionsTyped)に格納する派遣関連書類の統合フィールド定義。
 * labor_conditions_notice（M1）・dispatch_individual_contract（A2）・dispatch_working_conditions_notice（A3）・
 * dispatch_worker_notice（A10）はいずれも同一の派遣就業を異なる読み手向けに描写するため、同一のJSONBを
 * 共有し、各docTypeのzodスキーマ（labor-conditions-notice.ts等）がそれぞれ必要な部分集合だけを取り出す。
 * このファイル自体は「入力として何を受け取れるか」の完全な一覧であり、必須/任意の判定は各docType側のスキーマが担う。
 *
 * Unified field catalog stored in dispatch_assignments.conditionsTyped. labor_conditions_notice (M1),
 * dispatch_individual_contract (A2), dispatch_working_conditions_notice (A3), and dispatch_worker_notice (A10)
 * all describe the same dispatch assignment for different audiences, so they share one JSONB blob; each
 * docType's own zod schema (e.g. labor-conditions-notice.ts) picks only the subset it needs. This file is the
 * full catalog of what can be captured as input; required-ness is decided per docType, not here.
 *
 * Katalog field terpadu yang disimpan di dispatch_assignments.conditionsTyped. labor_conditions_notice (M1),
 * dispatch_individual_contract (A2), dispatch_working_conditions_notice (A3), dan dispatch_worker_notice (A10)
 * semuanya mendeskripsikan penugasan dispatch yang sama untuk audiens berbeda, sehingga berbagi satu blob JSONB;
 * skema zod masing-masing docType (misalnya labor-conditions-notice.ts) hanya mengambil subset yang diperlukan.
 * File ini adalah katalog lengkap input yang dapat ditangkap; kewajiban field ditentukan per docType, bukan di sini.
 */
import { z } from "zod";

export const dispatchConditionsInputSchema = z.object({
  // --- labor_conditions_notice（M1）・共通コア項目 / shared core items / item inti bersama ---
  contractPeriod: z.string().min(1).optional().describe("労働契約の期間 / Contract period / Periode kontrak"),
  workplace: z.string().min(1).optional().describe("就業の場所 / Workplace / Tempat kerja"),
  jobDuties: z.string().min(1).optional().describe("従事すべき業務の内容 / Job duties / Uraian tugas"),
  workHoursStart: z.string().min(1).optional().describe("始業の時刻 / Start time / Jam mulai"),
  workHoursEnd: z.string().min(1).optional().describe("終業の時刻 / End time / Jam selesai"),
  breakTime: z.string().min(1).optional().describe("休憩時間 / Break time / Waktu istirahat"),
  daysOff: z.string().min(1).optional().describe("休日 / Days off / Hari libur"),
  leaveEntitlement: z.string().min(1).optional().describe("休暇 / Leave entitlement / Hak cuti"),
  wageDeterminationMethod: z.string().min(1).optional().describe("賃金の決定・計算・支払方法 / Wage determination method / Metode penentuan upah"),
  wagePayDate: z.string().min(1).optional().describe("賃金の締切・支払の時期 / Wage pay date / Tanggal bayar upah"),
  resignationTerms: z.string().min(1).optional().describe("退職に関する事項（解雇の事由を含む） / Resignation/dismissal terms / Ketentuan pengunduran diri"),
  payRaiseTerms: z.string().optional().describe("昇給に関する事項（任意記載） / Pay raise terms (optional) / Ketentuan kenaikan gaji (opsional)"),
  clientEstablishmentName: z.string().min(1).optional().describe("派遣先事業所の名称 / Client establishment name / Nama perusahaan klien"),
  dispatchPeriod: z.string().min(1).optional().describe("派遣期間 / Dispatch period / Periode dispatch"),
  t2pDisclosure: z.string().optional().describe("紹介予定派遣である旨の明示（T2Pの場合必須） / T2P disclosure (mandatory when applicable) / Pengungkapan T2P"),

  // --- dispatch_individual_contract（A2）・派遣法26条 / Art. 26 / Pasal 26 ---
  contractNumber: z.string().min(1).optional().describe("契約書番号 / Contract number / Nomor kontrak"),
  contractDate: z.string().min(1).optional().describe("締結日 / Contract execution date / Tanggal penandatanganan kontrak"),
  basicContractDate: z.string().optional().describe("基本契約締結日 / Master agreement date / Tanggal perjanjian dasar"),
  clientName: z.string().min(1).optional().describe("派遣先の氏名又は名称（甲） / Client name / Nama perusahaan klien"),
  responsibilityLevel: z.string().optional().describe("業務に伴う責任の程度（役職・権限の範囲） / Responsibility level / Tingkat tanggung jawab"),
  clientEstablishmentAddress: z.string().optional().describe("派遣先事業所の所在地・電話番号 / Client establishment address/phone / Alamat/telepon perusahaan klien"),
  workLocationAddress: z.string().optional().describe("派遣就業場所の所在地・電話番号 / Work location address/phone / Alamat/telepon lokasi kerja"),
  orgUnit: z.string().min(1).optional().describe("組織単位（3年期間制限の単位） / Org unit (3-year limit unit) / Unit organisasi (batas 3 tahun)"),
  orgUnitHeadTitle: z.string().optional().describe("組織の長の職名 / Org-unit head title / Jabatan kepala unit organisasi"),
  supervisorInfo: z.string().optional().describe("指揮命令者の所属・役職・氏名・電話番号 / Supervisor info / Info supervisor"),
  clientResponsiblePersonInfo: z.string().optional().describe("派遣先責任者の所属・役職・氏名・電話番号（派遣法41条） / Client-side responsible person info (Art. 41) / Info penanggung jawab pihak klien (Pasal 41)"),
  agencyResponsiblePersonInfo: z.string().optional().describe("派遣元責任者の氏名・電話番号（派遣法36条） / Agency-side responsible person info (Art. 36) / Info penanggung jawab pihak agen (Pasal 36)"),
  teishokubiDisplay: z.string().optional().describe("派遣可能期間の制限に抵触する日（表示用） / Display string for the 3-year-limit date / Tampilan tanggal batas 3 tahun"),
  periodLimitExceptionCategory: z.string().optional().describe("期間制限を受けない業務に係る事項（派遣法40条の2第1項各号） / Period-limit exception category / Kategori pengecualian batas periode"),
  workDays: z.string().optional().describe("就業日 / Work days / Hari kerja"),
  overtimeTerms: z.string().optional().describe("時間外労働の範囲（三六協定の範囲内） / Overtime terms / Ketentuan lembur"),
  holidayWorkTerms: z.string().optional().describe("休日労働（就業日外労働）の範囲 / Holiday-work terms / Ketentuan kerja hari libur"),
  headcount: z.string().optional().describe("派遣人員 / Headcount / Jumlah tenaga kerja"),
  feeAmount: z.string().optional().describe("派遣料金（基本料金・加算条件） / Fee amount and surcharge terms / Jumlah biaya dan ketentuan tambahan"),
  agreementBasedWorkerLimitation: z.string().optional().describe("協定対象派遣労働者の限定の有無 / Agreement-based worker limitation / Batasan pekerja berbasis perjanjian"),
  clientAddress: z.string().optional().describe("甲（派遣先）の所在地 / Client address (footer) / Alamat klien (footer)"),
  clientRepresentative: z.string().optional().describe("甲（派遣先）の代表者役職・氏名 / Client representative / Perwakilan klien"),
  referralFeeRate: z.string().optional().describe("職業紹介経由の雇用が成立した場合の紹介手数料率 / Referral fee rate / Tarif biaya rujukan"),

  // --- dispatch_working_conditions_notice（A3）・派遣法34条 / Art. 34 / Pasal 34 ---
  workLocationInitial: z.string().optional().describe("雇入れ直後の就業場所（事業所名・所在地・電話番号） / Initial work location / Lokasi kerja awal"),
  workLocationChangeScope: z.string().optional().describe("就業場所の変更の範囲 / Scope of possible work-location change / Lingkup perubahan lokasi kerja"),
  safetyAndHealth: z.string().optional().describe("安全及び衛生に関する事項 / Safety and health / Keselamatan dan kesehatan"),
  welfareFacilities: z.string().optional().describe("福利厚生施設の利用等 / Welfare facilities / Fasilitas kesejahteraan"),
  complaintHandling: z.string().optional().describe("苦情の処理及び申出先（派遣元・派遣先） / Complaint handling contacts / Kontak penanganan keluhan"),
  contractTerminationMeasures: z.string().optional().describe("労働者派遣契約の解除の場合に講ずる措置 / Measures on contract termination / Tindakan saat pemutusan kontrak"),
  disputePreventionMeasures: z.string().optional().describe("派遣先が派遣労働者を雇用する場合の紛争防止措置 / Dispute-prevention measures / Tindakan pencegahan perselisihan"),
  remarks: z.string().optional().describe("備考 / Remarks / Catatan"),

  // --- dispatch_worker_notice（A10）・派遣法35条 / Art. 35 / Pasal 35 ---
  notificationNumber: z.string().optional().describe("通知書番号 / Notification number / Nomor pemberitahuan"),
  notificationDate: z.string().optional().describe("通知日 / Notification date / Tanggal pemberitahuan"),
  agencyResponsiblePersonName: z.string().optional().describe("派遣元責任者氏名（通知書用） / Agency-side responsible person name (for the notice) / Nama penanggung jawab pihak agen (untuk pemberitahuan)"),
  staffName: z.string().optional().describe("派遣労働者の氏名 / Staff name / Nama staf"),
  staffGender: z.string().optional().describe("派遣労働者の性別 / Staff gender / Jenis kelamin staf"),
  staffBirthDate: z.string().optional().describe("派遣労働者の生年月日 / Staff birth date / Tanggal lahir staf"),
  staffNationality: z.string().optional().describe("派遣労働者の国籍 / Staff nationality / Kewarganegaraan staf"),
  employmentCategory: z.string().optional().describe("雇用の区分（無期雇用／有期雇用） / Employment category / Kategori kepegawaian"),
  healthInsuranceStatus: z.string().optional().describe("健康保険の加入有無 / Health insurance enrollment status / Status kepesertaan asuransi kesehatan"),
  healthInsuranceNonEnrollmentReason: z.string().optional().describe("健康保険未加入の理由（未加入の場合） / Reason for non-enrollment / Alasan tidak terdaftar"),
  pensionInsuranceStatus: z.string().optional().describe("厚生年金保険の加入有無 / Pension insurance enrollment status / Status kepesertaan pensiun"),
  pensionInsuranceNonEnrollmentReason: z.string().optional().describe("厚生年金保険未加入の理由 / Reason for non-enrollment / Alasan tidak terdaftar"),
  employmentInsuranceStatus: z.string().optional().describe("雇用保険の加入有無 / Employment insurance enrollment status / Status kepesertaan asuransi ketenagakerjaan"),
  employmentInsuranceNonEnrollmentReason: z.string().optional().describe("雇用保険未加入の理由 / Reason for non-enrollment / Alasan tidak terdaftar"),
  residenceStatus: z.string().optional().describe("在留資格 / Residence status / Status tinggal"),
  residencePeriod: z.string().optional().describe("在留期間 / Period of stay / Periode tinggal"),
  residenceExpiryDate: z.string().optional().describe("在留期間満了日 / Residence expiry date / Tanggal berakhir tinggal"),
  residenceCardNumber: z.string().optional().describe("在留カード番号 / Residence card number / Nomor kartu tinggal"),
});

export type DispatchConditionsInput = z.infer<typeof dispatchConditionsInputSchema>;
