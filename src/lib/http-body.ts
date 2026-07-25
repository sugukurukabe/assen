/**
 * node:http IncomingMessageからJSON本文を読み込むユーティリティ（express未使用の素のHTTPサーバー用）
 * Utility to read a JSON body from a node:http IncomingMessage (for the plain HTTP server, without express)
 * Utilitas untuk membaca body JSON dari IncomingMessage node:http (untuk server HTTP polos, tanpa express)
 */
import type { IncomingMessage } from "node:http";
import { PayloadTooLargeError } from "./errors.js";

/**
 * maxBytesを超えるリクエストボディはメモリ枯渇(DoS)を防ぐため即座に拒否する
 * Rejects request bodies exceeding maxBytes immediately to guard against memory-exhaustion DoS
 * Menolak body permintaan yang melebihi maxBytes segera untuk mencegah DoS berupa kehabisan memori
 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const raw = await readTextBody(req, maxBytes);
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}

/**
 * JSON以外（OAuth token endpointのform-urlencoded等）の本文を安全に読み込む
 * Safely reads non-JSON bodies, such as form-urlencoded OAuth token endpoint requests
 * Membaca body non-JSON dengan aman, seperti permintaan form-urlencoded endpoint token OAuth
 */
export async function readTextBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new PayloadTooLargeError(
        `リクエストボディが上限（${maxBytes}バイト）を超えています / Request body exceeds the limit of ${maxBytes} bytes`,
      );
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return "";
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return "";
  }
  return raw;
}
