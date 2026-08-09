import { useEffect, useState } from "react";

import { accentFor, displayNameFor } from "../lib/display";
import * as ipc from "../lib/ipc";
import type { RoomMember, RoomSummary } from "../lib/types";
import { useStore } from "../store";
import { Avatar, Icon, RaveLabel, Spinner } from "./ui";

export function RoomInfo({ room }: { room: RoomSummary }) {
  const [members, setMembers] = useState<RoomMember[] | null>(null);
  const showBanner = useStore((s) => s.showBanner);

  useEffect(() => {
    let cancelled = false;
    setMembers(null);

    ipc
      .getMembers(room.id)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setMembers([]);
          showBanner("error", ipc.asUwuError(e).message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [room.id, showBanner]);

  // `get_members` already returns only active (joined + invited) members, so
  // this list is shown as-is rather than filtered again.
  const joined = members ?? [];
  const unverified = joined.filter((m) => m.verification !== "verified").length;

  return (
    <div
      className="uwu-scroll"
      style={{
        position: "relative",
        zIndex: 1,
        width: 296,
        flex: "none",
        borderLeft: "1px solid var(--border-subtle)",
        background: "rgba(17,17,23,.72)",
        padding: "18px 16px 24px",
      }}
    >
      <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
        <div style={{ display: "inline-block", transform: "rotate(-3deg)" }}>
          <Avatar
            id={room.id}
            name={room.name}
            mxc={room.avatarUrl}
            size={76}
            radius={26}
            fontSize={26}
          />
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 19,
            marginTop: 12,
          }}
        >
          {room.name}
        </div>
        <div
          className="selectable uwu-ellipsis"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-tertiary)",
          }}
        >
          {room.canonicalAlias ?? room.id}
        </div>
      </div>

      {room.topic && (
        <div
          className="selectable"
          style={{
            fontSize: 12.5,
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            padding: "0 4px 16px",
          }}
        >
          {room.topic}
        </div>
      )}

      <EncryptionCard room={room} unverified={unverified} total={joined.length} />

      <RaveLabel style={{ padding: "20px 4px 8px" }}>
        members · {members ? joined.length : "…"}
      </RaveLabel>

      {!members && (
        <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
          <Spinner />
        </div>
      )}

      {joined.map((member) => (
        <MemberRow key={member.userId} member={member} />
      ))}

      <RaveLabel style={{ padding: "18px 4px 8px" }}>room</RaveLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ToggleRow
          icon="bell-slash"
          label="mute notifications"
          on={room.isMuted}
          onToggle={(next) => void ipc.setRoomMuted(room.id, next).catch(() => {})}
        />
        <ToggleRow
          icon="star"
          label="favourite"
          on={room.isFavourite}
          onToggle={(next) => void ipc.setRoomFavourite(room.id, next).catch(() => {})}
        />
        <ToggleRow
          icon="arrow-down"
          label="low priority"
          on={room.isLowPriority}
          onToggle={(next) => void ipc.setRoomLowPriority(room.id, next).catch(() => {})}
        />
      </div>
    </div>
  );
}

function EncryptionCard({
  room,
  unverified,
  total,
}: {
  room: RoomSummary;
  unverified: number;
  total: number;
}) {
  if (!room.isEncrypted) {
    return (
      <div
        style={{
          background: "var(--surface-card)",
          border: "1px solid rgba(255,194,77,.3)",
          borderRadius: 20,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="lock-key-open" size={16} color="var(--status-warning)" />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14 }}>
            not encrypted
          </span>
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-secondary)",
            marginTop: 5,
            lineHeight: 1.5,
          }}
        >
          messages here are readable by the homeserver.
        </div>
      </div>
    );
  }

  const allVerified = total > 0 && unverified === 0;

  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 20,
        padding: 14,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon
          name={allVerified ? "shield-check" : "shield-warning"}
          size={16}
          color={allVerified ? "var(--accent-primary)" : "var(--status-warning)"}
        />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14 }}>
          {allVerified ? "everyone verified~" : "some devices unverified"}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--text-secondary)",
          marginTop: 5,
          lineHeight: 1.5,
        }}
      >
        {allVerified
          ? `all ${total} members' devices are cross-signed. nothing to worry about.`
          : `${unverified} of ${total} members haven't been verified yet.`}
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 10,
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--text-tertiary)",
        }}
      >
        <span>megolm · v1</span>
        <span>·</span>
        <span>end-to-end</span>
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: RoomMember }) {
  const name = displayNameFor(member.userId, member.displayName);
  const showBanner = useStore((s) => s.showBanner);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 6px",
        borderRadius: 14,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ position: "relative", flex: "none" }}>
        <Avatar
          id={member.userId}
          name={name}
          mxc={member.avatarUrl}
          size={34}
          radius={12}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="uwu-ellipsis"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13.5,
            color: accentFor(member.userId),
          }}
        >
          {name}
        </div>
        <div
          className="uwu-ellipsis selectable"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-tertiary)",
          }}
        >
          {member.userId}
        </div>
      </div>

      {member.verification === "verified" ? (
        <Icon name="seal-check" size={14} color="var(--accent-primary)" />
      ) : (
        <button
          title="verify this person"
          onClick={() =>
            void ipc
              .requestVerification(member.userId)
              .catch((e) => showBanner("error", ipc.asUwuError(e).message))
          }
          style={{ cursor: "pointer", display: "flex" }}
        >
          <Icon name="seal-question" size={14} color="var(--text-tertiary)" />
        </button>
      )}
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  on,
  onToggle,
}: {
  icon: string;
  label: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onToggle(!on)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 16,
        padding: "11px 13px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <Icon
        name={icon}
        size={16}
        color={on ? "var(--accent-primary)" : "var(--text-tertiary)"}
      />
      <span
        style={{
          flex: 1,
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 13,
          color: on ? "var(--text-primary)" : "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          width: 30,
          height: 17,
          borderRadius: 999,
          background: on ? "var(--accent-primary)" : "var(--surface-inset)",
          border: "1px solid var(--border-subtle)",
          position: "relative",
          transition: "background var(--dur-fast) var(--ease-out)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 1,
            left: on ? 14 : 1,
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: on ? "var(--ink-950)" : "var(--text-tertiary)",
            transition: "left var(--dur-fast) var(--ease-bounce)",
          }}
        />
      </div>
    </button>
  );
}
