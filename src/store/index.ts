/**
 * The app's single store.
 *
 * Rust owns the truth; this holds a projection of it plus the bits of UI state
 * that don't belong on the server (which room is selected, what's in the
 * composer). Backend pushes arrive as diffs and are applied in place.
 */

import { create } from "zustand";

import { applyDiffs } from "../lib/diff";
import * as ipc from "../lib/ipc";
import * as prefs from "../lib/settings";
import type {
  RoomsSnapshot,
  RoomsUpdate,
  RoomSummary,
  SasStateInfo,
  SessionInfo,
  SpaceSummary,
  SyncStatus,
  TimelineItem,
  TimelineUpdate,
  TypingUpdate,
  TypingUser,
  VerificationRequestInfo,
} from "../lib/types";
import { isSasUpdate } from "../lib/types";

export type RoomFilter = "all" | "unread" | "dms" | "muted";

/** Which timeline a view is showing — a room, or a thread inside one. */
export interface TimelineKey {
  roomId: string;
  threadRoot?: string;
}

export function timelineKey({ roomId, threadRoot }: TimelineKey): string {
  return threadRoot ? `${roomId}|${threadRoot}` : roomId;
}

interface Draft {
  body: string;
  replyTo: string | null;
  editing: string | null;
}

const EMPTY_DRAFT: Draft = { body: "", replyTo: null, editing: null };

interface State {
  // session
  session: SessionInfo | null;
  bootstrapped: boolean;
  syncStatus: SyncStatus;

  // rooms
  rooms: RoomSummary[];
  /**
   * The last room-list batch folded into `rooms`.
   *
   * The snapshot and the diff stream arrive over different channels and can
   * cross in flight, so both carry this number: a batch at or below it is
   * already in the list, and a batch more than one ahead means one went
   * missing and the list can no longer be trusted to index correctly.
   */
  roomsSeq: number;
  /** A resync is in flight; diffs are unreliable until it lands. */
  roomsResyncing: boolean;
  spaces: SpaceSummary[];
  activeSpaceId: string | null;
  activeRoomId: string | null;
  activeThreadRoot: string | null;
  filter: RoomFilter;
  search: string;

  // timelines, keyed by `timelineKey`
  timelines: Record<string, TimelineItem[]>;
  /** Timelines that have reached the start of history. */
  exhausted: Record<string, boolean>;
  paginating: Record<string, boolean>;
  typing: Record<string, TypingUser[]>;
  drafts: Record<string, Draft>;

  // panels
  showInfo: boolean;
  showSettings: boolean;
  /**
   * The open profile card, if any. Anchored to whatever avatar was clicked —
   * one card at a time, owned here rather than by each avatar, so opening a
   * second one closes the first without either knowing about the other.
   */
  profileCard: { userId: string; anchor: DOMRect } | null;
  /** The picture being looked at full-size, if any. */
  lightbox: { mxc: string; name: string } | null;
  showCreateRoom: boolean;

  /** Machine-local preferences, persisted outside the account. */
  settings: prefs.Settings;

  // verification
  verificationRequest: VerificationRequestInfo | null;
  sasState: SasStateInfo | null;

  // calls
  callRoomId: string | null;

  // toasts / errors
  banner: { tone: "error" | "info"; message: string } | null;
}

interface Actions {
  setSession(session: SessionInfo | null): void;
  setRooms(snapshot: RoomsSnapshot): void;
  setBootstrapped(v: boolean): void;
  applyRoomDiffs(update: RoomsUpdate): void;
  setSpaces(spaces: SpaceSummary[]): void;
  /** Re-read the whole room list after a dropped batch. */
  resyncRooms(): Promise<void>;
  /** Re-read the spaces now rather than waiting for the slow poll. */
  refreshSpaces(): Promise<void>;
  setActiveSpace(id: string | null): void;
  selectRoom(roomId: string | null): Promise<void>;
  openThread(threadRoot: string | null): Promise<void>;
  setFilter(filter: RoomFilter): void;
  setSearch(search: string): void;
  toggleInfo(): void;
  openSettings(): void;
  closeSettings(): void;
  /** Clicking the same avatar again closes the card, like every other popover. */
  toggleProfile(userId: string, anchor: DOMRect): void;
  closeProfile(): void;
  openLightbox(mxc: string, name: string): void;
  closeLightbox(): void;
  openCreateRoom(): void;
  closeCreateRoom(): void;
  updateSettings(patch: Partial<prefs.Settings>): void;
  /** Move a reaction to the front of the recents row. */
  noteReactionUsed(key: string): void;

  applyTimelineUpdate(update: TimelineUpdate): void;
  setTimeline(key: string, items: TimelineItem[]): void;
  loadOlder(): Promise<void>;
  applyTyping(update: TypingUpdate): void;

  setDraft(key: string, patch: Partial<Draft>): void;
  clearDraft(key: string): void;

  setSyncStatus(status: SyncStatus): void;
  setVerificationRequest(request: VerificationRequestInfo | null): void;
  applyVerificationUpdate(update: VerificationRequestInfo | SasStateInfo): void;
  setCallRoom(roomId: string | null): void;
  showBanner(tone: "error" | "info", message: string): void;
  dismissBanner(): void;
  reset(): void;
}

const initial: State = {
  session: null,
  bootstrapped: false,
  syncStatus: { state: "idle", message: null },
  rooms: [],
  roomsSeq: 0,
  roomsResyncing: false,
  spaces: [],
  activeSpaceId: null,
  activeRoomId: null,
  activeThreadRoot: null,
  filter: "all",
  search: "",
  timelines: {},
  exhausted: {},
  paginating: {},
  typing: {},
  drafts: {},
  showInfo: prefs.load().showInfoPanel,
  showSettings: false,
  profileCard: null,
  lightbox: null,
  showCreateRoom: false,
  settings: prefs.load(),
  verificationRequest: null,
  sasState: null,
  callRoomId: null,
  banner: null,
};

export const useStore = create<State & Actions>((set, get) => ({
  ...initial,

  setSession: (session) => set({ session }),

  setRooms: (snapshot) =>
    set((s) =>
      // A snapshot older than what we've already applied is stale news; it
      // would undo batches that arrived while it was being fetched.
      snapshot.seq >= s.roomsSeq
        ? { rooms: snapshot.rooms, roomsSeq: snapshot.seq, roomsResyncing: false }
        : { roomsResyncing: false },
    ),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),

  applyRoomDiffs: ({ seq, diffs }) => {
    const { roomsSeq, roomsResyncing } = get();

    // Already in the list: this batch was folded in before the snapshot we
    // hold was taken.
    if (seq <= roomsSeq) return;

    // A gap means a batch went missing, so every index in this one counts
    // against a list we don't have. Applying it would silently misplace rooms;
    // ask for the truth instead.
    if (seq > roomsSeq + 1) {
      if (!roomsResyncing) {
        set({ roomsResyncing: true });
        void get().resyncRooms();
      }
      return;
    }

    if (roomsResyncing) return;
    set((s) => ({ rooms: applyDiffs(s.rooms, diffs), roomsSeq: seq }));
  },

  resyncRooms: async () => {
    try {
      get().setRooms(await ipc.getRooms());
    } catch {
      // Leave the flag set: the next batch will try again.
      set({ roomsResyncing: false });
    }
  },

  setSpaces: (spaces) => set({ spaces }),

  refreshSpaces: async () => {
    try {
      set({ spaces: await ipc.getSpaces() });
    } catch {
      // The poll will come round again; nothing here is worth a banner.
    }
  },

  setActiveSpace: (activeSpaceId) => set({ activeSpaceId }),

  selectRoom: async (roomId) => {
    const previous = get().activeRoomId;
    const previousThread = get().activeThreadRoot;
    if (previous === roomId) return;

    // Close the old timeline so its stream task stops; leaving them all open
    // would keep every visited room streaming for the whole session.
    if (previous) {
      if (previousThread) {
        void ipc.closeTimeline(previous, previousThread).catch(() => {});
      }
      void ipc.closeTimeline(previous).catch(() => {});
    }

    set({ activeRoomId: roomId, activeThreadRoot: null });
    if (!roomId) return;

    try {
      const items = await ipc.openTimeline(roomId);
      set((s) => ({ timelines: { ...s.timelines, [roomId]: items } }));
      // Opening a room is the user reading it.
      void ipc.markRoomRead(roomId).catch(() => {});
    } catch (error) {
      get().showBanner("error", ipc.asUwuError(error).message);
    }
  },

  openThread: async (threadRoot) => {
    const roomId = get().activeRoomId;
    const previous = get().activeThreadRoot;
    if (!roomId) return;

    if (previous && previous !== threadRoot) {
      void ipc.closeTimeline(roomId, previous).catch(() => {});
    }

    set({ activeThreadRoot: threadRoot });
    if (!threadRoot) return;

    try {
      const items = await ipc.openTimeline(roomId, threadRoot);
      const key = timelineKey({ roomId, threadRoot });
      set((s) => ({ timelines: { ...s.timelines, [key]: items } }));
    } catch (error) {
      get().showBanner("error", ipc.asUwuError(error).message);
    }
  },

  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  toggleInfo: () =>
    set((s) => {
      const showInfo = !s.showInfo;
      // Remember the panel state — it's a layout preference, not a per-room one.
      const settings = { ...s.settings, showInfoPanel: showInfo };
      prefs.save(settings);
      return { showInfo, settings };
    }),

  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),

  toggleProfile: (userId, anchor) =>
    set((s) => ({
      profileCard: s.profileCard?.userId === userId ? null : { userId, anchor },
    })),
  closeProfile: () => set({ profileCard: null }),

  openLightbox: (mxc, name) => set({ lightbox: { mxc, name } }),
  closeLightbox: () => set({ lightbox: null }),

  openCreateRoom: () => set({ showCreateRoom: true }),
  closeCreateRoom: () => set({ showCreateRoom: false }),

  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      prefs.save(settings);
      if (patch.accent) prefs.applyAccent(patch.accent);
      return { settings };
    }),

  noteReactionUsed: (key) =>
    get().updateSettings({
      recentReactions: [
        key,
        ...get().settings.recentReactions.filter((k) => k !== key),
      ].slice(0, prefs.MAX_RECENT_REACTIONS),
    }),

  applyTimelineUpdate: ({ roomId: key, diffs }) =>
    set((s) => {
      // Ignore updates for timelines we've already closed.
      if (!(key in s.timelines)) return {};
      return { timelines: { ...s.timelines, [key]: applyDiffs(s.timelines[key], diffs) } };
    }),

  setTimeline: (key, items) =>
    set((s) => ({ timelines: { ...s.timelines, [key]: items } })),

  loadOlder: async () => {
    const { activeRoomId, activeThreadRoot } = get();
    if (!activeRoomId) return;

    const key = timelineKey({
      roomId: activeRoomId,
      threadRoot: activeThreadRoot ?? undefined,
    });
    // Nothing to paginate until `open_timeline` has come back.
    if (get().timelines[key] === undefined) return;
    if (get().paginating[key] || get().exhausted[key]) return;

    set((s) => ({ paginating: { ...s.paginating, [key]: true } }));
    try {
      const reachedStart = await ipc.paginateBack(
        activeRoomId,
        activeThreadRoot ?? undefined,
      );
      set((s) => ({ exhausted: { ...s.exhausted, [key]: reachedStart } }));
    } catch (error) {
      get().showBanner("error", ipc.asUwuError(error).message);
    } finally {
      set((s) => ({ paginating: { ...s.paginating, [key]: false } }));
    }
  },

  applyTyping: ({ roomId, users }) =>
    set((s) => ({ typing: { ...s.typing, [roomId]: users } })),

  setDraft: (key, patch) =>
    set((s) => ({
      drafts: { ...s.drafts, [key]: { ...(s.drafts[key] ?? EMPTY_DRAFT), ...patch } },
    })),

  clearDraft: (key) =>
    set((s) => ({ drafts: { ...s.drafts, [key]: { ...EMPTY_DRAFT } } })),

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  setVerificationRequest: (verificationRequest) =>
    set({ verificationRequest, sasState: null }),

  applyVerificationUpdate: (update) =>
    set((s) => {
      if (isSasUpdate(update)) {
        const finished = update.state === "done" || update.state === "cancelled";
        return {
          sasState: update,
          // Keep the modal up on completion so the user sees the outcome; the
          // modal itself dismisses on acknowledgement.
          verificationRequest: finished ? s.verificationRequest : s.verificationRequest,
        };
      }
      if (update.state === "done" || update.state === "cancelled") {
        return { verificationRequest: null, sasState: null };
      }
      return { verificationRequest: update };
    }),

  setCallRoom: (callRoomId) => set({ callRoomId }),

  showBanner: (tone, message) => set({ banner: { tone, message } }),
  dismissBanner: () => set({ banner: null }),

  reset: () => set({ ...initial, bootstrapped: true }),
}));

// ---------------------------------------------------------------------------
// selectors
// ---------------------------------------------------------------------------

export function selectActiveRoom(s: State): RoomSummary | undefined {
  return s.rooms.find((r) => r.id === s.activeRoomId);
}

export function selectActiveTimelineKey(s: State): string | null {
  if (!s.activeRoomId) return null;
  return timelineKey({
    roomId: s.activeRoomId,
    threadRoot: s.activeThreadRoot ?? undefined,
  });
}

export function selectDraft(s: State, key: string | null): Draft {
  return (key && s.drafts[key]) || EMPTY_DRAFT;
}

/**
 * The rooms the sidebar should show, after the space, filter and search are
 * applied. Spaces themselves are never listed as rooms — they're the rail.
 *
 * This is a plain function rather than a store selector on purpose: it builds a
 * new array every call, and zustand compares snapshots by reference, so passing
 * it to `useStore` would re-render forever. Callers memoise it instead.
 */
export function filterRooms(
  rooms: RoomSummary[],
  {
    activeSpaceId,
    filter,
    search,
    spaces,
  }: Pick<State, "activeSpaceId" | "filter" | "search" | "spaces">,
): RoomSummary[] {
  const needle = search.trim().toLowerCase();

  // Space membership is recorded twice in Matrix and neither half is reliable
  // alone: the space lists children via `m.space.child`, and a room *may* point
  // back with `m.space.parent` — but most rooms never set the parent event. So
  // the children list is the primary source and `parentSpaces` is a fallback.
  const children = activeSpaceId
    ? new Set(spaces.find((s) => s.id === activeSpaceId)?.children ?? [])
    : null;

  const visible = rooms.filter((room) => {
    if (room.isSpace) return false;
    if (room.membership === "left" || room.membership === "banned") return false;

    if (activeSpaceId) {
      const inSpace =
        children?.has(room.id) || room.parentSpaces.includes(activeSpaceId);
      if (!inSpace) return false;
    }

    switch (filter) {
      case "unread":
        if (!room.hasUnread) return false;
        break;
      case "dms":
        if (!room.isDirect) return false;
        break;
      case "muted":
        if (!room.isMuted) return false;
        break;
    }

    if (needle) {
      const haystack = `${room.name} ${room.canonicalAlias ?? ""} ${room.topic ?? ""}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }

    return true;
  });

  // Sort here rather than trusting the arrival order of diffs: a snapshot and a
  // stream of updates shouldn't produce a different-looking list.
  //
  // Favourites sort first so they pin to the top of whichever group they land
  // in — they're a priority marker, not a separate section to go hunting in.
  return visible.sort((a, b) => {
    if (a.isFavourite !== b.isFavourite) return a.isFavourite ? -1 : 1;
    const at = a.latest?.timestamp ?? a.recency;
    const bt = b.latest?.timestamp ?? b.recency;
    return bt - at || a.name.localeCompare(b.name);
  });
}

export interface RoomGroup {
  title: string;
  rooms: RoomSummary[];
}

/**
 * Invites first (they're a question waiting on you), then people, then rooms.
 * Within each group the order comes from `filterRooms`, so favourites are
 * already on top.
 */
export function groupRooms(rooms: RoomSummary[]): RoomGroup[] {
  const invites = rooms.filter((r) => r.membership === "invited");
  const joined = rooms.filter((r) => r.membership !== "invited");

  const groups: RoomGroup[] = [];
  if (invites.length) groups.push({ title: "invites", rooms: invites });

  const dms = joined.filter((r) => r.isDirect);
  const channels = joined.filter((r) => !r.isDirect);

  if (dms.length) groups.push({ title: "direct messages", rooms: dms });
  if (channels.length) groups.push({ title: "rooms", rooms: channels });

  return groups;
}

export function selectUnreadTotal(s: State): number {
  return s.rooms.reduce((total, room) => total + room.notificationCount, 0);
}
