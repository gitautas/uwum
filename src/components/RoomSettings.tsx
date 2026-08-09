import { useEffect, useState } from "react";

import * as ipc from "../lib/ipc";
import type { RoomPermissions, RoomSummary } from "../lib/types";
import { useStore } from "../store";
import { Button, Icon, RaveLabel, Toggle } from "./ui";

/**
 * Renaming a room, and getting out of one.
 *
 * The editing half only appears when this account can actually change the
 * thing — a disabled field you can't act on is just clutter in a narrow panel.
 * Permissions are read once per room rather than carried on every summary.
 */
export function RoomSettings({ room }: { room: RoomSummary }) {
  const [permissions, setPermissions] = useState<RoomPermissions | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPermissions(null);
    ipc
      .getRoomPermissions(room.id)
      .then((p) => !cancelled && setPermissions(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  const canEdit = permissions?.canRename || permissions?.canSetTopic;

  return (
    <>
      {canEdit && <RoomEditor room={room} permissions={permissions!} />}
      <LeaveRoom room={room} />
    </>
  );
}

function RoomEditor({
  room,
  permissions,
}: {
  room: RoomSummary;
  permissions: RoomPermissions;
}) {
  const showBanner = useStore((s) => s.showBanner);
  const [name, setName] = useState(room.name);
  const [topic, setTopic] = useState(room.topic ?? "");
  const [saving, setSaving] = useState(false);

  // The room can be renamed by someone else while this panel is open; follow
  // the server rather than leaving a stale draft sitting in the box.
  useEffect(() => {
    setName(room.name);
    setTopic(room.topic ?? "");
  }, [room.id, room.name, room.topic]);

  const dirty =
    (permissions.canRename && name.trim() !== room.name) ||
    (permissions.canSetTopic && topic.trim() !== (room.topic ?? ""));

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await ipc.updateRoom(room.id, {
        name: permissions.canRename && name.trim() !== room.name ? name.trim() : undefined,
        topic:
          permissions.canSetTopic && topic.trim() !== (room.topic ?? "")
            ? topic.trim()
            : undefined,
      });
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <RaveLabel style={{ padding: "18px 4px 8px" }}>edit</RaveLabel>

      {permissions.canRename && (
        <input
          className="selectable"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="room name"
          style={inputStyle}
        />
      )}

      {permissions.canSetTopic && (
        <textarea
          className="selectable"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="what's it for?"
          rows={2}
          style={{ ...inputStyle, marginTop: 8, resize: "none", lineHeight: 1.5 }}
        />
      )}

      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "saving…" : "save"}
          </Button>
        </div>
      )}
    </>
  );
}

function LeaveRoom({ room }: { room: RoomSummary }) {
  const showBanner = useStore((s) => s.showBanner);
  const selectRoom = useStore((s) => s.selectRoom);
  const [confirming, setConfirming] = useState(false);
  const [forget, setForget] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Reset when switching rooms, so a half-opened confirmation doesn't follow
  // you to the next one.
  useEffect(() => {
    setConfirming(false);
    setForget(false);
  }, [room.id]);

  const alone = room.memberCount <= 1;

  async function leave() {
    setLeaving(true);
    try {
      await ipc.leaveRoom(room.id, forget);
      void selectRoom(null);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
      setLeaving(false);
    }
  }

  if (!confirming) {
    return (
      <>
        <RaveLabel style={{ padding: "18px 4px 8px" }}>leaving</RaveLabel>
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          leave {room.isDirect ? "this chat" : "this room"}
        </Button>
      </>
    );
  }

  return (
    <>
      <RaveLabel style={{ padding: "18px 4px 8px" }}>leaving</RaveLabel>
      <div
        style={{
          background: "var(--surface-card)",
          border: "1px solid rgba(255,84,112,.35)",
          borderRadius: 20,
          padding: 14,
        }}
      >
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {alone
            ? "you're the only one here, so nobody will be left in it."
            : "everyone else keeps the room; you just won't be in it."}
          {room.isEncrypted && " this room is encrypted — rejoining won't get the old messages back."}
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13 }}>
              forget it too
            </div>
            <div
              style={{ fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.45 }}
            >
              drops it from your account entirely. matrix has no delete — for a
              room only you were in, this is the closest thing.
            </div>
          </div>
          <Toggle on={forget} onToggle={setForget} label="forget it too" />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Button
            variant="danger"
            size="sm"
            disabled={leaving}
            onClick={() => void leave()}
            style={{ flex: 1 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="sign-out" size={13} color="var(--ink-950)" />
              {leaving ? "leaving…" : forget ? "leave and forget" : "leave"}
            </span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            keep it
          </Button>
        </div>
      </div>
    </>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 14,
  background: "var(--surface-inset)",
  border: "1px solid var(--border-subtle)",
  outline: "none",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "var(--font-body)",
} as const;
