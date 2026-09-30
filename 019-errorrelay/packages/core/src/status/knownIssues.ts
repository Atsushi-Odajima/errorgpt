export interface KnownIssueCandidate {
  source: "github" | "help" | "status";
  title: string;
  url: string;
  /** 0..1 overlap score; shown as "possible", never "duplicate". */
  similarity: number;
  state: string;
}

export interface KnownIssueSearchConfig {
  fetchImpl?: typeof fetch;
  githubRepo?: string; // owner/repo
  timeoutMs?: number;
}

const STOP = new Set(["the", "a", "an", "to", "of", "in", "on", "and", "or", "is", "it", "with", "for", "at", "が", "を", "に", "は", "の", "で", "と", "た", "て"]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9぀-ヿ一-龯]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

/** Search public GitHub issues (read-only, unauthenticated). Returns candidates; empty on any failure. */
export async function searchGitHubIssues(query: string, cfg: KnownIssueSearchConfig = {}): Promise<KnownIssueCandidate[]> {
  const repo = cfg.githubRepo ?? "openai/codex";
  const f = cfg.fetchImpl ?? fetch;
  const q = encodeURIComponent(`repo:${repo} is:issue ${tokenize(query).slice(0, 8).join(" ")}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 8000);
  try {
    const res = await f(`https://api.github.com/search/issues?q=${q}&per_page=10`, { signal: ctrl.signal, headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: { title: string; html_url: string; state: string }[] };
    return (data.items ?? []).map((i) => ({ source: "github" as const, title: i.title, url: i.html_url, similarity: similarity(query, i.title), state: i.state })).sort((a, b) => b.similarity - a.similarity);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export const KNOWN_ISSUE_NOTE = {
  ja: "類似の既知の問題の候補です。同一とは限りません。報告はそのまま続けられます。",
  en: "Possible similar known issues. Not necessarily the same problem. You can continue reporting.",
};
