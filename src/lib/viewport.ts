/**
 * Viewport shape, for the one place the layout genuinely differs: a phone.
 *
 * The desktop shell is three panes side by side — spaces rail, room list, chat,
 * plus room info when it's open — and their widths add up to a hard 854px floor.
 * A phone has 390. So mobile isn't a narrower version of the same layout: it's a
 * stack, one pane at a time, which is a structural difference the styles can't
 * express on their own.
 *
 * Hence a hook rather than a media query. Layout in this app lives in inline
 * styles next to the markup that uses it, and the mobile shell needs to change
 * *which components render*, not just how wide they are.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";

/**
 * Below this, the stacked layout. Above it, the desktop shell unchanged.
 *
 * 768 is the usual tablet floor: every phone in portrait is comfortably below
 * it, and an iPad at 834 stays on the desktop layout, which it has the room for.
 */
export const MOBILE_BREAKPOINT = 768;

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * One matcher for the process.
 *
 * `getSnapshot` is called on every render so React can compare, and building a
 * fresh `MediaQueryList` each time is pure waste. Created lazily so importing
 * this module stays safe anywhere `window` isn't there yet — the test
 * environment, mostly.
 */
let matcher: MediaQueryList | undefined;

function media(): MediaQueryList {
  matcher ??= window.matchMedia(query);
  return matcher;
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return media().matches;
}

/**
 * True on a phone-sized viewport.
 *
 * `useSyncExternalStore` rather than an effect: this decides which shell
 * renders, and an effect would paint the desktop layout for one frame first —
 * on a phone that's a visible flash of three panes jammed off-screen.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Stop reserving room for the home indicator while the keyboard covers it.
 *
 * `env(safe-area-inset-bottom)` keeps reporting 34px with the keyboard up, so
 * anything padded by it floats that far above the keyboard — dead space in the
 * one moment the screen is most crowded. iOS gives no signal for "keyboard is
 * showing", but for our purposes a focused text field is the same thing, and
 * unlike watching `visualViewport` for a height change it doesn't have to guess
 * a threshold or care whether the web view itself was resized.
 *
 * This writes the token every consumer already reads rather than returning a
 * value, so no component needs to know the keyboard exists.
 */
export function useKeyboardSafeArea(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const DEFAULT = "env(safe-area-inset-bottom,0px)";

    const update = () => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      root.style.setProperty("--safe-bottom", typing ? "0px" : DEFAULT);
    };

    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.style.removeProperty("--safe-bottom");
    };
  }, [enabled]);
}

/**
 * Drop the keyboard when the user starts scrolling.
 *
 * This is what `UIScrollView.keyboardDismissMode = .onDrag` gives a native
 * list: you reach to read back through the conversation, and the keyboard gets
 * out of the way without you aiming at anything. There is no web equivalent, so
 * a touch-move on the scrolling pane stands in for the drag.
 */
export function dismissKeyboard(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    el.blur();
  }
}

/** How far in from the left edge a swipe must start to count as "back". */
const EDGE_ZONE = 28;

/** Horizontal travel before the gesture takes ownership of the touch. */
const COMMIT = 10;

/** Fraction of the screen that commits to going back on release. */
const COMPLETE_AT = 0.32;

/**
 * How long the pane takes to settle, matching `--dur-normal`.
 *
 * Duplicated from the token because a `setTimeout` can't read a CSS variable
 * without a layout read; if the token moves, move this with it.
 */
const SETTLE_MS = 220;

/** …or this much travel, if it was flicked rather than dragged. */
const FLICK_DISTANCE = 56;
const FLICK_SPEED = 0.45; // px per ms

/**
 * The iOS edge-swipe-back gesture, for a view pushed by the mobile shell.
 *
 * There is no platform gesture to borrow here: `allowsBackForwardNavigationGestures`
 * drives the *web view's* history, which our stack is not — the pushed view is a
 * React branch, not a page. So this reimplements the interaction: a drag that
 * starts within `EDGE_ZONE` of the left edge, follows the finger, and completes
 * if released past a third of the screen or thrown faster than `FLICK_SPEED`.
 *
 * Two details that make it feel native rather than like a web page pretending:
 *
 * - The gesture only commits once travel is mostly horizontal, so a vertical
 *   scroll that begins near the edge still scrolls. Until then it does nothing.
 * - Listeners are attached natively, not through React's synthetic events.
 *   React registers `touchmove` as passive, and a passive listener cannot call
 *   `preventDefault` — without which the message list scrolls underneath the
 *   pane as it slides.
 */
export function useEdgeSwipeBack(onBack: (() => void) | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const live = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onBack) return;

    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let tracking = false;
    let committed = false;

    const move = (to: number) => {
      live.current = to;
      setOffset(to);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX > EDGE_ZONE) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startedAt = e.timeStamp;
      tracking = true;
      committed = false;
      setSettling(false);
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!committed) {
        // Mostly vertical? Hand the touch back to the scrolling pane.
        if (Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          return;
        }
        if (dx < COMMIT) return;
        committed = true;
      }

      e.preventDefault();
      move(Math.max(0, dx));
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (!committed) return;

      const travelled = live.current;
      const elapsed = Math.max(1, e.timeStamp - startedAt);
      const flicked =
        travelled > FLICK_DISTANCE && travelled / elapsed > FLICK_SPEED;

      setSettling(true);

      if (flicked || travelled > el.clientWidth * COMPLETE_AT) {
        // See it out to the edge before unmounting, so the view leaves rather
        // than vanishing from under the finger. The wait matches the transition
        // below; unmounting early cuts the slide off part-way.
        move(el.clientWidth);
        window.setTimeout(() => {
          move(0);
          onBack();
        }, SETTLE_MS);
      } else {
        move(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [onBack]);

  return {
    ref,
    style: {
      transform: offset ? `translateX(${offset}px)` : undefined,
      transition: settling ? "transform var(--dur-normal) var(--ease-out)" : undefined,
    } as const,
  };
}

/** How long a finger must rest before a press counts as "long". */
const LONG_PRESS_MS = 420;

/** How far it may drift in that time before it's a scroll instead. */
const LONG_PRESS_SLOP = 10;

/**
 * A long press, standing in for the hover that a touch screen doesn't have.
 *
 * The message actions live behind hover on desktop, which on a phone means they
 * live nowhere. Press-and-hold is where iOS puts exactly this — the actions for
 * the thing under your finger.
 *
 * Pass `undefined` to disable it (desktop), and the handlers come back empty so
 * nothing is bound at all.
 */
export function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => cancel, []);

  if (!onLongPress) return {};

  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return cancel();
      const touch = e.touches[0];
      origin.current = { x: touch.clientX, y: touch.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const drifted =
        Math.abs(touch.clientX - origin.current.x) > LONG_PRESS_SLOP ||
        Math.abs(touch.clientY - origin.current.y) > LONG_PRESS_SLOP;
      if (drifted) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };
}
