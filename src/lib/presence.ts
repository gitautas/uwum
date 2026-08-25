/**
 * Who the UI wants presence for.
 *
 * The backend polls one request per watched person (see `presence.rs`), so the
 * watched set has to be *what's on screen* rather than everyone we know. That
 * can't be decided centrally — the member list, the sidebar's DMs and the open
 * profile card each know about their own people and nothing about each other's
 * — so interest is refcounted here and the union is pushed to Rust.
 *
 * Deliberately not in the zustand store, for the same reason `profiles.ts`
 * isn't: nothing here is rendered, and a refcount map is the whole thing. The
 * presence *values* do live in the store, because they paint.
 */

import { useEffect } from "react";

import * as ipc from "./ipc";
import { useStore } from "../store";
import type { Presence } from "./types";

/** userId → how many mounted components are drawing them. */
const interest = new Map<string, number>();

let flushTimer: number | undefined;

/**
 * Opening a room mounts a member list, a sidebar row and possibly a card in
 * the same tick; each one is a set change and none of them is worth a round
 * trip on its own.
 */
const FLUSH_DELAY_MS = 100;

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void ipc.watchPresence([...interest.keys()]).catch(() => {
      // A failed watch means no dots until the next set change, which is a
      // decoration going missing rather than anything the user must be told.
    });
  }, FLUSH_DELAY_MS);
}

function retain(userId: string): void {
  const count = interest.get(userId) ?? 0;
  interest.set(userId, count + 1);
  if (count === 0) scheduleFlush();
}

function release(userId: string): void {
  const count = interest.get(userId) ?? 0;
  if (count <= 1) {
    interest.delete(userId);
    scheduleFlush();
  } else {
    interest.set(userId, count - 1);
  }
}

/**
 * Presence for one person, while this component is on screen.
 *
 * `undefined` until the first poll answers — which is also what a server with
 * presence switched off gives forever, so callers draw nothing rather than
 * guessing at "offline".
 */
export function usePresence(userId: string | null | undefined): Presence | undefined {
  useEffect(() => {
    if (!userId) return;
    retain(userId);
    return () => release(userId);
  }, [userId]);

  return useStore((s) => (userId ? s.presence[userId] : undefined));
}

/** False on a homeserver that has presence turned off. Nothing draws then. */
export function usePresenceSupported(): boolean {
  return useStore((s) => s.presenceSupported);
}

/** Drop every subscription — on sign-out, when nobody is on screen any more. */
export function resetPresence(): void {
  interest.clear();
  if (flushTimer !== undefined) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }
}
