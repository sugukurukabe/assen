/**
 * 法定項目マトリクスの機械検査。各mapping JSONの項目→DB列が実スキーマに存在するか、
 * かつ列が欠落していないかを検証する（M0のDone条件「100%マッピング」をCIで保証する）
 * Machine-checks the legal-item mapping matrices. Verifies that every item -> DB column
 * reference resolves against the real schema (enforces M0's "100% mapping" done-condition in CI)
 * Memeriksa matriks mapping item hukum secara mesin. Memverifikasi setiap referensi item -> kolom DB
 * benar-benar ada di skema (menegakkan kondisi selesai "mapping 100%" M0 di CI)
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../../src/db/schema/index.js";
import { laborConditionsNoticeFieldKeys } from "../../src/domain/labor-conditions-notice.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

interface MappingItem {
  legalItem: string;
  dbColumn: string;
  outputField: string;
  optional?: boolean;
}

interface MappingFile {
  docType: string;
  docTypeLabel: string;
  table: string;
  jsonColumn?: string;
  items: MappingItem[];
}

type SchemaModule = typeof schema;

function resolveTable(tableName: string): Record<string, unknown> {
  const table = (schema as SchemaModule)[tableName as keyof SchemaModule];
  if (!table) {
    throw new Error(`schemaにテーブル ${tableName} が存在しません / Table ${tableName} does not exist in schema`);
  }
  return getTableColumns(table as never) as Record<string, unknown>;
}

function checkFlatColumn(tableColumns: Record<string, unknown>, dbColumn: string): string[] {
  const problems: string[] = [];
  for (const columnName of dbColumn.split(",")) {
    if (!(columnName in tableColumns)) {
      problems.push(`列 ${columnName} がテーブルに存在しません / column ${columnName} does not exist on table`);
    }
  }
  return problems;
}

function checkJsonColumnPath(dbColumn: string, jsonColumn: string): string[] {
  const [prefix, ...rest] = dbColumn.split(".");
  if (prefix !== jsonColumn || rest.length !== 1) {
    return [`dbColumn ${dbColumn} は ${jsonColumn}.<field> 形式である必要があります / dbColumn ${dbColumn} must be in ${jsonColumn}.<field> form`];
  }
  const field = rest[0]!;
  if (!laborConditionsNoticeFieldKeys.includes(field)) {
    return [`labor-conditions-notice スキーマに ${field} が存在しません / field ${field} is missing from the labor-conditions-notice schema`];
  }
  return [];
}

function checkMappingFile(fileName: string): { fileName: string; docType: string; itemCount: number; problems: string[] } {
  const raw = readFileSync(join(currentDir, fileName), "utf8");
  const mapping = JSON.parse(raw) as MappingFile;
  const problems: string[] = [];

  if (mapping.items.length === 0) {
    problems.push("items が空です（法定項目が1つもマッピングされていません） / items is empty (no legal items mapped)");
  }

  const tableColumns = resolveTable(mapping.table);

  for (const item of mapping.items) {
    if (!item.legalItem || !item.outputField) {
      problems.push(`legalItem/outputField が欠落: ${JSON.stringify(item)}`);
      continue;
    }
    if (mapping.jsonColumn && item.dbColumn.startsWith(`${mapping.jsonColumn}.`)) {
      problems.push(...checkJsonColumnPath(item.dbColumn, mapping.jsonColumn));
    } else {
      problems.push(...checkFlatColumn(tableColumns, item.dbColumn));
    }
  }

  return { fileName, docType: mapping.docType, itemCount: mapping.items.length, problems };
}

function main(): void {
  const mappingFiles = readdirSync(currentDir).filter((file) => file.endsWith(".json"));
  if (mappingFiles.length === 0) {
    console.error("mapping JSONが見つかりません / No mapping JSON files found");
    process.exitCode = 1;
    return;
  }

  let totalProblems = 0;
  for (const fileName of mappingFiles) {
    const result = checkMappingFile(fileName);
    const status = result.problems.length === 0 ? "OK" : "FAIL";
    console.error(`[${status}] ${result.fileName} (${result.docType}) — ${result.itemCount}項目`);
    for (const problem of result.problems) {
      console.error(`  - ${problem}`);
      totalProblems += 1;
    }
  }

  if (totalProblems > 0) {
    console.error(`\n合計 ${totalProblems} 件の不整合があります / ${totalProblems} inconsistencies found`);
    process.exitCode = 1;
  } else {
    console.error("\n全ての法定項目マッピングが100%整合しています / All legal-item mappings are 100% consistent");
  }
}

main();
