/**
 * テスト実行前に.envを読み込む（ローカル開発用のみ。CIでは環境変数を直接注入する）
 * Loads .env before tests run (local development only; CI injects environment variables directly)
 * Memuat .env sebelum test berjalan (hanya untuk dev lokal; CI menyuntikkan variabel lingkungan langsung)
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
