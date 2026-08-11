import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Content, EventItem, TimelineItem } from "../lib/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

vi.mock("../lib/ipc", () => ({
  setTyping: () => Promise.resolve(),
  sendMessage: () => Promise.resolve(),
  editMessage: () => Promise.resolve(),
  mediaUrl: (mxc: string | null | undefined) => mxc ?? null,
  asUwuError: (e: unknown) => ({ kind: "other", message: String(e) }),
}));

const { Composer } = await import("./Composer");
const { useStore } = await import("../store");

const ROOM = "!room:veil.gg";

function message(patch: Partial<EventItem> & { eventId: string }): TimelineItem {
  const content: Content = patch.content ?? { kind: "text", body: "hi~", formatted: null };
  return {
    id: patch.eventId,
    kind: "event",
    event: {
      transactionId: null,
      sender: "@gintas:veil.gg",
      senderName: "gintas",
      senderAvatar: null,
      timestamp: 0,
      isOwn: true,
      isEditable: true,
      canReply: true,
      isHighlighted: false,
      isEdited: false,
      isEmojiOnly: false,
      sendState: null,
      shield: null,
      reactions: [],
      reply: null,
      threadRoot: null,
      threadSummary: null,
      readReceipts: [],
      ...patch,
      content,
    },
  };
}

function composer(timeline: TimelineItem[]) {
  useStore.setState({ timelines: { [ROOM]: timeline }, drafts: {} });
  render(<Composer roomId={ROOM} roomName="the pit" encrypted={false} />);
  return screen.getByPlaceholderText("say something cute in the pit~");
}

const draft = () => useStore.getState().drafts[ROOM];

describe("composer: up to edit", () => {
  beforeEach(() => {
    useStore.setState({ timelines: {}, drafts: {} });
  });

  afterEach(cleanup);

  it("picks up the last message you can edit", () => {
    const field = composer([
      message({ eventId: "$old", content: { kind: "text", body: "older", formatted: null } }),
      message({ eventId: "$mine", content: { kind: "text", body: "latest", formatted: null } }),
    ]);

    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(draft()).toMatchObject({ editing: "$mine", body: "latest", replyTo: null });
  });

  it("skips messages that aren't yours to edit", () => {
    const field = composer([
      message({ eventId: "$mine", content: { kind: "text", body: "mine", formatted: null } }),
      message({
        eventId: "$theirs",
        isOwn: false,
        isEditable: false,
        content: { kind: "text", body: "theirs", formatted: null },
      }),
    ]);

    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(draft()).toMatchObject({ editing: "$mine", body: "mine" });
  });

  it("leaves the key alone once there's text in the box", () => {
    const field = composer([message({ eventId: "$mine" })]);

    fireEvent.change(field, { target: { value: "half a thought" } });
    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(draft().editing).toBeNull();
    expect(draft().body).toBe("half a thought");
  });

  it("does nothing in a room you've never spoken in", () => {
    const field = composer([
      message({ eventId: "$theirs", isOwn: false, isEditable: false }),
    ]);

    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(draft()?.editing ?? null).toBeNull();
  });

  it("ignores modified up, which is a selection rather than a recall", () => {
    const field = composer([message({ eventId: "$mine" })]);

    fireEvent.keyDown(field, { key: "ArrowUp", shiftKey: true });

    expect(draft()?.editing ?? null).toBeNull();
  });
});

describe("composer: down to reply", () => {
  beforeEach(() => {
    useStore.setState({ timelines: {}, drafts: {} });
  });

  afterEach(cleanup);

  it("replies to the last message somebody else sent", () => {
    const field = composer([
      message({ eventId: "$theirs", isOwn: false, isEditable: false }),
      message({ eventId: "$mine" }),
    ]);

    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(draft()).toMatchObject({ replyTo: "$theirs", editing: null });
  });

  it("leaves the box empty — a reply is a pointer, not a quote", () => {
    const field = composer([message({ eventId: "$theirs", isOwn: false, isEditable: false })]);

    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(draft().body).toBe("");
  });

  it("skips messages that can't be replied to", () => {
    const field = composer([
      message({ eventId: "$older", isOwn: false, isEditable: false }),
      message({ eventId: "$state", isOwn: false, isEditable: false, canReply: false }),
    ]);

    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(draft().replyTo).toBe("$older");
  });

  it("does nothing when nobody else has spoken", () => {
    const field = composer([message({ eventId: "$mine" })]);

    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(draft()?.replyTo ?? null).toBeNull();
  });

  it("leaves the key alone once there's text in the box", () => {
    const field = composer([message({ eventId: "$theirs", isOwn: false, isEditable: false })]);

    fireEvent.change(field, { target: { value: "half a thought" } });
    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(draft().replyTo).toBeNull();
  });
});
