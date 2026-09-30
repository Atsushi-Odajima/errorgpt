import { emptyEnvironment, type EnvField, type Environment } from "../schema/report.js";

export const autoField = (v: string | null | undefined): EnvField =>
  v == null || v === "" ? { value: null, source: "unknown" } : { value: String(v), source: "auto" };
export const manualField = (v: string): EnvField => ({ value: v, source: "manual" });
export const inferredField = (v: string): EnvField => ({ value: v, source: "inferred" });

export interface BrowserLike {
  userAgent?: string;
  language?: string;
  onLine?: boolean;
  platform?: string;
  innerWidth?: number;
  innerHeight?: number;
  standalone?: boolean;
  connectionType?: string;
}

/** Capture what a browser/PWA can legitimately know. Nothing here is a device model guess. */
export function captureBrowserEnvironment(b: BrowserLike): Environment {
  const env = emptyEnvironment();
  env.userAgent = autoField(b.userAgent);
  env.locale = autoField(b.language);
  env.viewport = b.innerWidth && b.innerHeight ? autoField(`${b.innerWidth}x${b.innerHeight}`) : env.viewport;
  env.displayMode = b.standalone === undefined ? env.displayMode : autoField(b.standalone ? "pwa-standalone" : "browser");
  env.networkState =
    b.onLine === undefined
      ? env.networkState
      : autoField(`${b.onLine ? "online" : "offline"}${b.connectionType ? ` (${b.connectionType})` : ""}`);
  env.browser = autoField(browserNameFromUA(b.userAgent));
  env.os = autoField(osNameFromUA(b.userAgent));
  env.platform = autoField(b.platform);
  return env;
}

export function browserNameFromUA(ua?: string): string | null {
  if (!ua) return null;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/CriOS\//.test(ua)) return "Chrome (iOS)";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return null;
}

export function osNameFromUA(ua?: string): string | null {
  if (!ua) return null;
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS/iPadOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

export interface NodeLike {
  platform?: string;
  arch?: string;
  release?: string;
  nodeVersion?: string;
}

export function captureNodeEnvironment(n: NodeLike): Environment {
  const env = emptyEnvironment();
  env.platform = autoField(n.platform);
  env.os = autoField(n.platform ? ({ darwin: "macOS", win32: "Windows", linux: "Linux" } as Record<string, string>)[n.platform] ?? n.platform : null);
  env.osVersion = autoField(n.release);
  env.architecture = autoField(n.arch);
  env.sdk = autoField(n.nodeVersion ? `node ${n.nodeVersion}` : null);
  return env;
}

/** Merge manual overrides; manual always wins over auto/unknown. */
export function mergeEnvironment(base: Environment, patch: Partial<Record<keyof Environment, EnvField>>): Environment {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof Environment, EnvField | undefined][]) {
    if (!v) continue;
    if (v.source === "manual" || out[k].source === "unknown" || out[k].source === "inferred") out[k] = v;
  }
  return out;
}

export function environmentLines(env: Environment, lang: "ja" | "en"): string[] {
  const labels: Record<keyof Environment, { ja: string; en: string }> = {
    platform: { ja: "プラットフォーム", en: "Platform" },
    os: { ja: "OS", en: "OS" },
    osVersion: { ja: "OSバージョン", en: "OS version" },
    device: { ja: "端末", en: "Device" },
    architecture: { ja: "アーキテクチャ", en: "Architecture" },
    appVersion: { ja: "アプリバージョン", en: "App version" },
    cliVersion: { ja: "CLIバージョン", en: "CLI version" },
    model: { ja: "モデル", en: "Model" },
    browser: { ja: "ブラウザ", en: "Browser" },
    userAgent: { ja: "User Agent", en: "User agent" },
    viewport: { ja: "ビューポート", en: "Viewport" },
    displayMode: { ja: "表示モード", en: "Display mode" },
    networkState: { ja: "ネットワーク", en: "Network" },
    locale: { ja: "ロケール", en: "Locale" },
    sdk: { ja: "SDK / ランタイム", en: "SDK / runtime" },
    region: { ja: "地域", en: "Region" },
  };
  const unknown = lang === "ja" ? "不明" : "unknown";
  const lines: string[] = [];
  for (const k of Object.keys(labels) as (keyof Environment)[]) {
    const f = env[k];
    if (f.source === "unknown") continue; // omitted: unknown is not "empty"
    const tag = f.source === "inferred" ? (lang === "ja" ? "（推定・要確認）" : " (inferred, unconfirmed)") : "";
    lines.push(`${labels[k][lang]}: ${f.value ?? unknown}${tag}`);
  }
  return lines;
}
