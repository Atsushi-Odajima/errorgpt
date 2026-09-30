export interface IncidentCandidate {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  updatedAt: string | null;
  url: string | null;
  components: string[];
}

export interface StatusLookupResult {
  /** 'unknown' when the feed could not be read; never assert "no incident". */
  state: "ok" | "incidents" | "unknown";
  incidents: IncidentCandidate[];
  pageUrl: string;
  note: { ja: string; en: string };
  checkedAt: string;
}

export interface StatusAdapterConfig {
  pageUrl: string;
  /** Optional JSON feed URL. Left empty until a documented public feed is confirmed (SOURCE_NOTES §6). */
  feedUrl: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const UNKNOWN_NOTE = {
  ja: "公式 status の自動取得はできませんでした。status.openai.com を直接確認してください。status に無くても障害でないとは限りません。",
  en: "Could not read the official status feed automatically. Check status.openai.com directly. Absence from the status page does not mean there is no incident.",
};

/** Read a status feed (Statuspage-style or incident.io-style JSON) and list incidents near a time window. */
export class OpenAIStatusAdapter {
  constructor(private cfg: StatusAdapterConfig) {}

  async incidentsNear(occurredAtIso: string | null, windowHours = 6, now = new Date()): Promise<StatusLookupResult> {
    const checkedAt = now.toISOString();
    if (!this.cfg.feedUrl) return { state: "unknown", incidents: [], pageUrl: this.cfg.pageUrl, note: UNKNOWN_NOTE, checkedAt };
    const f = this.cfg.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 8000);
    try {
      const res = await f(this.cfg.feedUrl, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (!res.ok) return { state: "unknown", incidents: [], pageUrl: this.cfg.pageUrl, note: UNKNOWN_NOTE, checkedAt };
      const json = (await res.json()) as unknown;
      const all = parseIncidents(json);
      const center = occurredAtIso ? new Date(occurredAtIso).getTime() : now.getTime();
      const w = windowHours * 3600_000;
      const near = all.filter((i) => {
        const s = i.startedAt ? new Date(i.startedAt).getTime() : NaN;
        const u = i.updatedAt ? new Date(i.updatedAt).getTime() : s;
        if (Number.isNaN(s)) return true;
        return s - w <= center && center <= (Number.isNaN(u) ? s : u) + w;
      });
      return {
        state: near.length ? "incidents" : "ok",
        incidents: near,
        pageUrl: this.cfg.pageUrl,
        note: near.length
          ? { ja: "報告時刻付近に既知の障害候補があります。関連の可能性はありますが、確定ではありません。報告は続けられます。", en: "Possible known incidents near the time. This may be related but is not confirmed. You can still report." }
          : { ja: "取得できた範囲では該当時刻の障害は見つかりませんでした（障害が無いことの証明ではありません）。", en: "No incidents found near that time in the feed (this does not prove there was none)." },
        checkedAt,
      };
    } catch {
      return { state: "unknown", incidents: [], pageUrl: this.cfg.pageUrl, note: UNKNOWN_NOTE, checkedAt };
    } finally {
      clearTimeout(t);
    }
  }
}

export function parseIncidents(json: unknown): IncidentCandidate[] {
  const j = json as Record<string, unknown>;
  const list: unknown[] = Array.isArray(j?.incidents) ? (j.incidents as unknown[]) : Array.isArray(j?.ongoing_incidents) ? (j.ongoing_incidents as unknown[]) : Array.isArray(j?.data) ? (j.data as unknown[]) : [];
  return list.map((x) => {
    const i = x as Record<string, unknown>;
    return {
      id: String(i.id ?? ""),
      name: String(i.name ?? i.title ?? ""),
      status: String(i.status ?? i.current_status ?? ""),
      startedAt: (i.started_at ?? i.created_at ?? null) as string | null,
      updatedAt: (i.updated_at ?? i.resolved_at ?? null) as string | null,
      url: (i.shortlink ?? i.url ?? null) as string | null,
      components: Array.isArray(i.components) ? (i.components as Record<string, unknown>[]).map((c) => String(c.name ?? c)) : [],
    };
  });
}
