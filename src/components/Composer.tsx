import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import * as ipc from "../lib/ipc";
import { uploadFiles, uploadPaths } from "../lib/upload";
import { selectDraft, useStore } from "../store";
import { Icon } from "./ui";

/** How long we let a typing notice stand before refreshing it. */
const TYPING_REFRESH_MS = 4000;

export function Composer({
  roomId,
  roomName,
  threadRoot,
  encrypted,
}: {
  roomId: string;
  roomName: string;
  threadRoot?: string;
  encrypted: boolean;
}) {
  const key = threadRoot ? `${roomId}|${threadRoot}` : roomId;

  const { draft, setDraft, clearDraft, showBanner, settings } = useStore(
    useShallow((s) => ({
      draft: selectDraft(s, key),
      setDraft: s.setDraft,
      clearDraft: s.clearDraft,
      showBanner: s.showBanner,
      settings: s.settings,
    })),
  );

  const input = useRef<HTMLTextAreaElement>(null);
  const typingSentAt = useRef(0);

  // Focus the composer when the room changes — you almost always want to type.
  useEffect(() => {
    input.current?.focus();
  }, [key]);

  // Stop advertising "typing" when leaving the room, otherwise the indicator
  // sticks for everyone else until the server times it out.
  useEffect(() => {
    return () => {
      if (typingSentAt.current) {
        void ipc.setTyping(roomId, false).catch(() => {});
        typingSentAt.current = 0;
      }
    };
  }, [roomId]);

  function noteTyping() {
    const now = Date.now();
    if (now - typingSentAt.current < TYPING_REFRESH_MS) return;
    typingSentAt.current = now;
    void ipc.setTyping(roomId, true).catch(() => {});
  }

  async function submit() {
    const body = draft.body.trim();
    if (!body) return;

    // Clear straight away: the local echo from the backend is what the user
    // should see next, not their own text sitting in the box.
    clearDraft(key);
    if (typingSentAt.current) {
      void ipc.setTyping(roomId, false).catch(() => {});
      typingSentAt.current = 0;
    }

    try {
      if (draft.editing) {
        await ipc.editMessage(roomId, draft.editing, body, true, threadRoot);
      } else {
        await ipc.sendMessage(roomId, {
          body,
          // Always on: ruma only adds a formatted body when the text actually
          // contains markup, so plain messages stay plain.
          markdown: true,
          replyTo: draft.replyTo,
          threadRoot: threadRoot ?? null,
        });
      }
    } catch (e) {
      // Put the text back so nothing is lost.
      setDraft(key, { body, replyTo: draft.replyTo, editing: draft.editing });
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  async function attach() {
    try {
      const selected = await open({ multiple: true });
      const paths = typeof selected === "string" ? [selected] : (selected ?? []);
      await uploadPaths(paths, roomId, threadRoot);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  // Paste a screenshot, an image, any file — it goes to this room.
  //
  // The listener is on the window rather than the textarea: pasting is a thing
  // you do *at the room*, and having it depend on whether the composer happens
  // to be focused would be a small mystery every time it didn't work. A paste
  // carrying no files isn't ours, so ordinary text paste is untouched.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;

      e.preventDefault();
      void uploadFiles(files, roomId, threadRoot);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [roomId, threadRoot]);

  return (
    <div style={{ padding: "12px 22px 18px" }}>
      {(draft.replyTo || draft.editing) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 14px",
            marginBottom: 8,
            borderRadius: 14,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderLeft: `2px solid ${draft.editing ? "var(--accent-primary)" : "var(--accent-tertiary)"}`,
          }}
        >
          <Icon
            name={draft.editing ? "pencil-simple" : "arrow-bend-up-left"}
            size={13}
            color={draft.editing ? "var(--accent-primary)" : "var(--accent-tertiary)"}
          />
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            {draft.editing ? "editing your message" : "replying"}
          </span>
          <button
            onClick={() => setDraft(key, { replyTo: null, editing: null, body: "" })}
            style={{ marginLeft: "auto", cursor: "pointer", display: "flex" }}
          >
            <Icon name="x" size={13} color="var(--text-tertiary)" />
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          background: "var(--surface-card-raised)",
          border: "1px solid var(--border-default)",
          borderRadius: 24,
          padding: "9px 12px",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Same 38px box as the send button, so both line up on the composer's
            baseline however tall the textarea has grown. */}
        <button
          onClick={() => void attach()}
          title="attach a file"
          style={{
            width: 38,
            height: 38,
            flex: "none",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon name="plus-circle" size={22} color="var(--text-tertiary)" />
        </button>

        <textarea
          ref={input}
          className="selectable"
          value={draft.body}
          rows={1}
          onChange={(e) => {
            setDraft(key, { body: e.target.value });
            noteTyping();
            // Grow with the content, up to a point.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // Either Enter sends and Shift+Enter breaks the line, or the other
            // way round — whichever the user picked in settings.
            const sends = settings.sendOnEnter
              ? e.key === "Enter" && !e.shiftKey && !e.metaKey
              : e.key === "Enter" && (e.metaKey || e.ctrlKey);

            if (sends) {
              e.preventDefault();
              void submit();
              if (input.current) input.current.style.height = "auto";
            }
            if (e.key === "Escape" && (draft.replyTo || draft.editing)) {
              setDraft(key, { replyTo: null, editing: null, body: "" });
            }
          }}
          placeholder={`say something cute in ${roomName}~`}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            color: "var(--text-primary)",
            fontSize: 14.5,
            lineHeight: 1.5,
            padding: "9px 6px",
            maxHeight: 160,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => void submit()}
            disabled={!draft.body.trim()}
            title="send"
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              background: "var(--accent-primary)",
              color: "var(--text-on-accent)",
              border: "2px solid var(--ink-950)",
              boxShadow: "var(--shadow-sticker-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: draft.body.trim() ? "pointer" : "not-allowed",
              opacity: draft.body.trim() ? 1 : 0.45,
              transition: "transform var(--dur-fast) var(--ease-bounce)",
            }}
            onMouseEnter={(e) => {
              if (draft.body.trim()) {
                e.currentTarget.style.transform = "rotate(-6deg) scale(1.05)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
            }}
          >
            <Icon name="paper-plane-right" size={17} color="var(--text-on-accent)" />
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
          padding: "0 6px",
        }}
      >
        <Icon
          name={encrypted ? "lock-key" : "lock-key-open"}
          size={11}
          color={encrypted ? "var(--accent-primary)" : "var(--status-warning)"}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--text-tertiary)",
          }}
        >
          {encrypted
            ? "encrypted end-to-end · only people in this room can read it"
            : "not encrypted · your homeserver can read this"}
        </span>
      </div>
    </div>
  );
}
