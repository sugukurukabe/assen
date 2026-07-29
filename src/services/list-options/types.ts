/**
 * Slack Workflow Builderのdynamic optionsへ渡す最小選択肢レスポンス。
 * Minimal option-list response for Slack Workflow Builder dynamic options.
 * Respons daftar opsi minimal untuk dynamic options Slack Workflow Builder.
 */
export interface ListOptionItem {
  value: string;
  label: string;
}

export interface ListOptionsResult {
  items: ListOptionItem[];
  total: number;
  truncated: boolean;
}

export function normalizeListQuery(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
}

export function clampListLimit(limit?: number): number {
  return Math.min(limit ?? 50, 100);
}

export function toListOptionsResult(items: ListOptionItem[], total: number, limit: number): ListOptionsResult {
  return {
    items: items.slice(0, limit),
    total,
    truncated: total > limit,
  };
}

export function matchesListQuery(query: string | undefined, values: Array<string | undefined>): boolean {
  const normalizedQuery = normalizeListQuery(query ?? "");
  if (!normalizedQuery) {
    return true;
  }
  return values.some((value) => normalizeListQuery(value ?? "").includes(normalizedQuery));
}
