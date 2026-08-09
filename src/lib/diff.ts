import type { Diff } from "./types";

/**
 * Apply one `VectorDiff` from the backend to a list.
 *
 * Always returns a new array when something changed, so React sees a new
 * reference; returns a copy when the diff was a no-op.
 *
 * **Every index here is treated as untrusted.** The indices are computed
 * against the backend's copy of the list, and ours can drift out of step with
 * it — a dropped update, an unknown op, a snapshot landing after a diff. The
 * dangerous case is `set` past the end: `list[10] = x` on a list of 3 doesn't
 * throw, it silently creates *holes*, and a hole is `undefined`. That
 * `undefined` then travels all the way to a selector doing `r.id` and takes the
 * whole app down with a message about the letter r.
 *
 * So no operation here may ever leave a gap. Out-of-range indices are clamped
 * to the end of the list, which turns a desync into a room in a slightly wrong
 * position — resolved by the next `reset` — rather than a crash.
 */
export function applyDiff<T>(list: readonly T[], diff: Diff<T>): T[] {
  switch (diff.op) {
    case "append":
      return diff.values.length ? [...list, ...diff.values] : [...list];
    case "clear":
      return [];
    case "pushFront":
      return [diff.value, ...list];
    case "pushBack":
      return [...list, diff.value];
    case "popFront":
      return list.slice(1);
    case "popBack":
      return list.slice(0, -1);

    case "insert": {
      const next = [...list];
      // splice already clamps, but be explicit: a negative index would count
      // from the end, which is not what the backend meant.
      next.splice(clamp(diff.index, next.length), 0, diff.value);
      return next;
    }

    case "set": {
      const next = [...list];
      const index = clamp(diff.index, next.length);
      // Past the end, this is an append: assigning to next[index] directly
      // would leave holes between the old end and the new item.
      if (index >= next.length) next.push(diff.value);
      else next[index] = diff.value;
      return next;
    }

    case "remove": {
      const next = [...list];
      // Out of range removes nothing, rather than removing the last item.
      if (diff.index >= 0 && diff.index < next.length) next.splice(diff.index, 1);
      return next;
    }

    case "truncate":
      return list.slice(0, Math.max(0, diff.length));

    case "reset":
      return [...diff.values];

    default:
      // An unknown op means the backend is ahead of us. Dropping it is safer
      // than guessing: the next reset will resynchronise.
      return [...list];
  }
}

function clamp(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, length);
}

export function applyDiffs<T>(list: readonly T[], diffs: Diff<T>[]): T[] {
  return diffs.reduce<T[]>((acc, diff) => applyDiff(acc, diff), [...list]);
}
