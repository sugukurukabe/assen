/**
 * 実行時のprojectRootを動的に探索する。src実行(tsx)とdist実行(node dist/src/...)でファイルのネスト深さが異なるため、
 * 固定の相対階層(join(dir, "..", "..", ".."))には依存せず、legal/とpackage.jsonを持つ祖先ディレクトリを探す
 * Dynamically locates the project root at runtime. Since the src (tsx) and dist (node dist/src/...) execution paths
 * differ in file nesting depth, this avoids relying on a fixed number of ".." hops and instead walks up to find an
 * ancestor directory that contains both legal/ and package.json
 * Menemukan root proyek secara dinamis saat runtime. Karena jalur eksekusi src (tsx) dan dist (node dist/src/...)
 * berbeda kedalaman nesting filenya, ini menghindari ketergantungan pada jumlah ".." yang tetap dan malah menyusuri
 * ke atas untuk menemukan direktori leluhur yang berisi baik legal/ maupun package.json
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_ANCESTOR_DEPTH = 10;

let cachedProjectRoot: string | undefined;

export function findProjectRoot(fromFileUrl: string): string {
  if (cachedProjectRoot) {
    return cachedProjectRoot;
  }

  let dir = dirname(fileURLToPath(fromFileUrl));
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
    if (existsSync(join(dir, "legal")) && existsSync(join(dir, "package.json"))) {
      cachedProjectRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    "プロジェクトルート（legal/とpackage.jsonを含む祖先ディレクトリ）が見つかりません / could not locate the project root (an ancestor directory containing legal/ and package.json)",
  );
}
