/**
 * 共通レスポンス封筒（§7）。全ての書込系ツールはこの形でJSON文字列を返す
 * Common response envelope (§7). Every write tool returns JSON in this shape
 * Envelope respons umum (§7). Setiap tool write mengembalikan JSON dalam bentuk ini
 */
import { z } from "zod";
import type { Finding } from "../services/rules/five-value-result.js";

export const findingSchema = z.object({
  ruleKey: z.string(),
  result: z.enum(["pass", "fail", "incomplete", "ambiguous", "expert_review_required"]),
  severity: z.enum(["info", "warning", "blocking"]),
  message: z.string(),
  missingFields: z.array(z.string()),
});

export const toolEnvelopeSchema = z.object({
  operationId: z.string(),
  subjectId: z.string(),
  subjectVersion: z.number().int(),
  status: z.string(),
  missingFields: z.array(z.string()),
  findings: z.array(findingSchema),
  evidenceRefs: z.array(z.string()),
  nextActions: z.array(z.string()),
});

export type ToolEnvelope = z.infer<typeof toolEnvelopeSchema>;

export function buildEnvelope(params: {
  operationId: string;
  subjectId: string;
  subjectVersion: number;
  status: string;
  missingFields?: string[];
  findings?: Finding[];
  evidenceRefs?: string[];
  nextActions?: string[];
}): ToolEnvelope {
  return {
    operationId: params.operationId,
    subjectId: params.subjectId,
    subjectVersion: params.subjectVersion,
    status: params.status,
    missingFields: params.missingFields ?? [],
    findings: params.findings ?? [],
    evidenceRefs: params.evidenceRefs ?? [],
    nextActions: params.nextActions ?? [],
  };
}

/**
 * MCPツールのcontent配列形式でJSON文字列をラップする（team rule：戻り値はJSON.stringifyでラップ）
 * Wraps a JSON string in the MCP tool content array shape (team rule: wrap return values with JSON.stringify)
 * Membungkus string JSON dalam bentuk array content tool MCP (team rule: bungkus nilai return dengan JSON.stringify)
 */
export function toToolResult(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export interface ResourceLinkRef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * JSON本文に加え、resource_linkブロック（例：ui://承認画面）を含めた戻り値を返す。
 * MCP AppをレンダリングできるホストはこのリンクからUIを取得できる（§7）
 * Returns the JSON body plus resource_link blocks (e.g. the ui:// approval screen). Hosts capable of
 * rendering MCP Apps can fetch the UI from this link (§7)
 * Mengembalikan body JSON ditambah blok resource_link (misalnya layar persetujuan ui://). Host yang mampu
 * merender MCP App dapat mengambil UI dari link ini (§7)
 */
export function toToolResultWithLinks(
  payload: unknown,
  links: ResourceLinkRef[],
): { content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string; description?: string; mimeType?: string }> } {
  return {
    content: [
      { type: "text", text: JSON.stringify(payload, null, 2) },
      ...links.map((link) => ({ type: "resource_link" as const, ...link })),
    ],
  };
}

export function toToolErrorResult(message: string, remediation?: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, remediation }, null, 2) }],
    isError: true,
  };
}
