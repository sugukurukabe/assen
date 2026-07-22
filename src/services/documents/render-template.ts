/**
 * legal/templates/配下のテンプレートを{{field}}プレースホルダで単純置換する最小レンダラ。
 * 本格的なdocx/PDF生成は今後の課題（README参照）。バイト列としてSHA-256で保存・追跡可能にすることが本層の責務
 * Minimal renderer that substitutes {{field}} placeholders in templates under legal/templates/.
 * Full docx/PDF rendering is a follow-up (see README); this layer's responsibility is producing trackable, SHA-256-hashed bytes
 * Renderer minimal yang mengganti placeholder {{field}} pada template di legal/templates/.
 * Rendering docx/PDF penuh adalah follow-up (lihat README); tanggung jawab lapisan ini adalah menghasilkan byte yang dapat dilacak dan di-hash SHA-256
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../../lib/project-root.js";

const projectRoot = findProjectRoot(import.meta.url);

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function renderTemplate(templateFileName: string, values: Record<string, unknown>): Buffer {
  const raw = readFileSync(join(projectRoot, "legal", "templates", templateFileName), "utf8");
  const rendered = raw.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null || value === "" ? "（未記載 / not provided / tidak diisi）" : stringifyValue(value);
  });
  return Buffer.from(rendered, "utf8");
}
