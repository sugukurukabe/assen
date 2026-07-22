/**
 * MCPサーバー用ロガー。PII・秘密情報を自動的にマスクし、console.errorのみを使う
 * MCP server logger. Automatically redacts PII/secrets and only uses console.error
 * Logger untuk server MCP. Otomatis menyamarkan PII/rahasia dan hanya menggunakan console.error
 */

export type LogSeverity = "debug" | "info" | "notice" | "warning" | "error" | "critical";

const REDACTED_KEYS = new Set([
  "name",
  "nameEnc",
  "addressEnc",
  "birthDateEnc",
  "email",
  "phone",
  "rawText",
  "sourceText",
  "token",
  "apiKey",
  "password",
  "secret",
]);

/**
 * ログ出力前にPII・秘密キーの値を再帰的にマスクする
 * Recursively redacts PII/secret key values before logging
 * Menyamarkan nilai kunci PII/rahasia secara rekursif sebelum logging
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redact(val, depth + 1);
      }
    }
    return result;
  }
  return value;
}

/**
 * RFC 5424 severityでMCP notifications/messageに載せられる形にログを出す
 * Emits logs in a shape suitable for MCP notifications/message with RFC 5424 severity
 * Mengeluarkan log dalam bentuk yang sesuai untuk MCP notifications/message dengan severity RFC 5424
 */
export function logMessage(severity: LogSeverity, message: string, context?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    severity,
    message,
    context: context ? redact(context) : undefined,
  };
  console.error(JSON.stringify(entry));
}
