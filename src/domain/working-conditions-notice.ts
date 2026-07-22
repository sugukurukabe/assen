/**
 * A3 就業条件明示書（派遣法34条）の法定必須項目の型定義。dispatch_assignments.conditionsTyped(JSONB)の中身の部分集合を固定する
 * Typed shape of the statutory items in the working-conditions notice (Art. 34). Fixes a subset of the payload of dispatch_assignments.conditionsTyped (JSONB)
 * Bentuk bertipe dari item wajib dalam pemberitahuan kondisi kerja (Pasal 34). Menetapkan subset dari payload dispatch_assignments.conditionsTyped (JSONB)
 */
import { z } from "zod";

export const workingConditionsNoticeSchema = z.object({
  // 派遣先の氏名又は名称 / Client name / Nama klien
  clientName: z.string().min(1),
  // 従事する業務の内容 / Job duties / Uraian tugas
  jobDuties: z.string().min(1),
  // 雇入れ直後の就業場所・就業場所の変更の範囲 / Initial work location / possible change scope / Lokasi kerja awal / lingkup perubahan
  workLocationInitial: z.string().min(1),
  workLocationChangeScope: z.string().optional(),
  // 組織単位 / Org unit / Unit organisasi
  orgUnit: z.string().min(1),
  // 指揮命令者 / Supervisor / Supervisor
  supervisorInfo: z.string().min(1),
  // 派遣期間・就業日・就業時間・休憩時間 / Dispatch period, work days/hours, break / Periode dispatch, hari/jam kerja, istirahat
  dispatchPeriod: z.string().min(1),
  workDays: z.string().min(1),
  workHoursStart: z.string().min(1),
  workHoursEnd: z.string().min(1),
  breakTime: z.string().min(1),
  // 安全及び衛生 / Safety and health / Keselamatan dan kesehatan
  safetyAndHealth: z.string().min(1),
  // 時間外労働・休日労働 / Overtime / holiday work / Lembur / kerja hari libur
  overtimeTerms: z.string().optional(),
  holidayWorkTerms: z.string().optional(),
  // 派遣元責任者・派遣先責任者 / Agency-/client-side responsible persons / Penanggung jawab pihak agen/klien
  agencyResponsiblePersonInfo: z.string().min(1),
  clientResponsiblePersonInfo: z.string().min(1),
  // 福利厚生施設の利用等 / Welfare facilities / Fasilitas kesejahteraan
  welfareFacilities: z.string().optional(),
  // 苦情の処理及び申出先 / Complaint handling contacts / Kontak penanganan keluhan
  complaintHandling: z.string().min(1),
  // 労働者派遣契約の解除の場合に講ずる措置 / Measures on contract termination / Tindakan saat pemutusan kontrak
  contractTerminationMeasures: z.string().min(1),
  // 派遣先が派遣労働者を雇用する場合の紛争防止措置 / Dispute-prevention measures / Tindakan pencegahan perselisihan
  disputePreventionMeasures: z.string().min(1),
  // 紹介予定派遣に関する明示（T2Pの場合必須） / T2P disclosure (mandatory when applicable) / Pengungkapan T2P
  t2pDisclosure: z.string().optional(),
  // 備考（任意） / Remarks (optional) / Catatan (opsional)
  remarks: z.string().optional(),
});

export type WorkingConditionsNotice = z.infer<typeof workingConditionsNoticeSchema>;

export const workingConditionsNoticeFieldKeys = Object.keys(workingConditionsNoticeSchema.shape);
