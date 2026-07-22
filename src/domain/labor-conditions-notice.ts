/**
 * 労働条件通知書（派遣）の法定必須項目の型定義。dispatch_assignments.conditionsTyped(JSONB)の中身を固定する
 * Typed shape of the statutory items in the written notice of working conditions (dispatch). Fixes the payload of dispatch_assignments.conditionsTyped (JSONB)
 * Bentuk bertipe dari item wajib dalam pemberitahuan tertulis kondisi kerja (dispatch). Menetapkan payload dispatch_assignments.conditionsTyped (JSONB)
 */
import { z } from "zod";

export const laborConditionsNoticeSchema = z.object({
  // 労働契約の期間 / Contract period / Periode kontrak
  contractPeriod: z.string().min(1),
  // 就業の場所 / Place of work / Tempat kerja
  workplace: z.string().min(1),
  // 従事すべき業務の内容 / Job duties / Uraian tugas
  jobDuties: z.string().min(1),
  // 始業・終業の時刻 / Start/end working hours / Jam kerja mulai/selesai
  workHoursStart: z.string().min(1),
  workHoursEnd: z.string().min(1),
  // 休憩時間 / Break time / Waktu istirahat
  breakTime: z.string().min(1),
  // 休日 / Days off / Hari libur
  daysOff: z.string().min(1),
  // 休暇 / Leave entitlement / Hak cuti
  leaveEntitlement: z.string().min(1),
  // 賃金の決定・計算・支払方法、締切・支払の時期 / Wage determination/calc/payment method and cut-off/pay date / Metode penentuan/kalkulasi/pembayaran upah dan tanggal cut-off/bayar
  wageDeterminationMethod: z.string().min(1),
  wagePayDate: z.string().min(1),
  // 退職に関する事項（解雇の事由を含む） / Resignation/dismissal terms / Ketentuan pengunduran diri/pemecatan
  resignationTerms: z.string().min(1),
  // 昇給に関する事項（任意記載） / Pay raise terms (optional) / Ketentuan kenaikan gaji (opsional)
  payRaiseTerms: z.string().optional(),
  // 派遣先事業所の名称（派遣特有項目） / Client establishment name (dispatch-specific) / Nama perusahaan klien (khusus dispatch)
  clientEstablishmentName: z.string().min(1),
  // 派遣期間・組織単位 / Dispatch period / org unit / Periode dispatch / unit organisasi
  dispatchPeriod: z.string().min(1),
  orgUnit: z.string().min(1),
  // 紹介予定派遣である旨の明示（T2Pの場合必須） / Explicit T2P disclosure (mandatory when applicable) / Pengungkapan T2P secara eksplisit (wajib bila berlaku)
  t2pDisclosure: z.string().optional(),
});

export type LaborConditionsNotice = z.infer<typeof laborConditionsNoticeSchema>;

export const laborConditionsNoticeFieldKeys = Object.keys(laborConditionsNoticeSchema.shape);
