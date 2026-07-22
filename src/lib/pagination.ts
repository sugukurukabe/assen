/**
 * MCP Resources/Toolsのページネーション用opaqueカーソル。内部的にはoffsetをbase64化する
 * Opaque pagination cursor for MCP Resources/Tools. Internally base64-encodes an offset
 * Cursor pagination opaque untuk MCP Resources/Tools. Secara internal mengenkode offset dengan base64
 */
import { z } from "zod";

const cursorPayloadSchema = z.object({
  offset: z.number().int().nonnegative(),
});

export interface PageResult<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * offsetをbase64カーソルへエンコードする
 * Encodes an offset into a base64 cursor
 * Mengenkode offset menjadi cursor base64
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

/**
 * base64カーソルをoffsetへデコードする。不正なカーソルは0にフォールバックする
 * Decodes a base64 cursor into an offset. Falls back to 0 for malformed cursors
 * Mendekode cursor base64 menjadi offset. Fallback ke 0 untuk cursor yang tidak valid
 */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const result = cursorPayloadSchema.parse(parsed);
    return result.offset;
  } catch {
    return 0;
  }
}

/**
 * ページ結果を組み立てる（limit+1件取得して次頁の有無を判定する呼び出し側と組み合わせて使う）
 * Assembles a page result (pair with a caller that fetches limit+1 rows to detect a next page)
 * Menyusun hasil halaman (dipasangkan dengan pemanggil yang mengambil limit+1 baris untuk mendeteksi halaman berikutnya)
 */
export function buildPage<T>(rows: T[], limit: number, currentOffset: number): PageResult<T> {
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasNext ? encodeCursor(currentOffset + limit) : undefined,
  };
}
