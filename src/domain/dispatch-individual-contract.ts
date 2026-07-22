/**
 * A2 個別契約書（派遣法26条）の法定必須項目の型定義。dispatch_assignments.conditionsTyped(JSONB)の中身の部分集合を固定する
 * Typed shape of the statutory items in the individual dispatch contract (Art. 26). Fixes a subset of the payload of dispatch_assignments.conditionsTyped (JSONB)
 * Bentuk bertipe dari item wajib dalam kontrak dispatch individual (Pasal 26). Menetapkan subset dari payload dispatch_assignments.conditionsTyped (JSONB)
 */
import { z } from "zod";

export const dispatchIndividualContractSchema = z.object({
  // 契約書番号・締結日 / Contract number/date / Nomor/tanggal kontrak
  contractNumber: z.string().min(1),
  contractDate: z.string().min(1),
  basicContractDate: z.string().optional(),
  // 派遣先の氏名又は名称（甲） / Client name / Nama klien
  clientName: z.string().min(1),
  // 業務内容（派遣法26条1項1号） / Job duties (Art. 26-1-1) / Uraian tugas (Pasal 26-1-1)
  jobDuties: z.string().min(1),
  // 業務に伴う責任の程度（派遣法26条1項2号） / Responsibility level (Art. 26-1-2) / Tingkat tanggung jawab (Pasal 26-1-2)
  responsibilityLevel: z.string().min(1),
  // 派遣先事業所の名称及び所在地（派遣法26条1項3号） / Client establishment name/address (Art. 26-1-3) / Nama/alamat perusahaan klien (Pasal 26-1-3)
  clientEstablishmentName: z.string().min(1),
  clientEstablishmentAddress: z.string().min(1),
  // 派遣就業場所 / Work location / Lokasi kerja
  workplace: z.string().min(1),
  workLocationAddress: z.string().min(1),
  // 組織単位（3年期間制限の単位） / Org unit (3-year limit unit) / Unit organisasi (batas 3 tahun)
  orgUnit: z.string().min(1),
  orgUnitHeadTitle: z.string().optional(),
  // 指揮命令者（派遣法26条1項4号） / Supervisor (Art. 26-1-4) / Supervisor (Pasal 26-1-4)
  supervisorInfo: z.string().min(1),
  // 派遣先責任者（派遣法41条）・派遣元責任者（派遣法36条） / Responsible persons (Art. 41/36) / Penanggung jawab (Pasal 41/36)
  clientResponsiblePersonInfo: z.string().min(1),
  agencyResponsiblePersonInfo: z.string().min(1),
  // 派遣期間（派遣法26条1項5号）・抵触日 / Dispatch period (Art. 26-1-5) / 3-year limit date / Periode dispatch (Pasal 26-1-5) / Tanggal batas 3 tahun
  dispatchPeriod: z.string().min(1),
  teishokubiDisplay: z.string().min(1),
  periodLimitExceptionCategory: z.string().optional(),
  // 就業日・就業時間（派遣則22条・派遣法26条1項6号） / Work days/hours (Ord. Art. 22, Act Art. 26-1-6) / Hari/jam kerja (Ord. Pasal 22, UU Pasal 26-1-6)
  workDays: z.string().min(1),
  daysOff: z.string().min(1),
  workHoursStart: z.string().min(1),
  workHoursEnd: z.string().min(1),
  breakTime: z.string().min(1),
  overtimeTerms: z.string().optional(),
  holidayWorkTerms: z.string().optional(),
  // 派遣人員・派遣料金（派遣則22条） / Headcount/fee (Ord. Art. 22) / Jumlah tenaga kerja/biaya (Ord. Pasal 22)
  headcount: z.string().min(1),
  feeAmount: z.string().min(1),
  // 協定対象派遣労働者の限定の有無（派遣法26条1項12号） / Agreement-based worker limitation (Art. 26-1-12) / Batasan pekerja berbasis perjanjian (Pasal 26-1-12)
  agreementBasedWorkerLimitation: z.string().min(1),
  // 甲（派遣先）の所在地・代表者（契約書末尾） / Client address/representative (contract footer) / Alamat/perwakilan klien (footer kontrak)
  clientAddress: z.string().min(1),
  clientRepresentative: z.string().min(1),
  // 紹介予定派遣の場合の紹介手数料率（任意） / T2P referral fee rate (optional) / Tarif biaya rujukan T2P (opsional)
  referralFeeRate: z.string().optional(),
});

export type DispatchIndividualContract = z.infer<typeof dispatchIndividualContractSchema>;

export const dispatchIndividualContractFieldKeys = Object.keys(dispatchIndividualContractSchema.shape);
