/**
 * SHA-256ハッシュ計算ユーティリティ。文書バイト列・監査チェーン・承認対象に使う
 * SHA-256 hashing utilities used for document bytes, audit chain, and approval targets
 * Utilitas hashing SHA-256 yang digunakan untuk byte dokumen, rantai audit, dan target persetujuan
 */
import { createHash } from "node:crypto";

/**
 * バイト列またはUTF-8文字列のSHA-256ハッシュを16進文字列で返す
 * Returns the SHA-256 hash of bytes or a UTF-8 string as a hex string
 * Mengembalikan hash SHA-256 dari byte atau string UTF-8 sebagai string heksadesimal
 */
export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * 監査イベントの決定論的シリアライズ用ハッシュ入力を生成する（キー順を固定してハッシュの再現性を保つ）
 * Produces a deterministic serialization for audit-event hashing (fixed key order for reproducibility)
 * Menghasilkan serialisasi deterministik untuk hashing audit-event (urutan key tetap agar dapat direproduksi)
 */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
