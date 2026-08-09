import type { Diff } from "./types";

/**
 * Apply one `VectorDiff` from the backend to a list.
 *
 * Always returns a new array when something changed, so React sees a new
 * reference; returns the original when the diff was a no-op.
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
      next.splice(diff.index, 0, diff.value);
      return next;
    }
    case "set": {
      const next = [...list];
      next[diff.index] = diff.value;
      return next;
    }
    case "remove": {
      const next = [...list];
      next.splice(diff.index, 1);
      return next;
    }
    case "truncate":
      return list.slice(0, diff.length);
    case "reset":
      return [...diff.values];
    default:
      // An unknown op means the backend is ahead of us. Dropping it is safer
      // than guessing: the next reset will resynchronise.
      return [...list];
  }
}

export function applyDiffs<T>(list: readonly T[], diffs: Diff<T>[]): T[] {
  return diffs.reduce<T[]>((acc, diff) => applyDiff(acc, diff), [...list]);
}
