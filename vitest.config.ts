import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    // 複数のテストファイルが同じローカルPostgresを共有しているため、ファイル並列実行を無効にする。
    // 特にtransactional_outboxはグローバルなFIFOで pending 行を取得するため、並列実行時に他ファイルが
    // 積んだ行を横取りしてdead判定してしまう競合が発生する（test/outbox*.test.ts参照）
    // Disables file-level parallelism because multiple test files share the same local Postgres. In particular,
    // transactional_outbox fetches pending rows in a global FIFO order, so parallel execution can let one file
    // steal and dead-letter rows enqueued by another (see test/outbox*.test.ts)
    // Menonaktifkan paralelisme antar-file karena banyak file test berbagi Postgres lokal yang sama. Khususnya,
    // transactional_outbox mengambil baris pending dalam urutan FIFO global, sehingga eksekusi paralel dapat
    // membuat satu file mengambil dan men-dead-letter baris yang di-enqueue file lain (lihat test/outbox*.test.ts)
    fileParallelism: false,
    // `npm run build`後にdist/test/*.jsが残っていると、vitestの既定excludeだけでは除外し切れず
    // 同じテストがsrcとdist両方から二重実行される場合がある。明示的に除外して確実に1回だけ実行する
    // If dist/test/*.js is left over after `npm run build`, vitest's default excludes are not always
    // enough to skip it, causing the same test to run twice (from src and dist). Exclude it explicitly
    // Jika dist/test/*.js tersisa setelah `npm run build`, exclude default vitest tidak selalu cukup untuk
    // melewatkannya, menyebabkan test yang sama berjalan dua kali (dari src dan dist). Kecualikan secara eksplisit
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
