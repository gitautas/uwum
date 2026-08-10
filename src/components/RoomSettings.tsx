import { useEffect, useState } from "react";

import * as ipc from "../lib/ipc";
import type { RoomPermissions, RoomSummary } from "../lib/types";
import { useStore } from "../store";
import { Button, Modal } from "./ui";

/**
 * Renaming a room.
 *
 * A dialog rather than another section in the room panel: that panel is a
 * narrow column that already carries the member list.
 *
 * The fields only appear when this account can actually change the thing — a
 * disabled input you can't act on is just clutter. Permissions are read once
 * per room rather than carried on every room summary.
 *
 * There is deliberately no way to leave a room here; see PLAN.md.
 */
export function RoomSettingsDialog({
  room,
  onClose,
}: {
  room: RoomSummary;
  onClose: () => void;
}) {
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
    <Modal title={room.isDirect ? "this chat" : "room settings"} onClose={onClose}>
      {canEdit ? (
        <RoomEditor room={room} permissions={permissions!} />
      ) : (
        permissions && (
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            you can't rename this one — that needs more power than you have here.
          </div>
        )
      )}
    </Modal>
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
