import { useState } from "react";

import {
  accentFor,
  displayNameFor,
  formatBytes,
  formatDuration,
  formatTime,
  localpart,
} from "../lib/display";
import * as ipc from "../lib/ipc";
import { mediaUrl } from "../lib/ipc";
import { useMediaBlob } from "../lib/blobMedia";
import { renderFormattedBody } from "../lib/richText";
import type { Content, EventItem, MediaInfo } from "../lib/types";
import { useStore } from "../store";
import { AvatarButton, useProfileAnchor } from "./ProfileCard";
import { Icon, Spinner } from "./ui";

const QUICK_REACTIONS = ["uwu", "♡", "^-^", ">_<", "nice", "oh no"];

export function MessageRow({
  item,
  roomId,
  threadRoot,
  showHeader,
  onReply,
  onOpenThread,
}: {
  item: EventItem;
  roomId: string;
  threadRoot?: string;
  /** False when this message continues a run from the same author. */
  showHeader: boolean;
  onReply: (eventId: string) => void;
  onOpenThread: (rootEventId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const setDraft = useStore((s) => s.setDraft);
  const showBanner = useStore((s) => s.showBanner);
  const senderAnchor = useProfileAnchor(item.sender);

  const author = displayNameFor(item.sender, item.senderName);
  const accent = accentFor(item.sender);
  const pending = item.sendState?.status === "notSentYet";
  const failed = item.sendState?.status === "failed";

  async function react(key: string) {
    if (!item.eventId) return;
    setPickerOpen(false);
    try {
      await ipc.toggleReaction(roomId, item.eventId, key, threadRoot);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  async function remove() {
    if (!item.eventId) return;
    try {
      await ipc.redactEvent(roomId, item.eventId, undefined, threadRoot);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  // State changes and membership events render as thin one-line notes rather
  // than full message rows, matching the design's system lines.
  if (isSystemEvent(item.content)) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 0 6px 52px",
          color: "var(--text-tertiary)",
          fontSize: 12,
        }}
      >
        <Icon name={systemIcon(item.content)} size={12} color="var(--accent-primary)" />
        <span className="selectable">{systemText(item, author)}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
          {formatTime(item.timestamp)}
        </span>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPickerOpen(false);
      }}
      style={{
        position: "relative",
        display: "flex",
        gap: 12,
        padding: "5px 8px",
        borderRadius: 16,
        transition: "background var(--dur-fast) var(--ease-out)",
        background: item.isHighlighted
          ? "rgba(255,97,135,.08)"
          : hovered
            ? "rgba(255,255,255,.035)"
            : "transparent",
        opacity: pending ? 0.72 : 1,
      }}
    >
      <div
        style={{
          width: 40,
          flex: "none",
          display: "flex",
          justifyContent: "center",
          paddingTop: 2,
        }}
      >
        {showHeader ? (
          <AvatarButton
            userId={item.sender}
            name={author}
            mxc={item.senderAvatar}
            size={38}
            radius={14}
          />
        ) : (
          hovered && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                color: "var(--text-tertiary)",
                paddingTop: 4,
              }}
            >
              {formatTime(item.timestamp)}
            </span>
          )
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {showHeader && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 3,
              flexWrap: "wrap",
            }}
          >
            <button
              {...senderAnchor}
              aria-label={`${author}'s profile`}
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 14.5,
                color: accent,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {author}
            </button>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--text-tertiary)",
              }}
            >
              {formatTime(item.timestamp)}
            </span>
            {item.shield && (
              <span
                title={item.shield.message}
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <Icon
                  name="warning"
                  size={12}
                  color={
                    item.shield.colour === "red"
                      ? "var(--status-danger)"
                      : "var(--text-tertiary)"
                  }
                />
              </span>
            )}
          </div>
        )}

        {item.reply && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 5,
              padding: "5px 11px",
              borderRadius: 12,
              background: "rgba(255,255,255,.04)",
              borderLeft: "2px solid var(--accent-tertiary)",
              maxWidth: 520,
            }}
          >
            <Icon name="arrow-bend-up-left" size={12} color="var(--accent-tertiary)" />
            <span className="uwu-ellipsis" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {item.reply.senderName ??
                (item.reply.sender ? localpart(item.reply.sender) : "someone")}
              : {item.reply.body ?? "…"}
            </span>
          </div>
        )}

        <ContentBody content={item.content} emojiOnly={item.isEmojiOnly} />

        {item.isEdited && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-tertiary)",
              marginLeft: 6,
            }}
          >
            (edited)
          </span>
        )}

        {item.reactions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
            {item.reactions.map((reaction) => (
              <button
                key={reaction.key}
                onClick={() => void react(reaction.key)}
                title={reaction.senders.map(localpart).join(", ")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  opacity: reaction.pending ? 0.55 : 1,
                  transition: "all var(--dur-fast) var(--ease-bounce)",
                  ...(reaction.mine
                    ? {
                        background: "rgba(200,255,77,.16)",
                        border: "1px solid var(--accent-primary)",
                        color: "var(--accent-primary)",
                      }
                    : {
                        background: "var(--surface-card-raised)",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }),
                }}
              >
                <span>{reaction.key}</span>
                <span style={{ fontWeight: 700 }}>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}

        {item.threadSummary && item.eventId && (
          <button
            onClick={() => onOpenThread(item.eventId!)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              padding: "6px 12px 6px 8px",
              borderRadius: 999,
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              cursor: "pointer",
            }}
          >
            <Icon name="chats-circle" size={14} color="var(--accent-quaternary)" />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 12.5,
                color: "var(--accent-quaternary)",
              }}
            >
              {item.threadSummary.numReplies}{" "}
              {item.threadSummary.numReplies === 1 ? "reply" : "replies"} in thread
            </span>
          </button>
        )}

        {failed && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              color: "var(--status-danger)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="warning-circle" size={12} color="var(--status-danger)" />
            couldn't send — it'll retry when you're back online
          </div>
        )}
      </div>

      {pending && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-tertiary)",
            alignSelf: "flex-end",
            animation: "uwuPulse 1.2s infinite",
            flex: "none",
          }}
        >
          sending…
        </span>
      )}

      {hovered && item.eventId && (
        <div
          style={{
            position: "absolute",
            top: -12,
            right: 12,
            display: "flex",
            gap: 2,
            padding: 3,
            borderRadius: 12,
            background: "var(--surface-card-raised)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-card)",
            zIndex: 2,
          }}
        >
          <ActionButton
            icon="smiley"
            title="react"
            onClick={() => setPickerOpen((v) => !v)}
          />
          {item.canReply && (
            <ActionButton
              icon="arrow-bend-up-left"
              title="reply"
              onClick={() => onReply(item.eventId!)}
            />
          )}
          <ActionButton
            icon="chats-circle"
            title="reply in thread"
            onClick={() => onOpenThread(item.threadRoot ?? item.eventId!)}
          />
          {item.isEditable && (
            <ActionButton
              icon="pencil-simple"
              title="edit"
              onClick={() => {
                const key = threadRoot ? `${roomId}|${threadRoot}` : roomId;
                setDraft(key, {
                  editing: item.eventId,
                  body: plainBody(item.content),
                  replyTo: null,
                });
              }}
            />
          )}
          {item.isOwn && (
            <ActionButton icon="trash" title="delete" onClick={() => void remove()} danger />
          )}
        </div>
      )}

      {pickerOpen && (
        <div
          style={{
            position: "absolute",
            top: 18,
            right: 12,
            display: "flex",
            gap: 4,
            padding: 6,
            borderRadius: 14,
            background: "var(--surface-card-raised)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-pop)",
            zIndex: 3,
          }}
        >
          {QUICK_REACTIONS.map((key) => (
            <button
              key={key}
              onClick={() => void react(key)}
              style={{
                padding: "4px 9px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,.07)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {key}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  title,
  onClick,
  danger,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 26,
        borderRadius: 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon
        name={icon}
        size={14}
        color={danger ? "var(--status-danger)" : "var(--text-secondary)"}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

function ContentBody({ content, emojiOnly }: { content: Content; emojiOnly: boolean }) {
  const textStyle = {
    fontSize: emojiOnly ? 34 : 14.5,
    lineHeight: emojiOnly ? 1.2 : 1.55,
    color: "var(--text-primary)",
    maxWidth: 640,
    textWrap: "pretty" as const,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  };

  switch (content.kind) {
    case "text":
      return (
        <div className="selectable" style={textStyle}>
          <Body body={content.body} formatted={content.formatted} />
        </div>
      );

    case "emote":
      return (
        <div className="selectable" style={{ ...textStyle, fontStyle: "italic" }}>
          <Body body={content.body} formatted={content.formatted} />
        </div>
      );

    case "notice":
      return (
        <div
          className="selectable"
          style={{
            ...textStyle,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        >
          <Body body={content.body} formatted={content.formatted} />
        </div>
      );

    case "image":
    case "sticker":
      return <ImageBody body={content.body} media={content.media} sticker={content.kind === "sticker"} />;

    case "video":
      return <VideoBody body={content.body} media={content.media} />;

    case "audio":
      return <AudioBody body={content.body} media={content.media} />;

    case "file":
      return <FileBody body={content.body} media={content.media} />;

    case "location":
      return (
        <a
          href={content.geoUri}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}
        >
          <Icon name="map-pin" size={16} color="var(--accent-quaternary)" />
          {content.body || "shared a location"}
        </a>
      );

    case "poll":
      return (
        <div
          style={{
            padding: 14,
            borderRadius: 16,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            maxWidth: 420,
          }}
        >
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5 }}>
            {content.question}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {content.answers.map((answer, i) => (
              <div
                key={i}
                style={{
                  padding: "7px 12px",
                  borderRadius: 12,
                  background: "var(--surface-card-raised)",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                {answer}
              </div>
            ))}
          </div>
          {content.ended && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-tertiary)" }}>
              this poll has ended
            </div>
          )}
        </div>
      );

    case "redacted":
      return (
        <div style={{ fontSize: 13.5, color: "var(--text-tertiary)", fontStyle: "italic" }}>
          message deleted
        </div>
      );

    case "unableToDecrypt":
      return (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 13px",
            borderRadius: 14,
            background: "rgba(177,78,255,.08)",
            border: "1px dashed rgba(177,78,255,.4)",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
          title={content.reason}
        >
          <Icon name="lock-key-open" size={14} color="var(--accent-tertiary)" />
          can't decrypt this one — restore your key backup in settings → security
        </div>
      );

    case "callInvite":
    case "rtcNotification":
      return (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13.5,
            color: "var(--text-secondary)",
          }}
        >
          <Icon name="phone-call" size={15} color="var(--accent-primary)" />
          started a call
        </div>
      );

    default:
      return (
        <div style={{ fontSize: 13, color: "var(--text-tertiary)", fontStyle: "italic" }}>
          unsupported message
        </div>
      );
  }
}

/**
 * Prefer the sender's formatted body, fall back to plain text.
 *
 * `formatted_body` is HTML from an untrusted source, so `renderFormattedBody`
 * rebuilds it as React elements from an allowlist rather than injecting markup.
 */
function Body({ body, formatted }: { body: string; formatted: string | null }) {
  if (!formatted) return <>{body}</>;

  const rendered = renderFormattedBody(formatted);
  return <>{rendered ?? body}</>;
}

function ImageBody({
  body,
  media,
  sticker,
}: {
  body: string;
  media: MediaInfo;
  sticker: boolean;
}) {
  const openLightbox = useStore((s) => s.openLightbox);
  const maxWidth = sticker ? 160 : 400;
  const maxHeight = sticker ? 160 : 320;

  // Preserve the aspect ratio from the event so the timeline doesn't jump as
  // images load.
  const ratio = media.width && media.height ? media.width / media.height : 4 / 3;
  const width = Math.min(maxWidth, maxHeight * ratio);
  const height = width / ratio;

  const src = mediaUrl(media.thumbnailMxc ?? media.mxc, {
    width: Math.round(width),
    height: Math.round(height),
  });

  if (!src) return <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{body}</div>;

  return (
    <img
      src={src}
      alt={body}
      loading="lazy"
      draggable={false}
      // The lightbox gets the *original* URI, not the thumbnail being shown.
      onClick={() => media.mxc && openLightbox(media.mxc, body || "picture")}
      style={{
        cursor: media.mxc ? "zoom-in" : "default",
        marginTop: 4,
        width,
        height,
        objectFit: "cover",
        borderRadius: sticker ? 8 : 16,
        border: sticker ? "none" : "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
      }}
    />
  );
}

function VideoBody({ body, media }: { body: string; media: MediaInfo }) {
  const { url, error } = useMediaBlob(media.mxc, media.mimetype);

  const frame: React.CSSProperties = {
    marginTop: 4,
    maxWidth: 400,
    maxHeight: 320,
    borderRadius: 16,
    border: "1px solid var(--border-subtle)",
    background: "var(--ink-950)",
  };

  if (error) {
    return (
      <div
        style={{ ...frame, padding: "12px 16px", fontSize: 13, color: "var(--status-danger)" }}
      >
        couldn't load {body}
      </div>
    );
  }

  if (!url) {
    return (
      <div
        style={{
          ...frame,
          width: 320,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spinner />
      </div>
    );
  }

  return <video src={url} controls preload="metadata" style={frame} aria-label={body} />;
}

function AudioBody({ body, media }: { body: string; media: MediaInfo }) {
  const { url } = useMediaBlob(media.mxc, media.mimetype);

  return (
    <div
      style={{
        marginTop: 4,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        borderRadius: 16,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        maxWidth: 340,
      }}
    >
      <Icon
        name={media.isVoice ? "microphone" : "music-notes"}
        size={16}
        color="var(--accent-secondary)"
      />
      {url ? (
        <audio src={url} controls style={{ height: 30, flex: 1 }} aria-label={body} />
      ) : (
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <Spinner size={14} />
        </div>
      )}
      {media.durationMs != null && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-tertiary)",
          }}
        >
          {formatDuration(media.durationMs)}
        </span>
      )}
    </div>
  );
}

function FileBody({ body, media }: { body: string; media: MediaInfo }) {
  return (
    <div
      style={{
        marginTop: 4,
        display: "inline-flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 14px",
        borderRadius: 16,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        maxWidth: 360,
      }}
    >
      <Icon name="file-arrow-down" size={18} color="var(--accent-quaternary)" />
      <div style={{ minWidth: 0 }}>
        <div
          className="uwu-ellipsis"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13 }}
        >
          {body}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-tertiary)",
          }}
        >
          {formatBytes(media.size)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isSystemEvent(content: Content): boolean {
  return (
    content.kind === "membership" ||
    content.kind === "profileChange" ||
    content.kind === "state"
  );
}

function systemIcon(content: Content): string {
  if (content.kind === "membership") return "user-circle";
  if (content.kind === "state") return "lock-key";
  return "user-switch";
}

function systemText(item: EventItem, author: string): string {
  const { content } = item;
  if (content.kind === "profileChange") return content.summary;

  if (content.kind === "membership") {
    const who = content.displayName ?? localpart(content.userId);
    switch (content.change) {
      case "joined":
        return `${who} joined`;
      case "left":
        return `${who} left`;
      case "invited":
        return `${author} invited ${who}`;
      case "banned":
        return `${author} banned ${who}`;
      case "kicked":
        return `${author} removed ${who}`;
      default:
        return `${who}'s membership changed`;
    }
  }

  if (content.kind === "state") {
    if (content.eventType === "m.room.encryption") {
      return `${author} turned on end-to-end encryption`;
    }
    if (content.eventType === "m.room.topic") return `${author} changed the topic`;
    if (content.eventType === "m.room.name") return `${author} renamed the room`;
    if (content.eventType === "m.room.avatar") return `${author} changed the room avatar`;
    return `${author} updated ${content.eventType.replace(/^m\.room\./, "")}`;
  }

  return "";
}

/** The text to prefill when editing a message. */
function plainBody(content: Content): string {
  return "body" in content ? content.body : "";
}
