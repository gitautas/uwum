/**
 * Typed wrappers over the Tauri command surface.
 *
 * Every backend call goes through here so components never touch `invoke`
 * directly and never have to remember an argument name.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  CallCredentials,
  CallParticipants,
  DeviceInfo,
  Profile,
  ProfileUpdate,
  HomeserverInfo,
  NewRoom,
  NewRoomResult,
  RecoveryStatus,
  RoomMember,
  RoomPermissions,
  RoomsSnapshot,
  RoomsUpdate,
  SasStateInfo,
  SendOptions,
  SessionInfo,
  SpaceSummary,
  SyncStatus,
  TimelineItem,
  TimelineUpdate,
  TypingUpdate,
  UserContext,
  UwuError,
  VerificationRequestInfo,
} from "./types";

/** Rust errors arrive as `{ kind, message }`; anything else is a real surprise. */
export function asUwuError(error: unknown): UwuError {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error
  ) {
    return error as UwuError;
  }
  return { kind: "other", message: String(error) };
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

export const discoverHomeserver = (server: string) =>
  invoke<HomeserverInfo>("discover_homeserver", { server });

export const loginPassword = (server: string, username: string, password: string) =>
  invoke<SessionInfo>("login_password", { server, username, password });

export const loginSso = (server: string, providerId?: string) =>
  invoke<SessionInfo>("login_sso", { server, providerId: providerId ?? null });

export const restoreSession = () => invoke<SessionInfo | null>("restore_session");

export const currentSession = () => invoke<SessionInfo | null>("current_session");

export const logout = (wipe = false) => invoke<void>("logout", { wipe });

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------

/**
 * A snapshot of the room list.
 *
 * Sync starts when the session is restored, which is before the UI mounts, so
 * the backend's first push has no listener. Call this once after subscribing;
 * diffs keep it current from then on.
 */
export const getRooms = () => invoke<RoomsSnapshot>("get_rooms");

export const getSpaces = () => invoke<SpaceSummary[]>("get_spaces");

export const getMembers = (roomId: string) =>
  invoke<RoomMember[]>("get_members", { roomId });

/** Make a room. Returns its ID, plus a warning if filing it under a space failed. */
export const createRoom = (room: NewRoom) =>
  invoke<NewRoomResult>("create_room", { room });

export const joinRoom = (aliasOrId: string) =>
  invoke<string>("join_room", { aliasOrId });

/** Leave a room. `forget` also drops it from the account entirely. */
export const leaveRoom = (roomId: string, forget = false) =>
  invoke<void>("leave_room", { roomId, forget });

/** Rename a room or change its topic. Omitted fields are left alone. */
export const updateRoom = (roomId: string, patch: { name?: string; topic?: string }) =>
  invoke<void>("update_room", {
    roomId,
    name: patch.name ?? null,
    topic: patch.topic ?? null,
  });

export const getRoomPermissions = (roomId: string) =>
  invoke<RoomPermissions>("get_room_permissions", { roomId });

export const inviteUser = (roomId: string, userId: string) =>
  invoke<void>("invite_user", { roomId, userId });

export const setTyping = (roomId: string, typing: boolean) =>
  invoke<void>("set_typing", { roomId, typing });

export const setRoomFavourite = (roomId: string, favourite: boolean) =>
  invoke<void>("set_room_favourite", { roomId, favourite });

export const setRoomLowPriority = (roomId: string, lowPriority: boolean) =>
  invoke<void>("set_room_low_priority", { roomId, lowPriority });

export const setRoomMuted = (roomId: string, muted: boolean) =>
  invoke<void>("set_room_muted", { roomId, muted });

export const setRoomMarkedUnread = (roomId: string, unread: boolean) =>
  invoke<void>("set_room_marked_unread", { roomId, unread });

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

export const openTimeline = (roomId: string, threadRoot?: string) =>
  invoke<TimelineItem[]>("open_timeline", { roomId, threadRoot: threadRoot ?? null });

export const closeTimeline = (roomId: string, threadRoot?: string) =>
  invoke<void>("close_timeline", { roomId, threadRoot: threadRoot ?? null });

export const sendMessage = (roomId: string, options: SendOptions) =>
  invoke<void>("send_message", {
    roomId,
    options: {
      body: options.body,
      markdown: options.markdown ?? false,
      replyTo: options.replyTo ?? null,
      threadRoot: options.threadRoot ?? null,
      msgtype: options.msgtype ?? null,
    },
  });

/** Resolves to `true` once there's nothing older left to load. */
export const paginateBack = (roomId: string, threadRoot?: string) =>
  invoke<boolean>("paginate_back", { roomId, threadRoot: threadRoot ?? null });

export const toggleReaction = (
  roomId: string,
  eventId: string,
  key: string,
  threadRoot?: string,
) =>
  invoke<boolean>("toggle_reaction", {
    roomId,
    eventId,
    key,
    threadRoot: threadRoot ?? null,
  });

export const editMessage = (
  roomId: string,
  eventId: string,
  body: string,
  markdown = false,
  threadRoot?: string,
) =>
  invoke<void>("edit_message", {
    roomId,
    eventId,
    body,
    markdown,
    threadRoot: threadRoot ?? null,
  });

export const redactEvent = (
  roomId: string,
  eventId: string,
  reason?: string,
  threadRoot?: string,
) =>
  invoke<void>("redact_event", {
    roomId,
    eventId,
    reason: reason ?? null,
    threadRoot: threadRoot ?? null,
  });

export const markRoomRead = (roomId: string) => invoke<void>("mark_room_read", { roomId });

export const sendReadReceipt = (roomId: string, eventId: string) =>
  invoke<void>("send_read_receipt", { roomId, eventId });

export const sendAttachment = (
  roomId: string,
  path: string,
  caption?: string,
  threadRoot?: string,
) =>
  invoke<void>("send_attachment", {
    roomId,
    path,
    caption: caption ?? null,
    threadRoot: threadRoot ?? null,
  });

/**
 * Send a file the WebView holds as bytes — a pasted screenshot, an image
 * dragged out of another app.
 *
 * The bytes go in the request body rather than the arguments: as JSON they'd
 * serialise to a numeric array several times the size of the file. Everything
 * else rides in headers, which have to be ASCII, so text is percent-encoded.
 */
export const sendAttachmentBytes = (
  roomId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
  threadRoot?: string,
  caption?: string,
) =>
  invoke<void>("send_attachment_bytes", file.bytes, {
    headers: {
      "x-room-id": roomId,
      "x-filename": encodeURIComponent(file.name),
      "x-mime": file.type,
      "x-thread-root": threadRoot ?? "",
      "x-caption": caption ? encodeURIComponent(caption) : "",
    },
  });

export const getPinnedEvents = (roomId: string) =>
  invoke<TimelineItem[]>("get_pinned_events", { roomId });

export const getEventBody = (roomId: string, eventId: string) =>
  invoke<string | null>("get_event_body", { roomId, eventId });

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

export const saveMedia = (mxc: string, destination: string) =>
  invoke<void>("save_media", { mxc, destination });

/**
 * Turn an `mxc://` URI into something an `<img>` can load.
 *
 * The bytes are served by the Rust `uwum://` protocol handler, which fetches
 * through the SDK's media cache and lets the WebView do the rest.
 */
export function mediaUrl(
  mxc: string | null | undefined,
  size?: { width: number; height: number },
): string | undefined {
  if (!mxc || !mxc.startsWith("mxc://")) return undefined;

  const base = `uwum://media/${encodeURIComponent(mxc)}`;
  if (!size) return base;

  // Ask for 2× so the image stays sharp on retina displays.
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const w = snapUp(size.width * scale);
  const h = snapUp(size.height * scale);
  return `${base}?w=${w}&h=${h}`;
}

/** The only thumbnail sizes we ever ask a homeserver for. */
const THUMBNAIL_STEPS = [32, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048];

/**
 * Round a requested dimension up to the next standard step.
 *
 * The size is part of the URL, so it's also the cache key — in the WebView, in
 * the SDK's media store, and on the homeserver. Asking for 68px in one place
 * and 76px in another means the same avatar is fetched twice and cached twice,
 * and for *remote* media each miss is a federation round trip that can take
 * seconds or fail outright. A dozen buckets is plenty of sharpness and turns
 * every avatar in the app into one shared fetch.
 */
function snapUp(value: number): number {
  return (
    THUMBNAIL_STEPS.find((step) => step >= value) ??
    THUMBNAIL_STEPS[THUMBNAIL_STEPS.length - 1]
  );
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

export const requestVerification = (userId?: string) =>
  invoke<void>("request_verification", { userId: userId ?? null });

export const acceptVerification = (userId: string, flowId: string) =>
  invoke<void>("accept_verification", { userId, flowId });

export const confirmVerification = (userId: string, flowId: string) =>
  invoke<void>("confirm_verification", { userId, flowId });

export const mismatchVerification = (userId: string, flowId: string) =>
  invoke<void>("mismatch_verification", { userId, flowId });

export const cancelVerification = (userId: string, flowId: string) =>
  invoke<void>("cancel_verification", { userId, flowId });

export const getProfile = (userId?: string) =>
  invoke<Profile>("get_profile", { userId: userId ?? null });

export const setProfile = (update: ProfileUpdate) =>
  invoke<void>("set_profile", { update });

/** Verification, shared rooms and any existing DM — our side of a profile. */
export const getUserContext = (userId: string) =>
  invoke<UserContext>("get_user_context", { userId });

/** The DM with this person, created if there isn't one yet. */
export const openDm = (userId: string) => invoke<string>("open_dm", { userId });

/** Upload a local file to the media repo, returning its `mxc://` URI. */
export const uploadMedia = (path: string) => invoke<string>("upload_media", { path });

export const getOwnDevices = () => invoke<DeviceInfo[]>("get_own_devices");

export const verifyDevice = (deviceId: string) =>
  invoke<void>("verify_device", { deviceId });

export const getRecoveryStatus = () => invoke<RecoveryStatus>("get_recovery_status");

export const enableRecovery = () => invoke<string>("enable_recovery");

export const recoverWithKey = (recoveryKey: string) =>
  invoke<void>("recover_with_key", { recoveryKey });

// ---------------------------------------------------------------------------
// calls
// ---------------------------------------------------------------------------

export const joinCall = (roomId: string, focusOverride?: string) =>
  invoke<CallCredentials>("join_call", {
    roomId,
    focusOverride: focusOverride ?? null,
  });

export const leaveCall = (roomId: string) => invoke<void>("leave_call", { roomId });

export const refreshCallMembership = (roomId: string) =>
  invoke<void>("refresh_call_membership", { roomId });

export const getCallParticipants = (roomId: string) =>
  invoke<CallParticipants>("get_call_participants", { roomId });

export const getActiveCalls = () => invoke<string[]>("get_active_calls");

// ---------------------------------------------------------------------------
// pushed events
// ---------------------------------------------------------------------------

/** The "settings…" menu item — on macOS that's where `cmd+,` arrives. */
export const onOpenSettings = (fn: () => void): Promise<UnlistenFn> =>
  listen("uwum://open-settings", () => fn());

export const onRooms = (fn: (update: RoomsUpdate) => void): Promise<UnlistenFn> =>
  listen<RoomsUpdate>("matrix://rooms", (e) => fn(e.payload));

export const onTimeline = (fn: (update: TimelineUpdate) => void): Promise<UnlistenFn> =>
  listen<TimelineUpdate>("matrix://timeline", (e) => fn(e.payload));

export const onTyping = (fn: (update: TypingUpdate) => void): Promise<UnlistenFn> =>
  listen<TypingUpdate>("matrix://typing", (e) => fn(e.payload));

export const onSyncStatus = (fn: (status: SyncStatus) => void): Promise<UnlistenFn> =>
  listen<SyncStatus>("matrix://sync-status", (e) => fn(e.payload));

export const onVerificationState = (
  fn: (payload: { state: string }) => void,
): Promise<UnlistenFn> =>
  listen<{ state: string }>("matrix://verification-state", (e) => fn(e.payload));

export const onVerificationRequest = (
  fn: (request: VerificationRequestInfo) => void,
): Promise<UnlistenFn> =>
  listen<VerificationRequestInfo>("matrix://verification-request", (e) => fn(e.payload));

export const onVerificationUpdate = (
  fn: (update: VerificationRequestInfo | SasStateInfo) => void,
): Promise<UnlistenFn> =>
  listen<VerificationRequestInfo | SasStateInfo>("matrix://verification-update", (e) =>
    fn(e.payload),
  );
