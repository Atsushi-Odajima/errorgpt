import { PRODUCT_LABELS, STATUS_LABELS, IMAGE_MANUAL_CHECKLIST, readJpegExifDateTime, detectImageType, redactDoctorOutput, parseApiError, minimalReproduction, searchGitHubIssues, similarity, generateReport, type Report, type ProductId, type ChannelInfo, type SubmissionPreview } from "@errorrelay/core";
import { LocalBackend, ServerBackend, browserEnvironment, type Backend, type Lang } from "./backend.js";
import { Redactor } from "./redactor.js";
import { t as tr } from "./i18n.js";

/* ---------- state & settings ---------- */
interface Settings { lang: Lang; mode: "local" | "server"; serverUrl: string; token: string; timezone: string; aiConsent: boolean; companionUrl: string; companionToken: string }
const DEFAULTS: Settings = { lang: (navigator.language.startsWith("ja") ? "ja" : "en"), mode: "local", serverUrl: location.origin, token: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", aiConsent: false, companionUrl: "http://127.0.0.1:8790", companionToken: "" };
function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("errorrelay.settings") ?? "{}") }; } catch { return { ...DEFAULTS }; }
}
let settings = loadSettings();
function saveSettings() { localStorage.setItem("errorrelay.settings", JSON.stringify(settings)); }
let backend: Backend = makeBackend();
function makeBackend(): Backend { return settings.mode === "server" && settings.token ? new ServerBackend(settings.serverUrl, settings.token) : new LocalBackend(); }
async function companion<T>(path: string, method: "GET" | "POST" = "POST", body?: unknown): Promise<T> {
  if (!settings.companionToken) throw new Error(L() === "ja" ? "設定で Companion のトークンを入力してください" : "Enter the Companion token in Settings");
  const res = await fetch(`${settings.companionUrl.replace(/\/$/, "")}${path}`, { method, headers: { authorization: `Bearer ${settings.companionToken}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}
function b64ToBytes(b64: string): Uint8Array { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const t = (k: Parameters<typeof tr>[1]) => tr(settings.lang, k);
const L = () => settings.lang;

/* ---------- tiny DOM helpers ---------- */
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "dataset") Object.assign(el.dataset, v as Record<string, string>);
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
const main = document.getElementById("main")!;
let navSeq = 0;
function render(nav: number, ...nodes: Child[]) { if (nav !== navSeq) return; main.replaceChildren(); for (const n of nodes) if (n) main.append(n instanceof Node ? n : document.createTextNode(n)); if (nav > 1) main.focus(); }
function toast(msg: string) { const el = document.getElementById("toast")!; el.textContent = msg; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2500); }
function rc(el: Element, ...nodes: Child[]) { el.replaceChildren(...nodes.filter((n): n is Node | string => n !== null && n !== undefined && n !== false)); }
function notice(kind: "warn" | "err" | "ok" | "info", text: string) { return h("div", { class: `notice ${kind}`, role: kind === "err" ? "alert" : undefined }, text); }
function field(labelText: string, input: HTMLElement, hint?: string) { const id = input.id || `f_${Math.random().toString(36).slice(2)}`; input.id = id; return h("label", { for: id }, labelText, hint ? h("span", { class: "hint" }, ` ${hint}`) : null, input); }
function download(name: string, bytes: Uint8Array | string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type }); const url = URL.createObjectURL(blob); const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stepsBar(cur: 1 | 2 | 3, id: string) {
  return h("div", { class: "steps", role: "list" }, ...([1, 2, 3] as const).map((n) => h("span", { role: "listitem", "aria-current": n === cur ? "step" : undefined }, h("a", { href: `#/r/${id}/${n}`, style: "color:inherit;text-decoration:none" }, t(`step${n}` as "step1")))));
}
function statusTag(r: Report) { return h("span", { class: `tag${r.localOnly ? " local" : ""}` }, STATUS_LABELS[r.status][L()], r.localOnly ? ` · ${t("localOnly")}` : ` · ${t("serverSaved")}`); }

/* ---------- router ---------- */
async function route() {
  const nav = ++navSeq;
  const hash = location.hash || "#/";
  const [path, qs] = hash.slice(1).split("?");
  const q = new URLSearchParams(qs ?? "");
  const parts = path!.split("/").filter(Boolean);
  try {
    if (parts.length === 0) return home(nav);
    if (parts[0] === "new") return newReport((q.get("mode") ?? "text") as "screenshot" | "text" | "codex");
    if (parts[0] === "history") return history(nav);
    if (parts[0] === "settings") return settingsView(nav);
    if (parts[0] === "r" && parts[1]) {
      const r = await backend.get(parts[1]);
      if (parts[2] === "1") return step1(r, nav);
      if (parts[2] === "2") return step2(r, nav);
      if (parts[2] === "3") return step3(r, nav);
      return detail(r, nav);
    }
    home(nav);
  } catch (e) {
    render(nav, h("h1", {}, "Error"), notice("err", (e as Error).message), h("a", { href: "#/", class: "btn" }, "Home"));
  }
}
addEventListener("hashchange", route);
document.getElementById("lang")!.addEventListener("click", () => { settings.lang = settings.lang === "ja" ? "en" : "ja"; saveSettings(); applyChrome(); route(); });
function applyChrome() {
  document.documentElement.lang = settings.lang;
  document.getElementById("lang")!.textContent = settings.lang === "ja" ? "EN" : "日本語";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n as "settings")));
}

/* ---------- views ---------- */
function home(nav: number) {
  render(nav,
    h("h1", {}, "ErrorRelay"), h("p", { class: "lead" }, t("tagline")),
    h("div", { class: "grid" },
      h("a", { class: "btn primary bigbtn", href: "#/new?mode=screenshot", id: "home-screenshot" }, t("fromScreenshot")),
      h("a", { class: "btn bigbtn", href: "#/new?mode=text", id: "home-text" }, t("fromText")),
      h("a", { class: "btn bigbtn", href: "#/new?mode=codex", id: "home-codex" }, t("fromCodex")),
      h("a", { class: "btn bigbtn", href: "#/history", id: "home-history" }, t("history"))),
    h("div", { class: "steps", "aria-hidden": "true" }, h("span", {}, t("step1")), h("span", {}, t("step2")), h("span", {}, t("step3"))),
    h("p", { class: "small" }, t("noGuarantee")),
    h("p", { class: "small" }, `${t("mode")}: ${settings.mode === "server" ? t("modeServer") : t("modeLocal")}`),
  );
}

async function newReport(mode: "screenshot" | "text" | "codex") {
  const r = await backend.create({ language: L(), product: mode === "codex" ? "codex_cli" : undefined });
  sessionStorage.setItem(`mode.${r.id}`, mode);
  location.hash = `#/r/${r.id}/1`;
}

async function fileToBytes(f: File) { return new Uint8Array(await f.arrayBuffer()); }

async function step1(r: Report, nav: number) {
  const mode = sessionStorage.getItem(`mode.${r.id}`) ?? "text";
  const errorText = h("textarea", { id: "errorText", rows: 6 }, r.errorText);
  const timeInput = h("input", { type: "text", id: "occurredText", placeholder: "2026-09-30 13:44", value: r.occurredAt ? r.occurredAt.display.slice(0, 16) : "" });
  const tzInput = h("input", { type: "text", id: "timezone", value: r.occurredAt?.timezone ?? settings.timezone, list: "tzlist" });
  const tzList = h("datalist", { id: "tzlist" }, ...["Asia/Tokyo", "UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Australia/Sydney"].map((z) => h("option", { value: z })));
  const product = h("select", { id: "product" }, ...(Object.keys(PRODUCT_LABELS) as ProductId[]).map((p) => h("option", { value: p, selected: r.product === p }, PRODUCT_LABELS[p][L()])));
  const occurredInfo = h("div", { id: "occurredInfo", class: "small" }, r.occurredAt ? `${t("occurred")}: ${r.occurredAt.display}` : "");
  const attachList = h("ul", { class: "check", id: "attachments" });
  const capturedHint = h("div", {});
  const renderAttachments = (rep: Report) => { attachList.replaceChildren(...rep.attachments.map((a) => h("li", {}, h("span", { class: "st" }, a.kind), `${a.fileName} (${Math.round(a.sizeBytes / 1024)} KB)`, a.exifStripped ? h("span", { class: "tag" }, "EXIF removed") : null, a.redacted ? h("span", { class: "tag" }, "redacted") : null))); };
  renderAttachments(r);
  async function addImage(file: File) {
    const bytes = await fileToBytes(file);
    const type = detectImageType(bytes);
    if (type === "unknown") return toast("Unsupported image");
    const exif = readJpegExifDateTime(bytes);
    const mime = type === "jpeg" ? "image/jpeg" : `image/${type}`;
    const res = await backend.addAttachment(r.id, { fileName: file.name || `screenshot.${type}`, mimeType: mime, bytes });
    r = res.report;
    renderAttachments(r);
    if (exif) {
      rc(capturedHint, notice("info", `${t("capturedHint")}: ${exif} (${t("timezone")}: ?)`), h("button", { type: "button", onclick: () => { timeInput.value = exif.replace(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}).*/, "$1-$2-$3 $4:$5"); toast(t("useAsOccurred")); } }, t("useAsOccurred")));
    }
    toast(`${file.name || "image"} ✓`);
  }
  const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", id: "file", multiple: true, onchange: async (e: Event) => { for (const f of Array.from((e.target as HTMLInputElement).files ?? [])) await addImage(f); } });
  const drop = h("div", { class: "dropzone", id: "dropzone", tabindex: 0, role: "button", "aria-label": t("drop"),
    ondragover: (e: DragEvent) => { e.preventDefault(); drop.classList.add("over"); }, ondragleave: () => drop.classList.remove("over"),
    ondrop: async (e: DragEvent) => { e.preventDefault(); drop.classList.remove("over"); for (const f of Array.from(e.dataTransfer?.files ?? [])) if (f.type.startsWith("image/")) await addImage(f); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } }, onclick: () => fileInput.click() },
    h("p", {}, t("drop")), h("button", { type: "button", onclick: (e: Event) => { e.stopPropagation(); fileInput.click(); } }, t("choose")));
  const companionRow = h("details", {}, h("summary", {}, "Desktop Companion"),
    h("div", { class: "row" },
      h("button", { type: "button", id: "compClip", onclick: async () => { try { const j = await companion<{ mimeType: string; base64: string }>("/clipboard-image"); await addImage(new File([b64ToBytes(j.base64) as BlobPart], `clipboard.${j.mimeType.split("/")[1]}`, { type: j.mimeType })); } catch (e) { toast((e as Error).message); } } }, L() === "ja" ? "クリップボードの画像を取り込む" : "Import clipboard image"),
      (() => { const pathIn = h("input", { type: "text", placeholder: L() === "ja" ? "ログファイルの絶対パス" : "Absolute path of a log file", id: "compPath" }); return h("span", { style: "display:contents" }, pathIn, h("button", { type: "button", id: "compFile", onclick: async () => { try { const j = await companion<{ fileName: string; mimeType: string; text?: string; base64?: string; findingsCount: number }>("/file", "POST", { path: pathIn.value }); const bytes = j.base64 ? b64ToBytes(j.base64) : new TextEncoder().encode(j.text ?? ""); const res = await backend.addAttachment(r.id, { fileName: j.fileName, mimeType: j.mimeType, bytes, redactedFrom: j.text ? "companion-redacted" : null }); r = res.report; renderAttachments(r); toast(`${j.fileName} (${j.findingsCount} redacted)`); } catch (e) { toast((e as Error).message); } } }, L() === "ja" ? "ログを取り込む（マスク済み）" : "Import log (redacted)")); })(),
      mode === "codex" ? h("button", { type: "button", id: "compCodexVersion", onclick: async () => { try { const j = await companion<{ ok: boolean; version: string | null; error: string | null }>("/codex/version"); if (j.version) { r = await backend.update(r.id, { environment: { cliVersion: j.version } }); toast(`codex ${j.version}`); } else toast(j.error ?? "codex not found"); } catch (e) { toast((e as Error).message); } } }, "codex --version") : null,
      mode === "codex" ? h("button", { type: "button", id: "compCodexDoctor", onclick: async () => { try { const j = await companion<{ ok: boolean; redactedJson?: string; findingsCount?: number; note?: string; error?: string }>("/codex/doctor"); if (!j.ok) return toast(j.note ?? j.error ?? "unavailable"); if (confirm((L() === "ja" ? "マスク済み診断レポートを添付しますか？\n\n" : "Attach the redacted diagnostic report?\n\n") + j.redactedJson!.slice(0, 1500))) { const res = await backend.addAttachment(r.id, { fileName: "codex_doctor_redacted.json", mimeType: "application/json", bytes: new TextEncoder().encode(j.redactedJson), redactedFrom: "companion-redacted" }); r = res.report; renderAttachments(r); toast("✓"); } } catch (e) { toast((e as Error).message); } } }, "codex doctor --json") : null),
    h("p", { class: "small" }, L() === "ja" ? "Companion は自分で起動したときだけ動作し、ボタンを押した操作のみ実行します（read-only）。" : "The Companion runs only when you start it and executes only the actions you click (read-only)."));
  document.onpaste = async (e) => { for (const item of Array.from(e.clipboardData?.items ?? [])) if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) await addImage(f); } };
  const save = async () => {
    const patch: Parameters<Backend["update"]>[1] = { errorText: errorText.value, product: product.value as ProductId, timezone: tzInput.value };
    if (timeInput.value.trim()) patch.occurredAt = { text: timeInput.value.trim(), timezone: tzInput.value.trim() || "UTC" };
    r = await backend.update(r.id, patch);
    occurredInfo.textContent = r.occurredAt ? `${t("occurred")}: ${r.occurredAt.display}` : "";
    return r;
  };
  render(nav,
    h("h1", {}, t("step1")), stepsBar(1, r.id), statusTag(r),
    mode !== "text" ? h("section", {}, drop, fileInput, capturedHint, attachList) : h("details", {}, h("summary", {}, t("fromScreenshot")), drop, fileInput, capturedHint, attachList),
    companionRow,
    field(t("errorText"), errorText),
    h("h2", {}, t("occurred")),
    h("div", { class: "row" }, h("button", { type: "button", id: "nowBtn", class: "primary", onclick: async () => { r = await backend.update(r.id, { occurredAt: "now", timezone: tzInput.value || settings.timezone }); timeInput.value = r.occurredAt!.display.slice(0, 16); occurredInfo.textContent = `${t("occurred")}: ${r.occurredAt!.display}`; toast(r.occurredAt!.display); } }, t("now"))),
    field(t("manualTime"), timeInput), field(t("timezone"), tzInput), tzList, occurredInfo,
    field(t("product"), product),
    h("div", { class: "row" }, h("a", { class: "btn", href: "#/" }, t("back")), h("button", { type: "button", class: "primary", id: "next1", onclick: async () => { try { await save(); location.hash = `#/r/${r.id}/2`; } catch (e) { toast((e as Error).message); } } }, t("next"))),
  );
}

async function step2(r: Report, nav: number) {
  const desc = h("textarea", { id: "description", rows: 4 }, r.description);
  const steps = h("textarea", { id: "steps", rows: 6 }, r.steps.join("\n"));
  const expected = h("input", { type: "text", id: "expected", value: r.expected });
  const actual = h("input", { type: "text", id: "actual", value: r.actual });
  const proposal = h("div", { id: "proposal" });
  const freq = h("select", { id: "frequency" }, ...(["unknown", "first_time", "sometimes", "always"] as const).map((f) => h("option", { value: f, selected: r.frequency === f }, t(f))));
  const retried = h("select", { id: "retried" }, h("option", { value: "", selected: r.retried === null }, t("unknown")), h("option", { value: "yes", selected: r.retried === true }, t("yes")), h("option", { value: "no", selected: r.retried === false }, t("no")));
  const envFields = (["device", "os", "osVersion", "appVersion", "model", "browser"] as const).map((k) => ({ k, input: h("input", { type: "text", id: `env_${k}`, value: r.environment[k].value ?? "", placeholder: r.environment[k].source === "unknown" ? t("unknown") : "" }) }));
  const envAutoInfo = h("div", { class: "small", id: "envAuto" });
  const triedItems = L() === "ja" ? ["ページ更新／新規チャット", "status.openai.com を確認", "キャッシュ／Cookie 削除", "シークレットウィンドウ", "拡張機能を無効化", "VPN／セキュアDNS を無効化", "別ネットワークで再試行", "別端末／ブラウザで再試行", "アプリ再起動", "アプリ更新"] : ["Refreshed / new chat", "Checked status.openai.com", "Cleared cache/cookies", "Incognito window", "Disabled extensions", "Disabled VPN / secure DNS", "Tried another network", "Tried another device/browser", "Restarted the app", "Updated the app"];
  const triedBoxes = triedItems.map((label) => h("input", { type: "checkbox", value: label, checked: r.troubleshootingTried.includes(label) }));
  const scanOut = h("div", { id: "scanOut" });
  const keepCats = new Set<string>(r.redaction?.keptCategories ?? []);
  const analysisOut = h("div", { id: "analysisOut" });
  const shots = r.attachments.filter((a) => (a.kind === "screenshot" || a.kind === "image") && !a.redacted);
  const aiConsent = h("input", { type: "checkbox", id: "aiConsent", checked: settings.aiConsent });
  const collect = () => ({ description: desc.value, steps: steps.value.split("\n").map((s) => s.trim()).filter(Boolean), expected: expected.value, actual: actual.value, frequency: freq.value as Report["frequency"], retried: retried.value === "" ? null : retried.value === "yes", troubleshootingTried: triedBoxes.filter((b) => b.checked).map((b) => b.value), environment: Object.fromEntries(envFields.map(({ k, input }) => [k, input.value.trim() || null])) });
  const save = async () => (r = await backend.update(r.id, collect()));

  async function propose() {
    await save();
    const p = await backend.repro(r.id, desc.value);
    rc(proposal, h("div", { class: "card" }, h("strong", {}, `${t("proposeSteps")} (${p.steps.length})`), h("ol", {}, ...p.steps.map((s) => h("li", {}, s))), p.expected ? h("p", {}, `${t("expected")}: ${p.expected}`) : null, p.actual ? h("p", {}, `${t("actual")}: ${p.actual}`) : null, p.questions.length ? h("ul", {}, ...p.questions.map((q) => h("li", {}, "❓ " + q))) : null,
      h("button", { type: "button", id: "applyProposal", onclick: () => { if (p.steps.length) steps.value = p.steps.join("\n"); if (p.expected && !expected.value) expected.value = p.expected; if (p.actual && !actual.value) actual.value = p.actual; toast(t("apply")); } }, t("apply"))));
  }
  async function scan() {
    await save();
    const text = [r.summary, r.description, r.errorText, r.expected, r.actual, r.additionalNotes, ...r.steps].join("\n");
    const res = await backend.scan(text);
    const byCat = new Map<string, number>();
    for (const f of res.findings) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
    if (res.findings.length === 0) r = (await backend.redact(r.id, [...keepCats])).report; // records that the scan ran clean
    rc(scanOut,
      notice(res.findings.length ? "warn" : "ok", res.findings.length ? `${res.findings.length} ${t("found")}` : t("none")),
      h("p", { class: "small" }, t("scanDisclaimer")),
      h("ul", { class: "check" }, ...[...byCat].map(([cat, n]) => { const cb = h("input", { type: "checkbox", id: `keep_${cat}`, checked: keepCats.has(cat), onchange: () => (cb.checked ? keepCats.add(cat) : keepCats.delete(cat)) }); return h("li", {}, h("span", { class: "st" }, `${cat} ×${n}`), h("label", { for: cb.id, style: "margin:0;font-weight:400" }, cb, ` ${t("keep")}`)); })),
      res.findings.length ? h("button", { type: "button", id: "redactBtn", class: "primary", onclick: async () => { const out = await backend.redact(r.id, [...keepCats]); r = out.report; steps.value = r.steps.join("\n"); expected.value = r.expected; actual.value = r.actual; desc.value = r.description; toast(`${t("redactAll")}: ${out.findingsCount}`); scan(); } }, t("redactAll")) : null,
    );
  }
  async function analyze(attId: string) {
    if (!aiConsent.checked) return toast(t("aiConsent"));
    settings.aiConsent = true; saveSettings();
    const out = await backend.analyze(r.id, attId);
    r = out.report;
    if (out.manualFallback) analysisOut.replaceChildren(notice("warn", out.note || t("manualFallback")));
    else rc(analysisOut,
      h("h3", {}, t("observed")), h("ul", {}, ...r.analysis!.observed.map((o) => h("li", {}, `${o.field}: ${o.value}`))),
      h("h3", {}, t("inferred")), h("ul", {}, ...r.analysis!.inferred.map((i) => h("li", {}, `${i.field}: ${i.value} (${i.confidence}) — ${i.reason} `))),
      out.errorTextCandidate ? h("pre", {}, out.errorTextCandidate) : null,
    );
  }
  const imgSection = h("section", { id: "imgRedact" });
  if (shots.length) {
    const canvas = h("canvas", { "aria-label": t("imageRedact") });
    const red = new Redactor(canvas);
    const boxList = h("ul", { class: "boxes" });
    red.onChange = () => boxList.replaceChildren(...red.boxes.map((b, i) => h("li", {}, `#${i + 1} (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`, h("button", { type: "button", onclick: () => red.select(i) }, "select"), h("button", { type: "button", onclick: () => red.remove(i) }, "✕"))));
    let cur = shots[0]!;
    const sel = h("select", { onchange: async () => { cur = shots.find((s) => s.id === sel.value)!; await red.load(await backend.attachmentBytes(r.id, cur.id), cur.mimeType); red.onChange(); } }, ...shots.map((s) => h("option", { value: s.id }, s.fileName)));
    red.load(await backend.attachmentBytes(r.id, cur.id), cur.mimeType).then(() => red.onChange());
    imgSection.append(
      h("h2", {}, t("imageRedact")), h("p", { class: "small" }, t("imageRedactHelp")), sel,
      h("div", { class: "row" }, h("label", { style: "margin:0" }, aiConsent, ` ${t("aiConsent")}`), h("button", { type: "button", id: "analyzeBtn", onclick: () => analyze(cur.id) }, t("analyze"))), analysisOut,
      h("div", { class: "canvaswrap" }, canvas), boxList,
      h("div", { class: "row" },
        h("button", { type: "button", id: "addBox", onclick: () => red.addCenteredBox() }, t("addBox")),
        h("button", { type: "button", id: "saveRedacted", class: "primary", onclick: async () => { const bytes = await red.exportPng(); const res = await backend.addAttachment(r.id, { fileName: `redacted_${cur.fileName.replace(/\.[^.]+$/, "")}.png`, mimeType: "image/png", bytes, redactedFrom: cur.id }); r = res.report; toast(t("saveRedacted") + " ✓"); } }, t("saveRedacted")),
        h("button", { type: "button", onclick: async () => { const b = red.boxes[red.selected]; if (!b) return toast(t("addBox")); const bytes = await red.cropPng(b); const res = await backend.addAttachment(r.id, { fileName: `cropped_${cur.fileName.replace(/\.[^.]+$/, "")}.png`, mimeType: "image/png", bytes, redactedFrom: cur.id }); r = res.report; toast("✓"); } }, t("cropSave"))),
      h("h3", {}, t("imageChecklist")), h("ul", { class: "check" }, ...IMAGE_MANUAL_CHECKLIST.map((c) => { const cb = h("input", { type: "checkbox", id: `chk_${c.id}` }); return h("li", {}, cb, h("label", { for: cb.id, style: "margin:0;font-weight:400" }, c[L()])); })),
    );
  }
  const auto = browserEnvironment();
  envAutoInfo.textContent = Object.entries(auto).filter(([, f]) => f.source === "auto").map(([k, f]) => `${k}=${f.value}`).join(" · ");
  render(nav,
    h("h1", {}, t("step2")), stepsBar(2, r.id), statusTag(r),
    field(t("description"), desc), h("div", { class: "row" }, h("button", { type: "button", id: "proposeBtn", onclick: propose }, t("proposeSteps"))), proposal,
    field(t("steps"), steps), field(t("expected"), expected), field(t("actual"), actual),
    h("div", { class: "row" }, field(t("frequency"), freq), field(t("retried"), retried)),
    h("h2", {}, t("env")), h("p", { class: "small" }, t("envHint")),
    h("div", { class: "row" }, h("button", { type: "button", id: "envCompanionBtn", onclick: async () => { try { const j = await companion<{ environment: Record<string, { value: string | null; source: string }> }>("/env", "GET"); const patch: Record<string, string | null> = {}; for (const [k, f] of Object.entries(j.environment)) if (f.source === "auto" && f.value) patch[k] = f.value; r = await backend.update(r.id, { environment: patch }); for (const { k, input } of envFields) if (!input.value && r.environment[k].value) input.value = r.environment[k].value!; toast("Companion ✓"); } catch (e) { toast((e as Error).message); } } }, L() === "ja" ? "Companion から OS 情報を取得" : "Get OS info from Companion"), h("button", { type: "button", id: "envAutoBtn", onclick: async () => { r = await (backend as LocalBackend | ServerBackend).update(r.id, { environment: Object.fromEntries(Object.entries(auto).filter(([, f]) => f.source === "auto").map(([k, f]) => [k, f.value])) }); for (const { k, input } of envFields) if (!input.value && r.environment[k].value) input.value = r.environment[k].value!; toast(t("envAuto") + " ✓"); } }, t("envAuto"))), envAutoInfo,
    ...envFields.map(({ k, input }) => field(t(k as "device"), input)),
    h("h2", {}, t("tried")), h("ul", { class: "check" }, ...triedBoxes.map((b, i) => { b.id = `tried_${i}`; return h("li", {}, b, h("label", { for: b.id, style: "margin:0;font-weight:400" }, triedItems[i]!)); })),
    h("h2", {}, t("scan")), h("div", { class: "row" }, h("button", { type: "button", id: "scanBtn", onclick: scan }, t("scan"))), scanOut,
    imgSection,
    h("div", { class: "row" }, h("a", { class: "btn", href: `#/r/${r.id}/1` }, t("back")), h("button", { type: "button", class: "primary", id: "next2", onclick: async () => { try { await save(); location.hash = `#/r/${r.id}/3`; } catch (e) { toast((e as Error).message); } } }, t("next"))),
  );
}

async function step3(r: Report, nav: number) {
  const fmt = h("select", { id: "fmt" }, ...["short", "detailed", "developer", "json", "diagnostic"].map((f) => h("option", { value: f }, f)));
  const lang = h("select", { id: "plang" }, h("option", { value: "ja", selected: L() === "ja" }, "日本語"), h("option", { value: "en", selected: L() === "en" }, "English"));
  const pre = h("pre", { id: "previewText", tabindex: 0 });
  const qualityOut = h("ul", { class: "check", id: "quality" });
  const channelsOut = h("div", { id: "channels" });
  const confirmOut = h("div", { id: "confirm" });
  let previewed = false;
  const refreshPreview = async () => { pre.textContent = await backend.render(r.id, fmt.value as "short", lang.value as Lang); previewed = true; refreshQuality(); };
  const refreshQuality = async () => {
    const q = await backend.quality(r.id, previewed);
    qualityOut.replaceChildren(...q.items.map((i) => h("li", {}, h("span", { class: "st", "aria-label": i.status }, i.status === "ok" ? `✓ ${t("ok")}` : i.status === "warn" ? `△ ${t("warn")}` : `✗ ${t("missing")}`), i.label[L()], i.detail ? h("span", { class: "small" }, ` (${i.detail})`) : null)));
  };
  fmt.onchange = refreshPreview; lang.onchange = refreshPreview;
  async function showChannels() {
    const chans = await backend.channels(r.id);
    rc(channelsOut, ...chans.map((c) => h("div", { class: "card" }, h("h3", {}, c.name[L()]), h("p", {}, h("span", { class: "tag" }, `${t("capability")}: ${c.capability}`), ` verified ${c.verifiedAt}`), h("ul", {}, ...c.instructions[L()].map((s) => h("li", {}, s))), c.caveats[L()].length ? h("details", {}, h("summary", {}, "⚠ " + (L() === "ja" ? "注意" : "Caveats")), h("ul", {}, ...c.caveats[L()].map((s) => h("li", {}, s)))) : null,
      c.capability !== "UNAVAILABLE" ? h("button", { type: "button", class: "primary", dataset: { adapter: c.adapterId }, onclick: () => prepare(c) }, t("prepare")) : null)));
  }
  async function prepare(c: ChannelInfo) {
    try {
      if (r.status === "draft") r = await backend.ready(r.id);
      const res = await backend.preview(r.id, c.adapterId, L());
      showConfirm(res.preview, res.unresolvedFindings, c);
    } catch (e) { toast((e as Error).message); }
  }
  function showConfirm(p: SubmissionPreview, unresolved: { category: string }[], c: ChannelInfo) {
    const pii = Object.entries(p.personalDataSummary).map(([k, v]) => `${k}: ${v}`).join(", ") || "-";
    rc(confirmOut, h("section", { class: "card", role: "dialog", "aria-labelledby": "confirmTitle", "aria-modal": "false" },
      h("h2", { id: "confirmTitle" }, t("confirmTitle")),
      unresolved.length ? notice("err", `${t("unresolved")} (${unresolved.map((u) => u.category).join(", ")})`) : null,
      h("table", {}, h("tr", {}, h("th", {}, t("destination")), h("td", {}, p.destination)), h("tr", {}, h("th", {}, t("capability")), h("td", {}, p.capability)), h("tr", {}, h("th", {}, t("attachments")), h("td", {}, p.attachmentNames.join(", ") || "-")), h("tr", {}, h("th", {}, t("pii")), h("td", {}, pii, p.keptCategories.length ? ` / kept: ${p.keptCategories.join(", ")}` : "")), h("tr", {}, h("th", {}, t("identity")), h("td", {}, p.identity))),
      h("h3", {}, t("body")), h("pre", {}, p.bodyText),
      p.capability !== "DIRECT" ? notice("info", t("handoffDone")) : null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", id: "confirmBtn", disabled: unresolved.length > 0, onclick: async () => {
          const key = `pwa_${r.id}_${p.confirmationToken}`;
          const res = await backend.submit(r.id, p.confirmationToken, key);
          r = res.report; toast(res.message[L()]);
          rc(confirmOut, h("section", { class: "card" }, notice(res.report.status === "submitted" ? "ok" : "info", res.message[L()]), h("p", {}, statusTag(r)),
            h("div", { class: "row" }, p.prepared.prefillUrl ? h("a", { class: "btn primary", id: "openChannel", href: p.prepared.prefillUrl, target: "_blank", rel: "noopener noreferrer" }, t("openChannel")) : null, h("button", { type: "button", id: "copyBody", onclick: async () => { await navigator.clipboard.writeText(p.bodyText); toast(t("copied")); } }, t("copyBody"))),
            p.prepared.formFields.length ? h("details", {}, h("summary", {}, "Form fields"), h("table", {}, ...p.prepared.formFields.map((f) => h("tr", {}, h("th", {}, f.label), h("td", {}, h("pre", {}, f.value)))))) : null,
            res.report.status === "handoff_prepared" ? (() => { const tk = h("input", { type: "text", id: "ticketId", placeholder: t("ticketId") }); return h("div", { class: "row" }, tk, h("button", { type: "button", id: "markSent", onclick: async () => { r = await backend.markSent(r.id, res.submissionId, tk.value || null); toast(STATUS_LABELS[r.status][L()]); location.hash = `#/r/${r.id}`; } }, t("markSent"))); })() : null,
          ));
        } }, p.capability === "DIRECT" ? t("confirmSend") : t("confirmHandoff")),
        h("button", { type: "button", onclick: () => confirmOut.replaceChildren() }, t("cancel"))),
      h("ul", {}, ...c.instructions[L()].map((s) => h("li", {}, s)))));
    confirmOut.querySelector("h2")?.scrollIntoView({ behavior: "smooth" });
  }
  const knownOut = h("div", { id: "known" });
  render(nav,
    h("h1", {}, t("step3")), stepsBar(3, r.id), statusTag(r),
    h("h2", {}, t("quality")), qualityOut,
    h("h2", {}, t("preview")), h("div", { class: "row" }, field(t("format"), fmt), field(t("lang"), lang)), pre,
    h("div", { class: "row" }, h("button", { type: "button", id: "readyBtn", class: "primary", onclick: async () => { try { r = await backend.ready(r.id); toast(STATUS_LABELS[r.status][L()]); route(); } catch (e) { toast((e as Error).message); } } }, t("markReady"))),
    h("h2", {}, t("export")), h("div", { class: "row" },
      h("button", { type: "button", onclick: async () => download(`report_${r.id}.txt`, await backend.render(r.id, "short", lang.value as Lang), "text/plain") }, "TXT"),
      h("button", { type: "button", onclick: async () => download(`report_${r.id}.md`, await backend.render(r.id, "detailed", lang.value as Lang), "text/markdown") }, "Markdown"),
      h("button", { type: "button", onclick: async () => download(`report_${r.id}.json`, await backend.render(r.id, "json", lang.value as Lang), "application/json") }, "JSON"),
      h("button", { type: "button", id: "zipBtn", onclick: async () => { try { download(`errorrelay_${r.id}.zip`, await backend.exportZip(r.id), "application/zip"); } catch (e) { toast((e as Error).message); } } }, "ZIP")),
    h("h2", {}, t("knownIssues")), h("div", { class: "row" }, h("a", { class: "btn", href: "https://status.openai.com", target: "_blank", rel: "noopener noreferrer" }, t("statusPage")), r.product.startsWith("codex") ? h("button", { type: "button", onclick: async () => { const q = `${r.summary} ${r.actual}`; const res = await searchGitHubIssues(q); rc(knownOut, notice("info", L() === "ja" ? "類似の既知の問題の候補です。同一とは限りません。報告はそのまま続けられます。" : "Possible similar known issues; not necessarily the same. You can continue."), h("ul", {}, ...res.filter((i) => similarity(q, i.title) > 0.1).slice(0, 5).map((i) => h("li", {}, h("a", { href: i.url, target: "_blank", rel: "noopener noreferrer" }, i.title), ` (${i.state})`)))); } }, "GitHub issues") : null), knownOut,
    h("h2", {}, t("channels")), channelsOut, confirmOut,
    h("div", { class: "row" }, h("a", { class: "btn", href: `#/r/${r.id}/2` }, t("back")), h("a", { class: "btn", href: `#/r/${r.id}` }, t("status"))),
  );
  await refreshPreview();
  await showChannels();
}

async function history(nav: number) {
  const list = await backend.list();
  const importInput = h("input", { type: "file", accept: ".zip,application/zip", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { const r = await backend.importZip(await fileToBytes(f)); toast("✓"); location.hash = `#/r/${r.id}`; } catch (err) { toast((err as Error).message); } } });
  render(nav, h("h1", {}, t("history")), h("div", { class: "row" }, field(t("importPkg"), importInput)),
    list.length ? h("ul", { class: "check", id: "historyList" }, ...list.map((r) => h("li", {}, h("a", { href: `#/r/${r.id}` }, r.summary || r.id), " ", statusTag(r), h("span", { class: "small" }, ` ${PRODUCT_LABELS[r.product][L()]} · ${r.occurredAt?.display ?? "-"}`)))) : h("p", {}, "—"));
}

async function detail(r: Report, nav: number) {
  const q = h("textarea", { id: "fuQuestion", rows: 3 });
  const add = h("textarea", { id: "fuAdd", rows: 3, placeholder: "OS: macOS 15\nApp version: 1.2" });
  const tk = h("input", { type: "text", id: "fuTicket", placeholder: t("ticketId") });
  const fuOut = h("div", {});
  render(nav, h("h1", {}, r.summary || r.id), statusTag(r), h("p", { class: "small" }, `${PRODUCT_LABELS[r.product][L()]} · ${t("occurred")}: ${r.occurredAt?.display ?? "-"} · rev ${r.revisions.length}`),
    h("div", { class: "row" }, h("a", { class: "btn", href: `#/r/${r.id}/1` }, t("step1")), h("a", { class: "btn", href: `#/r/${r.id}/2` }, t("step2")), h("a", { class: "btn primary", href: `#/r/${r.id}/3` }, t("step3"))),
    h("pre", {}, generateReport(r, "detailed", L())),
    r.submissions.length ? h("table", {}, ...r.submissions.map((s) => h("tr", {}, h("td", {}, s.adapterId), h("td", {}, s.capability), h("td", {}, s.status), h("td", {}, s.ticketId ?? s.receipt ?? "-")))) : null,
    h("h2", {}, t("followup")), field(t("question"), q), field(t("additions"), add), field(t("ticketId"), tk),
    h("div", { class: "row" }, h("button", { type: "button", id: "fuBtn", onclick: async () => { const additions = Object.fromEntries(add.value.split("\n").map((l) => l.split(/[:：]/)).filter((p) => p.length >= 2).map(([k, ...v]) => [k!.trim(), v.join(":").trim()])); r = await backend.followup(r.id, q.value, additions, tk.value || null); fuOut.replaceChildren(h("pre", {}, r.followups.at(-1)!.reply)); toast("✓"); } }, t("makeReply"))), fuOut,
    r.followups.length ? h("details", {}, h("summary", {}, `Follow-ups (${r.followups.length})`), ...r.followups.map((f) => h("pre", {}, f.reply))) : null,
    h("div", { class: "row" }, h("button", { type: "button", class: "danger", id: "deleteBtn", onclick: async () => { if (confirm(t("deleteConfirm"))) { await backend.delete(r.id); location.hash = "#/history"; } } }, t("delete"))));
}

function settingsView(nav: number) {
  const mode = h("select", { id: "mode" }, h("option", { value: "local", selected: settings.mode === "local" }, t("modeLocal")), h("option", { value: "server", selected: settings.mode === "server" }, t("modeServer")));
  const url = h("input", { type: "url", id: "serverUrl", value: settings.serverUrl });
  const token = h("input", { type: "password", id: "token", value: settings.token, autocomplete: "off" });
  const tz = h("input", { type: "text", id: "tz", value: settings.timezone });
  const compUrl = h("input", { type: "url", id: "companionUrl", value: settings.companionUrl });
  const compTok = h("input", { type: "password", id: "companionToken", value: settings.companionToken, autocomplete: "off" });
  const doctor = h("textarea", { rows: 5, id: "doctorRaw" });
  const doctorOut = h("pre", {});
  const api = h("textarea", { rows: 5, id: "apiRaw" });
  const apiOut = h("pre", {});
  render(nav, h("h1", {}, t("settings")), field(t("mode"), mode), field(t("serverUrl"), url), field(t("token"), token), field(t("timezone"), tz),
    h("h2", {}, "Desktop Companion"), field("Companion URL", compUrl), field("Companion token", compTok),
    h("div", { class: "row" }, h("button", { type: "button", class: "primary", id: "saveSettings", onclick: () => { settings = { ...settings, mode: mode.value as "local", serverUrl: url.value, token: token.value, timezone: tz.value, companionUrl: compUrl.value, companionToken: compTok.value }; saveSettings(); backend = makeBackend(); toast("✓"); } }, t("save")), h("button", { type: "button", class: "danger", id: "wipeBtn", onclick: async () => { if (confirm(t("wipe"))) { await backend.wipeAll(); toast(t("wiped")); } } }, t("wipe"))),
    h("h2", {}, "Codex"), field(t("codexPaste"), doctor), h("button", { type: "button", onclick: () => { const r = redactDoctorOutput(doctor.value); doctorOut.textContent = r.redactedJson; toast(`${r.findings.length} redacted, dropped: ${r.droppedKeys.join(",") || "-"}`); } }, t("parse")), doctorOut,
    h("h2", {}, "OpenAI API"), field(t("apiPaste"), api), h("button", { type: "button", onclick: () => { const info = parseApiError(api.value); apiOut.textContent = JSON.stringify(info, null, 2) + "\n\n" + minimalReproduction(info, "curl"); } }, t("parse")), apiOut,
    h("h2", {}, t("harGuide")), h("ol", {}, ...(L() === "ja" ? ["ブラウザで問題のページを開き、開発者ツール（F12 / Ctrl+Shift+I / ⌘+Opt+I）→ Network タブ。", "「Preserve log」を有効化。", "問題を再現。", "ダウンロード（HAR）アイコンで保存。", "HAR には Cookie・トークン・個人情報が含まれ得ます。サポートに送る前に sanitize してください。", "iOS / Android のネイティブアプリではこの手順は使えません（アプリの画面録画やエラー文で代替）。"] : ["Open the page in a browser, open DevTools (F12 / Ctrl+Shift+I / ⌘+Opt+I) → Network tab.", "Enable 'Preserve log'.", "Reproduce the problem.", "Save with the download (HAR) icon.", "HAR files can contain cookies, tokens and personal data. Sanitize before sending.", "Native iOS/Android apps cannot record a browser HAR; use error text/screen recording instead."]).map((s) => h("li", {}, s))),
    h("p", { class: "small" }, "ErrorRelay v0.1.0 · " + (L() === "ja" ? "ErrorRelay 自体の利用状況テレメトリは送信しません。" : "ErrorRelay sends no usage telemetry.")));
}

/* ---------- boot ---------- */
applyChrome();
route();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => undefined);
