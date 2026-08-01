/**
 * Slack選択肢3ツール（staff_list / partner_list / job_seeker_list）が受け付けるrole。
 * Boltサービスアカウントはsystem専用で、書き込みツールにはsystemを許可しない。
 * Roles accepted by the three Slack option tools (staff_list / partner_list / job_seeker_list).
 * The Bolt service account is system-only; write tools must not accept system.
 * Role yang diterima oleh tiga tool opsi Slack (staff_list / partner_list / job_seeker_list).
 * Akun layanan Bolt khusus system; tool write tidak boleh menerima system.
 */
import type { PrincipalRole } from "../../lib/auth.js";

export const LIST_OPTION_ALLOWED_ROLES: readonly PrincipalRole[] = [
  "requester",
  "admin",
  "approver",
  "system",
];
