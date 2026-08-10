import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { accentFor, formatStamp, localpart } from "../lib/display";
import type { RoomSummary } from "../lib/types";
import {
  filterRooms,
  groupRooms,
  selectUnreadTotal,
  useStore,
  type RoomFilter,
} from "../store";
import { Avatar, Button, ChannelBadge, HoverRow, Icon } from "./ui";

const FILTERS: RoomFilter[] = ["all", "unread", "dms", "muted"];

export function RoomList() {
  const {
    allRooms,
    activeRoomId,
    activeSpaceId,
    spaces,
    filter,
    search,
    setFilter,
    setSearch,
    selectRoom,
    openCreateRoom,
  } = useStore(
    useShallow((s) => ({
      allRooms: s.rooms,
      activeRoomId: s.activeRoomId,
      activeSpaceId: s.activeSpaceId,
      spaces: s.spaces,
      filter: s.filter,
      search: s.search,
      setFilter: s.setFilter,
      setSearch: s.setSearch,
      selectRoom: s.selectRoom,
      openCreateRoom: s.openCreateRoom,
    })),
  );

  const unreadTotal = useStore(selectUnreadTotal);

  // The chips are hidden until asked for — they're a rarely-used control and
  // they crowd the top of the list.
  const filtered = filter !== "all";
  const [filtersOpen, setFiltersOpen] = useState(filtered);

  // Both of these allocate, so they have to be memoised rather than derived
  // inside a store selector.
  const groups = useMemo(
    () =>
      groupRooms(
        filterRooms(allRooms, { activeSpaceId, filter, search, spaces }),
      ),
    [allRooms, activeSpaceId, filter, search, spaces],
  );

  const heading =
    spaces.find((s) => s.id === activeSpaceId)?.name.toLowerCase() ??
    "everything";

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        width: 298,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border-subtle)",
        background: "rgba(17,17,23,.72)",
      }}
    >
      <div className="uwu-drag" style={{ padding: "18px 18px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            className="uwu-ellipsis"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: "-0.02em",
            }}
          >
            {heading}~
          </div>
          <div
            className="uwu-no-drag"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-tertiary)",
                whiteSpace: "nowrap",
              }}
            >
              {unreadTotal > 0 ? `${unreadTotal} unread` : "all caught up"}
            </span>
            <button
              onClick={openCreateRoom}
              title="make or join a room"
              aria-label="make or join a room"
              style={{
                width: 26,
                height: 26,
                flex: "none",
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: "var(--surface-card)",
                border: "1px solid var(--border-default)",
                transition: "transform var(--dur-fast) var(--ease-bounce)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "rotate(90deg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "";
              }}
            >
              <Icon name="plus" size={13} color="var(--text-secondary)" />
            </button>
          </div>
        </div>

        <div
          className="uwu-no-drag"
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--surface-inset)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 999,
            padding: "9px 14px",
          }}
        >
          <Icon
            name="magnifying-glass"
            size={14}
            color="var(--text-tertiary)"
          />
          <input
            className="selectable"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="find a room or friend~"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{ cursor: "pointer", display: "flex" }}
            >
              <Icon name="x-circle" size={14} color="var(--text-tertiary)" />
            </button>
          )}
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            title={filtersOpen ? "hide filters" : "filter rooms"}
            style={{ cursor: "pointer", display: "flex", position: "relative" }}
          >
            <Icon
              name="funnel"
              size={15}
              color={
                filtered || filtersOpen
                  ? "var(--accent-primary)"
                  : "var(--text-tertiary)"
              }
            />
            {/* A dot, so an active filter is visible while the chips are hidden. */}
            {filtered && !filtersOpen && (
              <span
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent-primary)",
                }}
              />
            )}
          </button>
        </div>

        {filtersOpen && (
          <div
            className="uwu-no-drag"
            style={{ display: "flex", gap: 6, marginTop: 12 }}
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontFamily: "var(--font-rave)",
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: "6px 11px",
                  borderRadius: 12,
                  cursor: "pointer",
                  transition: "all var(--dur-fast) var(--ease-bounce)",
                  ...(filter === f
                    ? {
                        background: "var(--accent-primary)",
                        color: "var(--text-on-accent)",
                        border: "1px solid var(--ink-950)",
                      }
                    : {
                        background: "var(--surface-card-raised)",
                        color: "var(--text-tertiary)",
                        border: "1px solid var(--border-subtle)",
                      }),
                }}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="uwu-scroll" style={{ flex: 1, padding: "0 10px 16px" }}>
        {groups.length === 0 && (
          <div
            style={{
              padding: "40px 16px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {search ? (
              "nothing matches that~"
            ) : filter !== "all" ? (
              `no ${filter} rooms right now`
            ) : (
              <>
                <div>
                  {activeSpaceId
                    ? "nothing here yet — this space has no rooms you've joined"
                    : "no rooms yet~"}
                </div>
                {/* This used to say "join one to get started" and then offer no
                    way to do it. */}
                <div style={{ marginTop: 14 }}>
                  <Button size="sm" onClick={openCreateRoom}>
                    make or join a room
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.title}>
            <div
              style={{
                padding: "14px 8px 6px",
                fontFamily: "var(--font-rave)",
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{group.title}</span>
              <span
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--border-subtle)",
                }}
              />
              <span>{group.rooms.length}</span>
            </div>

            {group.rooms.map((room) => (
              <RoomRow
                key={room.id}
                room={room}
                active={room.id === activeRoomId}
                onSelect={() => void selectRoom(room.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomRow({
  room,
  active,
  onSelect,
}: {
  room: RoomSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const accent = accentFor(room.id);
  const preview = previewFor(room);

  return (
    <HoverRow
      onClick={onSelect}
      active={active}
      title={room.canonicalAlias ?? room.id}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "9px 10px",
        borderRadius: 16,
        marginBottom: 2,
        ...(active ? { boxShadow: `inset 3px 0 0 ${accent}` } : {}),
      }}
    >
      <div style={{ position: "relative", flex: "none" }}>
        <Avatar
          id={room.id}
          name={room.name}
          mxc={room.avatarUrl}
          size={36}
          radius={13}
        />
        {!room.isDirect && (
          <ChannelBadge kind={room.isVideoRoom ? "video" : "text"} />
        )}
        {room.hasActiveCall && (
          <div
            style={{
              position: "absolute",
              right: -3,
              bottom: -3,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "var(--status-online)",
              border: "2px solid var(--ink-900)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="call in progress"
          >
            <Icon name="phone-call" size={7} color="var(--ink-950)" />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            className="uwu-ellipsis"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 14.5,
              color: room.hasUnread
                ? "var(--text-primary)"
                : "var(--text-secondary)",
            }}
          >
            {room.name}
          </span>
          {/* Explains why this room is sitting at the top of its group. */}
          {room.isFavourite && (
            <Icon name="star" size={11} color="var(--accent-secondary)" />
          )}
          {room.isEncrypted && (
            <Icon name="shield-check" size={12} color="var(--accent-primary)" />
          )}
          {room.isMuted && (
            <Icon name="bell-slash" size={12} color="var(--text-tertiary)" />
          )}
        </div>
        <div
          className="uwu-ellipsis"
          style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 1 }}
        >
          {preview}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          flex: "none",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-tertiary)",
          }}
        >
          {formatStamp(room.latest?.timestamp ?? 0)}
        </span>
        {room.hasUnread && (
          <span
            style={{
              minWidth: 19,
              height: 19,
              padding: "0 6px",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-rave)",
              fontSize: 9.5,
              fontWeight: 800,
              color: "var(--text-on-accent)",
              background:
                room.highlightCount > 0
                  ? "var(--accent-secondary)"
                  : "var(--accent-primary)",
            }}
          >
            {room.notificationCount > 0
              ? room.notificationCount > 99
                ? "99+"
                : room.notificationCount
              : "·"}
          </span>
        )}
      </div>
    </HoverRow>
  );
}

function previewFor(room: RoomSummary): string {
  if (room.membership === "invited") return "invited you~";
  if (!room.latest) return room.topic ?? "no messages yet";

  const who = room.latest.senderName ?? localpart(room.latest.sender);
  // In a DM the other person's name is already the room name, so repeating it
  // in the preview just wastes the line.
  return room.isDirect ? room.latest.body : `${who}: ${room.latest.body}`;
}
