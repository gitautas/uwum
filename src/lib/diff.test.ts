import { describe, expect, it } from "vitest";

import { applyDiff, applyDiffs } from "./diff";
import type { Diff } from "./types";

/**
 * These guard one invariant: **the list never contains a hole**.
 *
 * A hole reads as `undefined`, and every consumer of these lists assumes
 * objects — `rooms.find(r => r.id === …)` throws on the first one and takes the
 * whole app down. Indices come from the backend's copy of the list, which can
 * drift out of step with ours, so out-of-range is a normal input here, not an
 * impossible one.
 */
const item = (id: string) => ({ id });

/** A hole is not the same as an explicit `undefined`; `in` tells them apart. */
function hasHoles<T>(list: T[]): boolean {
  for (let i = 0; i < list.length; i++) {
    if (!(i in list)) return true;
  }
  return false;
}

describe("applyDiff", () => {
  const list = [item("a"), item("b"), item("c")];

  it("sets in range", () => {
    const next = applyDiff(list, { op: "set", index: 1, value: item("x") });
    expect(next.map((i) => i.id)).toEqual(["a", "x", "c"]);
  });

  it("appends rather than leaving a hole when set lands past the end", () => {
    // The crash: `next[9] = value` on a list of 3 silently creates six holes.
    const next = applyDiff(list, { op: "set", index: 9, value: item("x") });
    expect(hasHoles(next)).toBe(false);
    expect(next.every((entry) => entry !== undefined)).toBe(true);
    expect(next.map((i) => i.id)).toEqual(["a", "b", "c", "x"]);
  });

  it("clamps an insert past the end", () => {
    const next = applyDiff(list, { op: "insert", index: 40, value: item("x") });
    expect(hasHoles(next)).toBe(false);
    expect(next.map((i) => i.id)).toEqual(["a", "b", "c", "x"]);
  });

  it("treats a negative index as the front, not as counting from the end", () => {
    const next = applyDiff(list, { op: "insert", index: -2, value: item("x") });
    expect(next.map((i) => i.id)).toEqual(["x", "a", "b", "c"]);
  });

  it("ignores a remove that isn't in the list", () => {
    expect(applyDiff(list, { op: "remove", index: 7 }).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(applyDiff(list, { op: "remove", index: -1 }).map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("removes in range", () => {
    expect(applyDiff(list, { op: "remove", index: 0 }).map((i) => i.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("never truncates to a negative length", () => {
    expect(applyDiff(list, { op: "truncate", length: -3 })).toEqual([]);
  });

  it("keeps the list when the op is one we don't know", () => {
    const unknown = { op: "somethingNew" } as unknown as Diff<{ id: string }>;
    expect(applyDiff(list, unknown).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves no holes however far out of step the indices are", () => {
    const diffs: Diff<{ id: string }>[] = [
      { op: "set", index: 12, value: item("x") },
      { op: "insert", index: 99, value: item("y") },
      { op: "remove", index: 50 },
      { op: "set", index: 3, value: item("z") },
    ];
    const next = applyDiffs(list, diffs);
    expect(hasHoles(next)).toBe(false);
    expect(next.every((entry) => entry !== undefined)).toBe(true);
  });
});
