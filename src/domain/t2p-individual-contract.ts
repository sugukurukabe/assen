/**
 * ⑥労働者派遣個別契約書（紹介予定派遣）の法定必須項目の型定義。
 * A2（dispatch-individual-contract.ts）と同じdispatch_assignments.conditionsTyped(JSONB)を再利用し
 * （t2pFlag=true時のみ使用）、T2P第2表（T-1〜T-10）は職業紹介の実施・6ヶ月上限・試用期間の禁止・
 * 理由明示義務・返戻金制度など、案件ごとに変動しない固定的な法定文言のためテンプレート側に直接記載する。
 * 案件ごとに変動する唯一の第2表項目（T-7紹介手数料額）は既存のreferralFeeRate（dispatch-conditions.ts）を
 * 必須化して再利用するため、新規フィールドの追加は不要と判断した。
 *
 * Typed shape of the statutory items in the T2P individual dispatch contract. Reuses the same
 * dispatch_assignments.conditionsTyped (JSONB) as A2 (dispatch-individual-contract.ts), used only
 * when t2pFlag=true. The T2P-specific clauses (T-1 through T-10) are fixed statutory boilerplate that
 * does not vary per case (referral notice, 6-month cap, no-probation rule, reason-disclosure duty,
 * refund policy, etc.), so they are written directly into the template. The only case-varying T-2
 * item (T-7 referral fee amount) reuses the existing referralFeeRate field (dispatch-conditions.ts) as
 * required, so no new field was added to the shared superset.
 *
 * Bentuk bertipe dari item wajib dalam kontrak dispatch individual T2P. Menggunakan ulang
 * dispatch_assignments.conditionsTyped (JSONB) yang sama seperti A2 (dispatch-individual-contract.ts),
 * hanya dipakai saat t2pFlag=true. Klausul khusus T2P (T-1 hingga T-10) adalah boilerplate hukum tetap
 * yang tidak berubah per kasus (pemberitahuan rujukan, batas 6 bulan, aturan tanpa-percobaan, kewajiban
 * pengungkapan alasan, kebijakan pengembalian dana, dll.), sehingga ditulis langsung di template. Satu
 * item Tabel-2 yang berubah per kasus (T-7 jumlah biaya rujukan) menggunakan ulang field referralFeeRate
 * yang sudah ada (dispatch-conditions.ts) sebagai wajib, sehingga tidak ada field baru yang ditambahkan
 * ke superset bersama.
 */
import { z } from "zod";

export const t2pIndividualContractSchema = z.object({
  // 契約書番号・締結日 / Contract number/date / Nomor/tanggal kontrak
  contractNumber: z.string().min(1),
  contractDate: z.string().min(1),
  basicContractDate: z.string().optional(),
  // 派遣先の氏名又は名称（甲） / Client name / Nama klien
  clientName: z.string().min(1),
  // 業務内容・責任の程度（第1表1-2） / Job duties, responsibility level (Table 1, items 1-2) / Uraian tugas, tingkat tanggung jawab (Tabel 1, item 1-2)
  jobDuties: z.string().min(1),
  responsibilityLevel: z.string().min(1),
  // 派遣先事業所・派遣就業場所（第1表3） / Client establishment, work location (Table 1, item 3) / Perusahaan klien, lokasi kerja (Tabel 1, item 3)
  clientEstablishmentName: z.string().min(1),
  clientEstablishmentAddress: z.string().min(1),
  workplace: z.string().min(1),
  workLocationAddress: z.string().min(1),
  // 組織単位・指揮命令者（第1表4-5） / Org unit, supervisor (Table 1, items 4-5) / Unit organisasi, supervisor (Tabel 1, item 4-5)
  orgUnit: z.string().min(1),
  orgUnitHeadTitle: z.string().optional(),
  supervisorInfo: z.string().min(1),
  // 派遣先責任者・派遣元責任者 / Responsible persons / Penanggung jawab
  clientResponsiblePersonInfo: z.string().min(1),
  agencyResponsiblePersonInfo: z.string().min(1),
  // 派遣期間（第1表6・第2表T-2：同一労働者につき通算6ヶ月以内） / Dispatch period (Table 1 item 6, Table 2 T-2: max 6 months total per worker) / Periode dispatch (Tabel 1 item 6, Tabel 2 T-2: maks 6 bulan total per pekerja)
  dispatchPeriod: z.string().min(1),
  // 就業日・就業時間・休憩・時間外休日労働（第1表7-9） / Work days/hours, break, overtime/holiday work (Table 1, items 7-9) / Hari/jam kerja, istirahat, lembur/kerja libur (Tabel 1, item 7-9)
  workDays: z.string().min(1),
  workHoursStart: z.string().min(1),
  workHoursEnd: z.string().min(1),
  breakTime: z.string().min(1),
  overtimeTerms: z.string().optional(),
  holidayWorkTerms: z.string().optional(),
  // 派遣人員・派遣料金・支払条件（第1表16-18） / Headcount, fee, payment terms (Table 1, items 16-18) / Jumlah tenaga kerja, biaya, ketentuan pembayaran (Tabel 1, item 16-18)
  headcount: z.string().min(1),
  feeAmount: z.string().min(1),
  // 協定対象派遣労働者の限定の有無（第1表15） / Agreement-based worker limitation (Table 1, item 15) / Batasan pekerja berbasis perjanjian (Tabel 1, item 15)
  agreementBasedWorkerLimitation: z.string().min(1),
  // 甲（派遣先）の所在地・代表者（契約書末尾） / Client address/representative (contract footer) / Alamat/perwakilan klien (footer kontrak)
  clientAddress: z.string().min(1),
  clientRepresentative: z.string().min(1),
  // 紹介手数料額（第2表T-7・唯一の案件変動項目） / Referral fee amount (Table 2 T-7, the only case-varying item) / Jumlah biaya rujukan (Tabel 2 T-7, satu-satunya item yang berubah per kasus)
  referralFeeRate: z.string().min(1),
});

export type T2pIndividualContract = z.infer<typeof t2pIndividualContractSchema>;

export const t2pIndividualContractFieldKeys = Object.keys(t2pIndividualContractSchema.shape);
