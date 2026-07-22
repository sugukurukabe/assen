/**
 * assen:// リソース・Resource Templateの登録集約
 * Aggregates registration of assen:// resources and resource templates
 * Mengagregasi registrasi resource dan resource template assen://
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { registerLegalRulesResource } from "./legal-rules.js";
import { registerDocumentsResource } from "./documents.js";
import { registerAuditResource } from "./audit.js";
import { registerFindingsResource } from "./findings.js";
import { registerApprovalUiResource } from "../apps/approval-ui/index.js";

export function registerAllResources(server: McpServer, context: ServiceContext): void {
  registerLegalRulesResource(server, context);
  registerDocumentsResource(server, context);
  registerAuditResource(server, context);
  registerFindingsResource(server, context);
  registerApprovalUiResource(server, context);
}
