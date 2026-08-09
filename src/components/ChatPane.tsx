import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { call } from "../lib/call";
import * as ipc from "../lib/ipc";
import type { RoomSummary } from "../lib/types";
import { useStore } from "../store";
import { CallBar, useCallState } from "./CallBar";
import { Composer } from "./Composer";
import { TimelineView } from "./TimelineView";
import { VerifyBanner } from "./VerificationModal";
import { Avatar, ChannelBadge, Icon, Tag } from "./ui";

export function ChatPane({ room }: { room: RoomSummary }) {
  const { threadRoot, showInfo, toggleInfo, openThread, showBanner } = useStore(
    useShallow((s) => ({
      threadRoot: s.activeThreadRoot,
      showInfo: s.showInfo,
      toggleInfo: s.toggleInfo,
      openThread: s.openThread,
      showBanner: s.showBanner,
    })),
  );

  const callState = useCallState();
  const inThisCall = callState.roomId === room.id && callState.status !== "idle";

  async function toggleCall() {
    try {
      if (inThisCall) {
        await call.leave();
      } else {
        await call.join(room.id);
      }
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        flex: 1,
        minWidth: 480,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-canvas)",
      }}
    >
      <div
        className="uwu-drag"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 22px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "rgba(17,17,23,.6)",
        }}
      >
        <div style={{ position: "relative", flex: "none" }}>
          <Avatar id={room.id} name={room.name} mxc={room.avatarUrl} size={42} radius={15} />
          {!room.isDirect && (
            <ChannelBadge
              kind={room.isVideoRoom ? "video" : "text"}
              size={18}
              ring="var(--ink-950)"
            />
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="uwu-ellipsis"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 19,
                letterSpacing: "-0.01em",
              }}
            >
              {room.name}
            </span>
            {room.isEncrypted && (
              <Tag icon="lock-key" colour="var(--accent-primary)">
                e2e
              </Tag>
            )}
          </div>
          <div
            className="uwu-ellipsis"
            style={{
              fontSize: 12.5,
              color: "var(--text-secondary)",
              maxWidth: 520,
            }}
          >
            {room.topic}{" "}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-tertiary)",
                fontSize: 11.5,
              }}
            >
              {room.canonicalAlias ?? ""}
            </span>
          </div>
        </div>

        <div
          className="uwu-no-drag"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-tertiary)",
              marginRight: 4,
            }}
          >
            {room.memberCount}
          </span>
          <HeaderButton
            icon={inThisCall ? "phone-x" : "phone-call"}
            title={inThisCall ? "leave the call" : "start a voice call"}
            highlight={inThisCall || room.hasActiveCall}
            danger={inThisCall}
            onClick={() => void toggleCall()}
          />
          <HeaderButton
            icon="info"
            title="room info"
            highlight={showInfo}
            onClick={toggleInfo}
          />
        </div>
      </div>

      <VerifyBanner />

      {threadRoot && (
        <ThreadHeader roomId={room.id} threadRoot={threadRoot} onClose={() => void openThread(null)} />
      )}

      <TimelineView roomId={room.id} threadRoot={threadRoot ?? undefined} />

      <CallBar />

      <Composer
        roomId={room.id}
        roomName={room.canonicalAlias ?? room.name}
        threadRoot={threadRoot ?? undefined}
        encrypted={room.isEncrypted}
      />
    </div>
  );
}

function ThreadHeader({
  roomId,
  threadRoot,
  onClose,
}: {
  roomId: string;
  threadRoot: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .getEventBody(roomId, threadRoot)
      .then((body) => {
        if (!cancelled) setPreview(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId, threadRoot]);

  return (
    <div
      style={{
        margin: "14px 22px 0",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 16,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderLeft: "2px solid var(--accent-quaternary)",
      }}
    >
      <Icon name="chats-circle" size={15} color="var(--accent-quaternary)" />
      <span
        className="uwu-ellipsis"
        style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}
      >
        thread{preview ? ` · ${preview}` : ""}
      </span>
      <button onClick={onClose} title="back to the room" style={{ cursor: "pointer", display: "flex" }}>
        <Icon name="x" size={14} color="var(--text-tertiary)" />
      </button>
    </div>
  );
}

function HeaderButton({
  icon,
  title,
  onClick,
  highlight,
  danger,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: 9,
        borderRadius: 12,
        background: danger ? "var(--status-danger)" : "var(--surface-card-raised)",
        display: "flex",
        cursor: "pointer",
      }}
    >
      <Icon
        name={icon}
        size={17}
        color={
          danger
            ? "var(--ink-950)"
            : highlight
              ? "var(--accent-primary)"
              : "var(--text-secondary)"
        }
      />
    </button>
  );
}

/** Shown when nothing is selected yet. */
export function EmptyPane() {
  const rooms = useStore((s) => s.rooms);

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "var(--surface-canvas)",
        color: "var(--text-tertiary)",
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 28,
          background: "var(--surface-card)",
          border: "2px dashed var(--border-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: "rotate(-4deg)",
        }}
      >
        <Icon name="chats-teardrop" size={34} color="var(--text-tertiary)" />
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 19,
          color: "var(--text-secondary)",
        }}
      >
        pick a room~
      </div>
      <div style={{ fontSize: 13 }}>
        {rooms.length === 0
          ? "still syncing your rooms…"
          : `${rooms.filter((r) => !r.isSpace).length} rooms waiting for you`}
      </div>
    </div>
  );
}
