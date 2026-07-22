/**
 * statelessサービス層に渡すリクエストコンテキスト。MCPセッションには業務状態を置かず、
 * 全てDB上のoperation_id/task_id/approval_request_idで再開可能にする（§2.4）
 * Request context passed into the stateless service layer. No business state lives in the MCP session;
 * everything is resumable via operation_id/task_id/approval_request_id in the DB (§2.4)
 * Konteks permintaan yang diteruskan ke lapisan layanan stateless. Tidak ada status bisnis di sesi MCP;
 * semuanya dapat dilanjutkan via operation_id/task_id/approval_request_id di DB (§2.4)
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema/index.js";
import type { AuthenticatedPrincipal } from "../lib/auth.js";

export interface ServiceContext {
  readonly principal: AuthenticatedPrincipal;
  readonly requestId: string;
  readonly db: NodePgDatabase<typeof schema>;
}
