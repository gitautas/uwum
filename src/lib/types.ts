/**
 * Mirrors `src-tauri/src/dto.rs`. Keep the two in step — the Rust side is the
 * source of truth for shapes, this is the source of truth for how we use them.
 */

export interface UwuError {
  kind:
    | "not_signed_in"
    | "auth"
    | "unknown_room"
    | "no_timeline"
    | "matrix"
    | "bad_id"
    | "client_build"
    | "timeline"
    | "room_list"
    | "io"
    | "json"
    | "http"
    | "other";
  message: string;
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

export interface SsoProvider {
  id: string;
  name: string;
  icon: string | null;
}

export interface HomeserverInfo {
  serverName: string;
  homeserverUrl: string;
  supportsPassword: boolean;
  supportsSso: boolean;
  ssoProviders: SsoProvider[];
  livekitServiceUrl: string | null;
}

export interface SessionInfo {
  userId: string;
  deviceId: string;
  homeserver: string;
  displayName: string | null;
  avatarUrl: string | null;
  insecureStorage: boolean;
}

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------

export interface LatestEvent {
  sender: string;
  senderName: string | null;
  body: string;
  timestamp: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  topic: string | null;
  canonicalAlias: string | null;
  avatarUrl: string | null;
  isDirect: boolean;
  /**
   * The other person, when a DM has exactly one of them — what the sidebar's
   * presence dot hangs off. Null for group rooms.
   */
  dmUserId: string | null;
  isEncrypted: boolean;
  isSpace: boolean;
  /** A room that holds data rather than a conversation — an image pack, say. */
  isUtility: boolean;
  isFavourite: boolean;
  isLowPriority: boolean;
  isMuted: boolean;
  membership: "joined" | "invited" | "left" | "knocked" | "banned";
  notificationCount: number;
  highlightCount: number;
  hasUnread: boolean;
  isMarkedUnread: boolean;
  memberCount: number;
  latest: LatestEvent | null;
  recency: number;
  parentSpaces: string[];
  hasActiveCall: boolean;
  /** An MSC3417 video room — a call you join, not a text room. */
  isVideoRoom: boolean;
}

/** What the create-room dialog collects. */
export interface NewRoom {
  name: string;
  topic?: string;
  /** Anyone can find and join it, and it's listed in the directory. */
  isPublic?: boolean;
  /** Alias localpart for a public room — `movies`, not `#movies:server`. */
  alias?: string;
  encrypted?: boolean;
  invite?: string[];
  /** The space to file it under, if one was open. */
  parentSpace?: string | null;
}

export interface NewRoomResult {
  roomId: string;
  /** The room was made but couldn't be filed under the space. Not an error. */
  spaceWarning: string | null;
}

/** What this account may change about a room. */
export interface RoomPermissions {
  canRename: boolean;
  canSetTopic: boolean;
  canInvite: boolean;
}

export interface SpaceSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  children: string[];
  notificationCount: number;
  highlightCount: number;
}

export interface RoomMember {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  powerLevel: number;
  membership: string;
  isIgnored: boolean;
  verification: "verified" | "unverified" | "unknown";
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

export interface MediaInfo {
  mxc: string | null;
  mimetype: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  blurhash: string | null;
  thumbnailMxc: string | null;
  waveform: number[] | null;
  isVoice: boolean;
}

export type Content =
  | { kind: "text"; body: string; formatted: string | null }
  | { kind: "emote"; body: string; formatted: string | null }
  | { kind: "notice"; body: string; formatted: string | null }
  | { kind: "image"; body: string; media: MediaInfo }
  | { kind: "video"; body: string; media: MediaInfo }
  | { kind: "audio"; body: string; media: MediaInfo }
  | { kind: "file"; body: string; media: MediaInfo }
  | { kind: "location"; body: string; geoUri: string }
  | { kind: "sticker"; body: string; media: MediaInfo }
  | { kind: "poll"; question: string; answers: string[]; ended: boolean }
  | { kind: "redacted" }
  | { kind: "unableToDecrypt"; reason: string }
  | { kind: "membership"; change: string; userId: string; displayName: string | null }
  | { kind: "profileChange"; summary: string }
  | { kind: "state"; eventType: string; stateKey: string; summary: string }
  | { kind: "callInvite" }
  | { kind: "rtcNotification"; intent: string | null }
  | { kind: "unsupported"; eventType: string };

export type SendState =
  | { status: "notSentYet"; progress: number | null }
  | { status: "failed"; error: string; isRecoverable: boolean }
  | { status: "sent"; eventId: string };

export interface Shield {
  colour: "red" | "grey";
  message: string;
}

export interface Reaction {
  key: string;
  count: number;
  mine: boolean;
  pending: boolean;
  senders: string[];
}

export interface ReplyInfo {
  eventId: string;
  sender: string | null;
  senderName: string | null;
  body: string | null;
}

export interface ThreadSummary {
  numReplies: number;
  latestSender: string | null;
  latestBody: string | null;
}

export interface EventItem {
  eventId: string | null;
  transactionId: string | null;
  sender: string;
  senderName: string | null;
  senderAvatar: string | null;
  timestamp: number;
  isOwn: boolean;
  isEditable: boolean;
  canReply: boolean;
  isHighlighted: boolean;
  isEdited: boolean;
  isEmojiOnly: boolean;
  sendState: SendState | null;
  shield: Shield | null;
  content: Content;
  reactions: Reaction[];
  reply: ReplyInfo | null;
  threadRoot: string | null;
  threadSummary: ThreadSummary | null;
  readReceipts: string[];
}

export interface TimelineItem {
  id: string;
  kind: "event" | "dateDivider" | "readMarker" | "timelineStart";
  timestamp?: number;
  event?: EventItem;
}

// ---------------------------------------------------------------------------
// diffs & pushed events
// ---------------------------------------------------------------------------

export type Diff<T> =
  | { op: "append"; values: T[] }
  | { op: "clear" }
  | { op: "pushFront"; value: T }
  | { op: "pushBack"; value: T }
  | { op: "popFront" }
  | { op: "popBack" }
  | { op: "insert"; index: number; value: T }
  | { op: "set"; index: number; value: T }
  | { op: "remove"; index: number }
  | { op: "truncate"; length: number }
  | { op: "reset"; values: T[] };

/** A numbered batch of room-list changes. */
export interface RoomsUpdate {
  seq: number;
  diffs: Diff<RoomSummary>[];
}

/** The room list as it stands, and the last batch folded into it. */
export interface RoomsSnapshot {
  seq: number;
  rooms: RoomSummary[];
}

export interface TimelineUpdate {
  /** Room ID, or `<roomId>|<threadRoot>` for a thread timeline. */
  roomId: string;
  diffs: Diff<TimelineItem>[];
}

export interface TypingUser {
  userId: string;
  displayName: string | null;
}

export interface TypingUpdate {
  roomId: string;
  users: TypingUser[];
}

// ---------------------------------------------------------------------------
// presence
// ---------------------------------------------------------------------------

/**
 * What the server says about someone's availability.
 *
 * `unknown` never comes off the wire: it's what the UI has before an answer
 * arrives, and what it falls back to on a server with presence switched off.
 */
export type PresenceState = "online" | "unavailable" | "offline" | "unknown";

export interface Presence {
  userId: string;
  presence: PresenceState;
  /**
   * The presence system's own free-text status — not the MSC4133 profile
   * status the profile card shows.
   */
  statusMsg: string | null;
  /** Unix ms, already converted from the server's relative age. */
  lastActive: number | null;
  currentlyActive: boolean;
}

export interface PresenceUpdate {
  /** Only the people whose presence actually changed. */
  users: Presence[];
  /** False on a homeserver that has presence switched off. */
  supported: boolean;
}

export interface SyncStatus {
  state: "offline" | "idle" | "running" | "error" | "terminated";
  message: string | null;
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

export interface VerificationRequestInfo {
  flowId: string;
  otherUserId: string;
  otherDeviceId: string | null;
  isSelfVerification: boolean;
  weStarted: boolean;
  state: "created" | "requested" | "ready" | "transitioned" | "done" | "cancelled";
  /** Set when the flow was cancelled before SAS ever started. */
  cancelReason: string | null;
  /** Which side sent the cancel — `null` unless the flow was cancelled. */
  cancelledByUs: boolean | null;
  /** The spec cancel code: `m.user`, `m.timeout`, `m.unknown_method`, … */
  cancelCode: string | null;
}

export interface SasEmoji {
  symbol: string;
  description: string;
}

export interface SasStateInfo {
  flowId: string;
  otherUserId: string;
  state:
    | "created"
    | "started"
    | "accepted"
    | "keysExchanged"
    | "confirmed"
    | "done"
    | "cancelled";
  emoji: SasEmoji[] | null;
  decimals: [number, number, number] | null;
  cancelReason: string | null;
  cancelledByUs: boolean | null;
  cancelCode: string | null;
}

/** The two verification payloads share an event channel; this tells them apart. */
export function isSasUpdate(
  update: VerificationRequestInfo | SasStateInfo,
): update is SasStateInfo {
  return "emoji" in update;
}

/**
 * Is this verification still running?
 *
 * A finished flow stays in the store on purpose, so the user can read the
 * outcome before dismissing it. That makes "there is a request" a useless test
 * for "a verification is in progress" — this is the one that means it.
 */
export function isLiveVerification(
  request: VerificationRequestInfo | null,
): request is VerificationRequestInfo {
  return !!request && request.state !== "done" && request.state !== "cancelled";
}

export interface Profile {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Commet's `chat.commet.profile_bio`, unwrapped from its `body` object. */
  bio: string | null;
  /** Commet's `chat.commet.profile_status`. */
  status: string | null;
  /** `gg.uwu.cover_url` — ours; no other client reads it. */
  coverUrl: string | null;
}

/** A room both of you are in, reduced to what the profile card draws. */
export interface SharedRoom {
  id: string;
  name: string;
  avatarUrl: string | null;
  isSpace: boolean;
  /** A room that holds data rather than a conversation — an image pack, say. */
  isUtility: boolean;
  isDirect: boolean;
}

/**
 * The half of a profile card that comes from our own client rather than the
 * homeserver's profile endpoint.
 */
export interface UserContext {
  userId: string;
  isMe: boolean;
  verification: "verified" | "unverified" | "unknown";
  dmRoomId: string | null;
  sharedRooms: SharedRoom[];
}

/** A partial update: omit a field to leave it, pass "" to clear it. */
export interface ProfileUpdate {
  bio?: string;
  status?: string;
  coverUrl?: string;
}

export interface DeviceInfo {
  deviceId: string;
  displayName: string | null;
  isVerified: boolean;
  /** The device this app is running as — it can't verify itself. */
  isCurrent: boolean;
  firstSeen: number;
}

export interface RecoveryStatus {
  state: "enabled" | "disabled" | "incomplete" | "unknown";
  backupExists: boolean;
  crossSigningReady: boolean;
}

// ---------------------------------------------------------------------------
// calls
// ---------------------------------------------------------------------------

export interface CallCredentials {
  livekitUrl: string;
  jwt: string;
  alias: string;
  roomId: string;
}

export interface CallParticipants {
  roomId: string;
  userIds: string[];
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// composer
// ---------------------------------------------------------------------------

export interface SendOptions {
  body: string;
  markdown?: boolean;
  replyTo?: string | null;
  threadRoot?: string | null;
  msgtype?: string | null;
  /**
   * Custom emotes the body might mention as `:shortcode:`.
   *
   * The whole set is handed over rather than only what's in the text; the
   * backend matches against the rendered HTML so Markdown and emotes both
   * survive in one message.
   */
  emotes?: { shortcode: string; url: string }[];
}

// ---------------------------------------------------------------------------
// image packs (MSC2545)
// ---------------------------------------------------------------------------

export interface PackImage {
  /** The `:name:` a person types, without the colons. */
  shortcode: string;
  url: string;
  body: string;
  isEmoticon: boolean;
  isSticker: boolean;
  width: number | null;
  height: number | null;
  size: number | null;
  mimetype: string | null;
}

export interface ImagePack {
  /** `user`, or `<roomId>|<stateKey>` for a room's pack. */
  id: string;
  source: "user" | "room";
  roomId: string | null;
  stateKey: string | null;
  displayName: string;
  avatarUrl: string | null;
  attribution: string | null;
  images: PackImage[];
  /**
   * Carried outside the room it belongs to. Always true for your own pack.
   *
   * Not a filter — every pack handed back is usable where it was asked for,
   * including a room's own packs in that room.
   */
  everywhere: boolean;
  canEdit: boolean;
}

/** Which pack an edit is aimed at — the personal one has no room. */
export interface PackTarget {
  roomId?: string | null;
  stateKey?: string | null;
}

/** One change to a pack, applied on top of whatever the server has. */
export type PackEdit =
  | {
      kind: "putImage";
      shortcode: string;
      url: string;
      body?: string | null;
      isEmoticon: boolean;
      isSticker: boolean;
      width?: number | null;
      height?: number | null;
      size?: number | null;
      mimetype?: string | null;
    }
  | { kind: "rename"; from: string; to: string }
  | { kind: "removeImage"; shortcode: string }
  | { kind: "setName"; name: string };

/** A room a shared pack could live in. */
export interface PackRoom {
  id: string;
  name: string;
}

/** One image from a pack, on its way out as an `m.sticker`. */
export interface StickerOptions {
  body: string;
  url: string;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  mimetype?: string | null;
}

/** One item from the device's photo library, with an inline thumbnail. */
export interface Photo {
  id: string;
  video: boolean;
  seconds: number;
  /** A `data:` URI, so a tile needs no second round trip to draw. */
  thumb: string;
}

export interface RecentPhotos {
  /** False everywhere there is no photo library — every desktop platform. */
  supported: boolean;
  /** The user shared only some photos. Those are the ones we can see. */
  limited: boolean;
  /** Access refused, so the grid shows why rather than looking empty. */
  denied: boolean;
  photos: Photo[];
}

/**
 * Which update path this build can take.
 *
 * `in-app` means Tauri's updater can replace this install in place; `manual`
 * means something else owns it (apt, the phone) and all we can do is point at
 * the release page. Decided in Rust — see `update.rs` for why.
 */
export type UpdateMode = "in-app" | "manual";

/** The newest published release, as read from the release manifest. */
export interface LatestRelease {
  version: string;
  notes: string;
  /** The release page, where every platform's asset is listed. */
  url: string;
}

/**
 * What the native side can see about this WebView's WebRTC support, asked for
 * only once `RTCPeerConnection` has turned out to be missing. `null` off Linux,
 * where the platform WebView has always had a WebRTC stack — see
 * `src-tauri/src/webrtc.rs`.
 */
export interface WebrtcDiagnosis {
  /**
   * `enable-webrtc`, read back from WebKitGTK after we set it — which proves
   * far less than it looks like: the property is a stub where WebRTC is
   * compiled out, so it reads back `true` on a build that has none.
   */
  settingEnabled: boolean;
  /** `enable-media-stream`, likewise. */
  mediaStreamEnabled: boolean;
  /** WebKitGTK's runtime version, e.g. `2.44.3`. */
  webkitVersion: string;
  /** Is `libgstwebrtc.so` (gst-plugins-bad) installed? */
  gstWebrtc: boolean;
  /** Is `libgstnice.so` (gstreamer1.0-nice) installed? */
  gstNice: boolean;
  /** Running from an AppImage, which brings its own WebKitGTK. */
  appimage: boolean;
}
