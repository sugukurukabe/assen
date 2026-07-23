/**
 * テスト実行前に.envを読み込む（ローカル開発用のみ。CIでは環境変数を直接注入する）
 * Loads .env before tests run (local development only; CI injects environment variables directly)
 * Memuat .env sebelum test berjalan (hanya untuk dev lokal; CI menyuntikkan variabel lingkungan langsung)
 *
 * 注意: ここで`src/lib/storage.js`等アプリのモジュールをimportしてはいけない。env.tsのloadEnv()が
 * このファイルの実行時点でキャッシュされてしまい、token-exchange系テストが個別ファイル内で行っている
 * 「beforeAllで環境変数を確定させてから最初のloadEnv呼び出しを行う」という前提が壊れる
 * Note: do not import app modules like `src/lib/storage.js` here. Doing so would trigger env.ts's loadEnv()
 * to cache at this file's execution time, breaking the assumption (used by the token-exchange test files) that
 * env vars are fixed in beforeAll before each file's first loadEnv() call
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
