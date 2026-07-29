/**
 * freeeから取得したマスタ候補をSlack選択肢に必要な最小形へ縮小した型。
 * Minimal master-candidate shapes reduced from freee responses for Slack options.
 * Bentuk kandidat master minimal dari respons freee untuk opsi Slack.
 */
export interface StaffMasterCandidate {
  freeeEmployeeId: string;
  staffId?: string;
  displayName: string;
  kana?: string;
  employeeNumber?: string;
  retireDate?: string;
  employmentType?: string;
}

export interface PartnerMasterCandidate {
  partnerId: string;
  officialName: string;
  nameKana?: string;
  shortcut1?: string;
  shortcut2?: string;
  available: boolean;
}

export interface FreeeDirectory {
  listStaffCandidates(): Promise<StaffMasterCandidate[]>;
  listPartnerCandidates(): Promise<PartnerMasterCandidate[]>;
}

export class FreeeIntegrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FreeeIntegrationError";
  }
}
