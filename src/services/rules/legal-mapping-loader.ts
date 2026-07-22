/**
 * legal/mapping/*.json（法定項目マトリクス）を読み込むローダー。決定論的ルールエンジンの必須項目チェックに使う
 * Loader for legal/mapping/*.json (the legal-item mapping matrix). Used for required-field checks in the deterministic rule engine
 * Loader untuk legal/mapping/*.json (matriks mapping item hukum). Digunakan untuk pemeriksaan field wajib di rule engine deterministik
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../../lib/project-root.js";

const projectRoot = findProjectRoot(import.meta.url);

export interface MappingItem {
  legalItem: string;
  dbColumn: string;
  outputField: string;
  optional?: boolean;
}

export interface MappingFile {
  docType: string;
  docTypeLabel: string;
  table: string;
  jsonColumn?: string;
  items: MappingItem[];
}

const cache = new Map<string, MappingFile>();

export function loadMapping(fileName: string): MappingFile {
  const cached = cache.get(fileName);
  if (cached) {
    return cached;
  }
  const raw = readFileSync(join(projectRoot, "legal", "mapping", fileName), "utf8");
  const parsed = JSON.parse(raw) as MappingFile;
  cache.set(fileName, parsed);
  return parsed;
}

/**
 * 必須（optionalでない）項目のうち、rowで値が欠落しているdbColumnの一覧を返す
 * Returns the dbColumns among required (non-optional) items whose value is missing on the row
 * Mengembalikan dbColumns di antara item wajib (non-optional) yang nilainya kosong pada row
 */
export function findMissingRequiredColumns(mapping: MappingFile, row: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const item of mapping.items) {
    if (item.optional) {
      continue;
    }
    const columnNames = item.dbColumn.startsWith(`${mapping.jsonColumn ?? "\0"}.`)
      ? [item.dbColumn]
      : item.dbColumn.split(",");

    for (const columnName of columnNames) {
      const value = mapping.jsonColumn && columnName.startsWith(`${mapping.jsonColumn}.`)
        ? readJsonColumnPath(row, mapping.jsonColumn, columnName)
        : row[columnName];
      if (value === null || value === undefined || value === "") {
        missing.push(columnName);
      }
    }
  }
  return missing;
}

function readJsonColumnPath(row: Record<string, unknown>, jsonColumn: string, dotPath: string): unknown {
  const field = dotPath.slice(jsonColumn.length + 1);
  const blob = row[jsonColumn];
  if (!blob || typeof blob !== "object") {
    return undefined;
  }
  return (blob as Record<string, unknown>)[field];
}
