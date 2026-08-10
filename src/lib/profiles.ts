/**
 * Profiles, fetched once and kept for a while.
 *
 * A profile is one HTTP round trip to the homeserver — `get_profile` isn't
 * served from the sync stream — and the same person's profile is now wanted in
 * three places: their card, the top of a DM's sidebar, and the settings editor.
 * Without this, opening a DM and then their card asks twice, and switching
 * between two DMs asks again every time.
 *
 * Deliberately not in the zustand store: nothing here is UI state, nothing
 * re-renders when it changes, and a `Map` keyed by user ID is the whole
 * requirement.
 */

import * as ipc from "./ipc";
import type { Profile } from "./types";

/**
 * How long a cached profile is served before being fetched again.
 *
 * Profiles change rarely, and when *you* change yours we invalidate directly.
 * This bound only exists so someone else's new avatar shows up within a
 * session rather than never.
 */
const MAX_AGE_MS = 5 * 60 * 1000;

interface Entry {
  profile: Profile;
  at: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Profile>>();

/** The profile for a user, from cache when it's fresh enough. */
export function loadProfile(userId: string): Promise<Profile> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < MAX_AGE_MS) {
    return Promise.resolve(cached.profile);
  }

  // Two components mounting at once must not become two requests.
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const request = ipc
    .getProfile(userId)
    .then((profile) => {
      cache.set(userId, { profile, at: Date.now() });
      return profile;
    })
    .finally(() => inFlight.delete(userId));

  inFlight.set(userId, request);
  return request;
}

/** What's already known, for a first paint with no request at all. */
export function cachedProfile(userId: string): Profile | undefined {
  return cache.get(userId)?.profile;
}

/** Drop a cached profile — after editing your own, mainly. */
export function invalidateProfile(userId: string): void {
  cache.delete(userId);
}
