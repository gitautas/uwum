import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLastSeen } from "./display";

const NOW = new Date("2026-03-14T18:30:00Z").getTime();

function ago(ms: number): number {
  return NOW - ms;
}

describe("formatLastSeen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(now: number) {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  }

  it("says nothing when the server never told us", () => {
    at(NOW);
    expect(formatLastSeen(null)).toBe("");
    // Zero is "no answer" rather than the epoch — the backend only ever writes
    // a real instant or null.
    expect(formatLastSeen(0)).toBe("");
  });

  it("rounds the last minute or so to 'just now'", () => {
    at(NOW);
    expect(formatLastSeen(ago(0))).toBe("just now");
    expect(formatLastSeen(ago(80_000))).toBe("just now");
  });

  it("counts in the largest unit that still reads as a number", () => {
    at(NOW);
    expect(formatLastSeen(ago(5 * 60_000))).toBe("5m ago");
    expect(formatLastSeen(ago(59 * 60_000))).toBe("59m ago");
    expect(formatLastSeen(ago(3 * 3_600_000))).toBe("3h ago");
    expect(formatLastSeen(ago(2 * 86_400_000))).toBe("2d ago");
  });

  it("falls back to a date once 'n days ago' stops meaning anything", () => {
    at(NOW);
    // The exact wording is locale-dependent; what matters is that it stops
    // counting and names a day.
    const old = formatLastSeen(ago(40 * 86_400_000));
    expect(old.startsWith("on ")).toBe(true);
    expect(old).not.toContain("d ago");
  });

  it("keeps counting as the clock moves, not as polls arrive", () => {
    const seen = ago(60_000);

    at(NOW);
    expect(formatLastSeen(seen)).toBe("just now");

    // Same value, an hour later: the label has to have moved on its own, since
    // the backend only pushes when the server's answer *changes*.
    at(NOW + 3_600_000);
    expect(formatLastSeen(seen)).toBe("1h ago");
  });

  it("never reads as the future when clocks disagree", () => {
    at(NOW);
    expect(formatLastSeen(NOW + 30_000)).toBe("just now");
  });
});
