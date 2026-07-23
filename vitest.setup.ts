/**
 * テスト実行前に.envを読み込む（ローカル開発用のみ。CIでは環境変数を直接注入する）
 * Loads .env before tests run (local development only; CI injects environment variables directly)
 * Memuat .env sebelum test berjalan (hanya untuk dev lokal; CI menyuntikkan variabel lingkungan langsung)
 */
import { existsSync } from "node:fs";
import { ensureBucketExists } from "./src/lib/storage.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * テスト用バケットは通常サーバー起動時（server.ts）にのみ作成されるため、サーバーを起動しないテスト実行では
 * 存在しないまま失敗する（NoSuchBucket）。テストスイート全体の前に一度だけ明示的に作成しておく
 * The test bucket is normally only created when the server boots (server.ts), so test runs that never boot the
 * server fail with NoSuchBucket. Explicitly create it once before the whole suite runs instead
 * Bucket untuk test biasanya hanya dibuat saat server start (server.ts), jadi run test yang tidak menjalankan
 * server akan gagal dengan NoSuchBucket. Buat secara eksplisit sekali sebelum seluruh suite berjalan
 */
await ensureBucketExists();
