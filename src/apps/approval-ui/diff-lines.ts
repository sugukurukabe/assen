/**
 * 前版との差分表示用の最小限の行単位diff。外部依存を持たず、承認画面（sandboxed iframe）内で完結させる
 * Minimal line-based diff for showing the delta against the previous version. No external dependency, so it
 * stays self-contained inside the approval screen's sandboxed iframe
 * Diff berbasis baris minimal untuk menampilkan delta terhadap versi sebelumnya. Tanpa dependensi eksternal,
 * sehingga tetap mandiri di dalam sandboxed iframe layar persetujuan
 */
export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * LCSベースの単純な行diff（大きな入力は想定しない：1書類=数十行のテンプレート出力のみが対象）
 * Simple LCS-based line diff (not designed for huge inputs: only targets a few dozen template-output lines per document)
 * Diff baris berbasis LCS sederhana (tidak dirancang untuk input besar: hanya menargetkan beberapa puluh baris output template per dokumen)
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const n = beforeLines.length;
  const m = afterLines.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = beforeLines[i] === afterLines[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      result.push({ kind: "same", text: beforeLines[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ kind: "removed", text: beforeLines[i]! });
      i += 1;
    } else {
      result.push({ kind: "added", text: afterLines[j]! });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ kind: "removed", text: beforeLines[i]! });
    i += 1;
  }
  while (j < m) {
    result.push({ kind: "added", text: afterLines[j]! });
    j += 1;
  }
  return result;
}
