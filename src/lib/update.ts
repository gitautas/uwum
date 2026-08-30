/**
 * Keeping the app up to date, on the platforms where that's ours to do.
 *
 * Two paths behind one state machine, because from the UI's point of view they
 * differ only in what "install" means:
 *
 * - **in-app** (macOS, Windows, Linux AppImage) — Tauri's updater fetches the
 *   signed bundle, verifies it against the public key baked into the build, and
 *   swaps the install; we relaunch.
 * - **manual** (Linux `.deb`, Android, iOS) — something else owns the install,
 *   so all we can honestly do is say a newer version exists and open the
 *   release page.
 *
 * Which one applies is decided in Rust (`update.rs`), not sniffed here: on
 * Linux the same binary ships both ways and only the process knows which.
 *
 * Both paths read the same `latest.json` the release workflow publishes, so the
 * app can never learn about a version that isn't fully released yet.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";

import * as ipc from "./ipc";
import type { UpdateMode } from "./types";

/** How long after launch to look, and how often after that. */
const FIRST_CHECK_MS = 20_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Where the flow has got to. `idle` covers both "not looked" and "up to date". */
export type Phase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdateState {
  phase: Phase;
  mode: UpdateMode | null;
  /** The version on offer, once one is. */
  version: string | null;
  notes: string;
  /** 0–1 while downloading, or null when the server sent no content length. */
  progress: number | null;
  message: string;
  /** Cleared per version, so a new release gets to speak up again. */
  dismissed: string | null;
}

interface UpdateActions {
  /** Look for an update. `manual: true` when a person asked, which makes it noisy. */
  check(manual?: boolean): Promise<void>;
  /** Apply what `check` found — download and install, or open the release page. */
  install(): Promise<void>;
  /** Restart into the version that was just installed. */
  relaunch(): Promise<void>;
  dismiss(): void;
}

/**
 * Its own store rather than a corner of the app store: nothing here touches
 * Matrix state, and nothing in the app store needs to read it.
 */
export const useUpdate = create<UpdateState & UpdateActions>((set, get) => ({
  phase: "idle",
  mode: null,
  version: null,
  notes: "",
  progress: null,
  message: "",
  dismissed: null,

  check: async (manual = false) => {
    // A check already in flight, or a download under way, must not be
    // restarted by the interval timer landing on top of it.
    const { phase } = get();
    if (phase === "checking" || phase === "downloading" || phase === "ready") return;

    set({ phase: "checking", message: "" });

    try {
      const mode = await ipc.updateMode();
      set({ mode });

      if (mode === "in-app") {
        // Imported here rather than at module scope: on Android and iOS the
        // plugin isn't compiled into the binary, and its commands would throw.
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();

        if (!update) {
          set({ phase: "idle", message: manual ? "you're on the latest version~" : "" });
          return;
        }

        set({
          phase: "available",
          version: update.version,
          notes: update.body ?? "",
          message: "",
        });
        return;
      }

      const latest = await ipc.latestRelease();

      // The comparison is Rust's: it knows the version this binary was *built*
      // as, which is the only version that matters here.
      if (!(await ipc.updateAvailable(latest.version))) {
        set({ phase: "idle", message: manual ? "you're on the latest version~" : "" });
        return;
      }

      set({
        phase: "available",
        version: latest.version,
        notes: latest.notes,
        message: "",
      });
    } catch (error) {
      // A failed check is almost always "no network", which the app already
      // says elsewhere. Only a person who asked deserves to hear about it.
      set({
        phase: manual ? "error" : "idle",
        message: manual ? ipc.asUwuError(error).message : "",
      });
    }
  },

  install: async () => {
    const { mode, version } = get();

    if (mode === "manual") {
      const latest = await ipc.latestRelease().catch(() => null);
      if (latest) await openUrl(latest.url);
      return;
    }

    set({ phase: "downloading", progress: 0, message: "" });

    try {
      const { check } = await import("@tauri-apps/plugin-updater");

      // Re-fetched rather than held from `check`: an `Update` owns a native
      // resource, and stashing one in a store keeps it alive across whatever
      // the user does in between. This costs one request.
      const update = await check();

      if (!update || update.version !== version) {
        // The release moved underneath us. Start over rather than install
        // something the user was never shown.
        set({ phase: "idle", progress: null });
        void get().check(true);
        return;
      }

      let total = 0;
      let seen = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          set({ progress: total ? 0 : null });
        } else if (event.event === "Progress") {
          seen += event.data.chunkLength;
          if (total) set({ progress: Math.min(seen / total, 1) });
        } else if (event.event === "Finished") {
          set({ progress: 1 });
        }
      });

      set({ phase: "ready", progress: 1 });
    } catch (error) {
      set({ phase: "error", progress: null, message: ipc.asUwuError(error).message });
    }
  },

  relaunch: async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },

  dismiss: () => set((s) => ({ dismissed: s.version })),
}));

/**
 * Start looking for updates, and keep looking.
 *
 * The first check is deliberately late: launch is already busy restoring a
 * session and starting sync, and an update is never urgent enough to compete
 * with the first paint.
 *
 * Returns a teardown, in the shape `useEffect` wants.
 */
export function startUpdateChecks(): () => void {
  const first = window.setTimeout(() => void useUpdate.getState().check(), FIRST_CHECK_MS);
  const repeat = window.setInterval(() => void useUpdate.getState().check(), INTERVAL_MS);

  return () => {
    window.clearTimeout(first);
    window.clearInterval(repeat);
  };
}

