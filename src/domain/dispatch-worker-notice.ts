/**
 * A10 派遣先通知（派遣労働者通知書、派遣法35条）の法定必須項目の型定義。dispatch_assignments.conditionsTyped(JSONB)の中身の部分集合を固定する
 * Typed shape of the statutory items in the notification of dispatched worker (Art. 35). Fixes a subset of the payload of dispatch_assignments.conditionsTyped (JSONB)
 * Bentuk bertipe dari item wajib dalam pemberitahuan pekerja dispatch (Pasal 35). Menetapkan subset dari payload dispatch_assignments.conditionsTyped (JSONB)
 */
import { z } from "zod";

export const dispatchWorkerNoticeSchema = z.object({
  notificationNumber: z.string().min(1),
  notificationDate: z.string().min(1),
  clientName: z.string().min(1),
  clientEstablishmentName: z.string().min(1),
  agencyResponsiblePersonName: z.string().min(1),
  // 派遣労働者に関する基本情報 / Basic staff info / Info dasar staf
  staffName: z.string().min(1),
  staffGender: z.string().min(1),
  staffBirthDate: z.string().min(1),
  staffNationality: z.string().min(1),
  // 雇用形態及び法適合状況 / Employment category and legal-compliance status / Kategori kepegawaian dan status kepatuhan hukum
  employmentCategory: z.string().min(1),
  periodLimitExceptionCategory: z.string().optional(),
  agreementBasedWorkerLimitation: z.string().min(1),
  // 社会保険・労働保険の加入状況 / Insurance enrollment status / Status kepesertaan asuransi
  healthInsuranceStatus: z.string().min(1),
  healthInsuranceNonEnrollmentReason: z.string().optional(),
  pensionInsuranceStatus: z.string().min(1),
  pensionInsuranceNonEnrollmentReason: z.string().optional(),
  employmentInsuranceStatus: z.string().min(1),
  employmentInsuranceNonEnrollmentReason: z.string().optional(),
  // 在留資格に関する事項（特定技能外国人等） / Residence-status items (specified skilled worker etc.) / Item status tinggal (pekerja terampil tertentu dll.)
  residenceStatus: z.string().optional(),
  residencePeriod: z.string().optional(),
  residenceExpiryDate: z.string().optional(),
  residenceCardNumber: z.string().optional(),
  // 派遣就業条件（個別契約との紐づけ） / Dispatch terms (linked to the individual contract) / Ketentuan dispatch (terkait dengan kontrak individual)
  contractNumber: z.string().min(1),
  dispatchPeriod: z.string().min(1),
  jobDuties: z.string().min(1),
  workplace: z.string().min(1),
  workLocationAddress: z.string().min(1),
});

export type DispatchWorkerNotice = z.infer<typeof dispatchWorkerNoticeSchema>;

export const dispatchWorkerNoticeFieldKeys = Object.keys(dispatchWorkerNoticeSchema.shape);
