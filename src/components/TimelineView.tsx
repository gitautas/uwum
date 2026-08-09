import { useEffect, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { formatDayDivider, joinNames, localpart } from "../lib/display";
import type { TimelineItem, TypingUser } from "../lib/types";
import { useStore } from "../store";
import { MessageRow } from "./MessageRow";
import { Spinner } from "./ui";

/**
 * Shared empties for rooms we haven't loaded yet.
 *
 * These must be stable references: zustand compares snapshots by identity, so a
 * fresh `[]` inside the selector would look like a change on every read and
 * re-render forever.
 */
const NO_ITEMS: TimelineItem[] = [];
const NO_TYPING: TypingUser[] = [];

/** Consecutive messages from one person within this window share a header. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** How close to the top counts as "load more". */
const PAGINATE_THRESHOLD_PX = 240;

/** Ceiling on the initial "fill the viewport" pagination, so it can't spin. */
const MAX_FILL_PAGES = 8;

export function TimelineView({
  roomId,
  threadRoot,
}: {
  roomId: string;
  threadRoot?: string;
}) {
  const key = threadRoot ? `${roomId}|${threadRoot}` : roomId;

  const {
    items,
    ready,
    typing,
    paginating,
    exhausted,
    loadOlder,
    setDraft,
    openThread,
  } = useStore(
    useShallow((s) => ({
      items: s.timelines[key] ?? NO_ITEMS,
      // The room is selected before `open_timeline` resolves; until the entry
      // exists there is no timeline on the Rust side to paginate.
      ready: s.timelines[key] !== undefined,
      typing: s.typing[roomId] ?? NO_TYPING,
      paginating: s.paginating[key] ?? false,
      exhausted: s.exhausted[key] ?? false,
      loadOlder: s.loadOlder,
      setDraft: s.setDraft,
      openThread: s.openThread,
    })),
  );

  const scroller = useRef<HTMLDivElement>(null);
  /** True while the user is parked at the bottom, so new messages should follow. */
  const stuckToBottom = useRef(true);
  /** Scroll height before a pagination, so we can restore the reading position. */
  const heightBeforePagination = useRef<number | null>(null);
  const lastKey = useRef(key);

  // Jump to the newest message when switching rooms.
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      stuckToBottom.current = true;
    }
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [key]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;

    // After loading older messages the content grows upward; keep the message
    // the user was reading exactly where it was.
    if (heightBeforePagination.current !== null) {
      el.scrollTop = el.scrollHeight - heightBeforePagination.current;
      heightBeforePagination.current = null;
      return;
    }

    if (stuckToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  // Keep loading until the timeline actually overflows.
  //
  // Scroll-triggered pagination can't bootstrap itself: a room that opens with
  // one message isn't scrollable, so the user has no way to ask for more. This
  // fills the viewport first, after which scrolling takes over. `exhausted`
  // ends it at the start of the room, and the attempt cap stops a room whose
  // history is all filtered-out events from looping forever.
  const fillAttempts = useRef(0);

  useEffect(() => {
    fillAttempts.current = 0;
  }, [key]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !ready || paginating || exhausted) return;
    if (fillAttempts.current >= MAX_FILL_PAGES) return;

    const overflows = el.scrollHeight > el.clientHeight + 40;
    if (overflows) return;

    fillAttempts.current += 1;
    void loadOlder();
  }, [items, ready, paginating, exhausted, loadOlder, key]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stuckToBottom.current = distanceFromBottom < 80;

    if (
      el.scrollTop < PAGINATE_THRESHOLD_PX &&
      ready &&
      !paginating &&
      !exhausted
    ) {
      heightBeforePagination.current = el.scrollHeight;
      void loadOlder();
    }
  }

  const rows = withGrouping(items);

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="uwu-scroll"
      style={{
        flex: 1,
        padding: "18px 22px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      {paginating && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0",
          }}
        >
          <Spinner />
        </div>
      )}

      {exhausted && (
        <div
          style={{
            alignSelf: "center",
            padding: "14px 0 18px",
            fontSize: 12.5,
            color: "var(--text-tertiary)",
          }}
        >
          this is the very beginning~
        </div>
      )}

      {rows.map(({ item, showHeader }) => {
        if (item.kind === "dateDivider") {
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: "18px 0 10px",
              }}
            >
              <span
                style={{ flex: 1, height: 1, background: "var(--border-subtle)" }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-tertiary)",
                  whiteSpace: "nowrap",
                }}
              >
                {formatDayDivider(item.timestamp ?? 0)}
              </span>
              <span
                style={{ flex: 1, height: 1, background: "var(--border-subtle)" }}
              />
            </div>
          );
        }

        if (item.kind === "readMarker") {
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: "8px 0",
              }}
            >
              <span
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--accent-secondary)",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-rave)",
                  fontSize: 8.5,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--accent-secondary)",
                }}
              >
                new
              </span>
            </div>
          );
        }

        if (item.kind !== "event" || !item.event) return null;

        return (
          <MessageRow
            key={item.id}
            item={item.event}
            roomId={roomId}
            threadRoot={threadRoot}
            showHeader={showHeader}
            onReply={(eventId) =>
              setDraft(key, { replyTo: eventId, editing: null })
            }
            onOpenThread={(root) => void openThread(root)}
          />
        );
      })}

      <ReadReceipts items={items} />

      {typing.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "2px 8px 10px 60px",
            color: "var(--text-secondary)",
            fontSize: 12.5,
          }}
        >
          <span style={{ display: "inline-flex", gap: 3 }}>
            {[0, 0.2, 0.4].map((delay) => (
              <span
                key={delay}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--accent-secondary)",
                  animation: `uwuPulse 1s ${delay}s infinite`,
                }}
              />
            ))}
          </span>
          <span>
            {joinNames(typing.map((u) => u.displayName ?? localpart(u.userId)))}{" "}
            {typing.length === 1 ? "is" : "are"} typing~
          </span>
        </div>
      )}
    </div>
  );
}

/** The little facepile under the last message. */
function ReadReceipts({ items }: { items: TimelineItem[] }) {
  const lastEvent = [...items].reverse().find((i) => i.kind === "event")?.event;
  const receipts = lastEvent?.readReceipts ?? [];
  if (receipts.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px 10px 60px",
      }}
    >
      {receipts.slice(0, 5).map((userId) => (
        <div
          key={userId}
          title={localpart(userId)}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "1.5px solid var(--ink-950)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 8,
            fontWeight: 800,
            fontFamily: "var(--font-display)",
            color: "var(--text-on-accent)",
            marginLeft: -6,
            background: `var(--accent-${["primary", "secondary", "tertiary", "quaternary"][userId.length % 4]})`,
          }}
        >
          {localpart(userId).slice(0, 2)}
        </div>
      ))}
      <span
        style={{
          marginLeft: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--text-tertiary)",
        }}
      >
        seen by {receipts.length}
      </span>
    </div>
  );
}

/**
 * Decide which messages get a full header (avatar + name + time) and which
 * continue the run above them.
 */
function withGrouping(
  items: TimelineItem[],
): { item: TimelineItem; showHeader: boolean }[] {
  let previousSender: string | null = null;
  let previousTimestamp = 0;

  return items.map((item) => {
    if (item.kind !== "event" || !item.event) {
      previousSender = null;
      return { item, showHeader: false };
    }

    const event = item.event;

    // System lines break a run — a "joined" note between two messages means the
    // second one deserves its own header again.
    const isSystem =
      event.content.kind === "membership" ||
      event.content.kind === "profileChange" ||
      event.content.kind === "state";

    if (isSystem) {
      previousSender = null;
      return { item, showHeader: false };
    }

    const showHeader =
      event.sender !== previousSender ||
      event.timestamp - previousTimestamp > GROUPING_WINDOW_MS ||
      event.reply != null;

    previousSender = event.sender;
    previousTimestamp = event.timestamp;

    return { item, showHeader };
  });
}
