import { describe, it, expect } from "vitest";
import { parseManualTimestamp, nowTimestamp, formatDisplay, retimezone, tzOffsetMinutes, timestampFromVisibleClock } from "../src/index.js";

describe("timestamps (tests 7, 8)", () => {
  it("parses a manual JST time to the correct UTC instant and display", () => {
    const ts = parseManualTimestamp("2026-09-30 13:44", "Asia/Tokyo");
    expect(ts).not.toBeNull();
    expect(ts!.iso).toBe("2026-09-30T04:44:00.000Z");
    expect(ts!.display).toBe("2026-09-30 13:44 GMT+9 / Asia/Tokyo");
    expect(ts!.timezone).toBe("Asia/Tokyo");
    expect(ts!.source).toBe("user_manual");
  });
  it("handles DST zones", () => {
    const summer = parseManualTimestamp("2026-07-01 12:00", "America/New_York")!;
    const winter = parseManualTimestamp("2026-01-01 12:00", "America/New_York")!;
    expect(summer.iso).toBe("2026-07-01T16:00:00.000Z");
    expect(winter.iso).toBe("2026-01-01T17:00:00.000Z");
    expect(tzOffsetMinutes(new Date(summer.iso), "America/New_York")).toBe(-240);
  });
  it("rejects invalid dates instead of guessing", () => {
    expect(parseManualTimestamp("2026-02-30 10:00", "Asia/Tokyo")).toBeNull();
    expect(parseManualTimestamp("yesterday", "Asia/Tokyo")).toBeNull();
    expect(parseManualTimestamp("2026-09-30 10:00", "Not/AZone")).toBeNull();
  });
  it("'now' button records the instant and zone", () => {
    const now = new Date("2026-09-30T01:20:00Z");
    const ts = nowTimestamp("Asia/Tokyo", now);
    expect(ts.display).toContain("2026-09-30 10:20");
    expect(ts.source).toBe("user_now");
  });
  it("retimezone keeps the instant", () => {
    const ts = parseManualTimestamp("2026-09-30 13:44", "Asia/Tokyo")!;
    const la = retimezone(ts, "America/Los_Angeles");
    expect(la.iso).toBe(ts.iso);
    expect(la.display).toContain("2026-09-29 21:44");
  });
  it("visible clock from screenshot is low confidence", () => {
    const ts = timestampFromVisibleClock("10:20", new Date("2026-09-30T00:00:00Z"), "Asia/Tokyo")!;
    expect(ts.confidence).toBe("low");
    expect(ts.source).toBe("screenshot_visible");
    expect(formatDisplay(new Date(ts.iso), "Asia/Tokyo")).toContain("10:20");
  });
});
