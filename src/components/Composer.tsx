import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import * as ipc from "../lib/ipc";
import { emoteLookup, emoteRefs, matchEmotes, typingShortcode } from "../lib/packs";
import type { PackImage } from "../lib/types";
import { uploadFiles, uploadPaths } from "../lib/upload";
import { selectDraft, useStore } from "../store";
import { EmojiPicker } from "./EmojiPicker";
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

  const { draft, setDraft, clearDraft, showBanner, settings, packs } = useStore(
    useShallow((s) => ({
      draft: selectDraft(s, key),
      setDraft: s.setDraft,
      clearDraft: s.clearDraft,
      showBanner: s.showBanner,
      settings: s.settings,
      packs: s.packs,
    })),
  );

  const input = useRef<HTMLTextAreaElement>(null);
  const typingSentAt = useRef(0);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);

  const emotes = useMemo(() => emoteLookup(packs), [packs]);
  /** The `:shortcode` being typed at the caret, and what it matches. */
  const [completing, setCompleting] = useState<{
    start: number;
    matches: PackImage[];
    active: number;
  } | null>(null);

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
          // Only when there's something that could be a shortcode — otherwise
          // every message would carry the whole emote set across the bridge.
          emotes: /:[^\s:]+:/.test(body) ? emoteRefs(packs) : [],
        });
      }
    } catch (e) {
      // Put the text back so nothing is lost.
      setDraft(key, { body, replyTo: draft.replyTo, editing: draft.editing });
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  /** Replace whatever is being typed at the caret with `text`. */
  function insertAtCaret(text: string, replaceFrom?: number) {
    const field = input.current;
    const caret = field?.selectionStart ?? draft.body.length;
    const from = replaceFrom ?? caret;

    const body = `${draft.body.slice(0, from)}${text}${draft.body.slice(caret)}`;
    setDraft(key, { body });
    setCompleting(null);

    // The caret belongs after what was just inserted, which React won't do on
    // its own once the value is controlled.
    requestAnimationFrame(() => {
      const at = from + text.length;
      field?.focus();
      field?.setSelectionRange(at, at);
    });
  }

  /** Work out whether a shortcode is being typed, and what it matches. */
  function updateCompletion(body: string, caret: number) {
    const typing = typingShortcode(body, caret);
    if (!typing) {
      setCompleting(null);
      return;
    }

    const matches = matchEmotes(emotes, typing.query);
    setCompleting(matches.length > 0 ? { start: typing.start, matches, active: 0 } : null);
  }

  async function sendSticker(image: PackImage) {
    setPickerAnchor(null);
    try {
      await ipc.sendSticker(
        roomId,
        {
          body: image.body,
          url: image.url,
          width: image.width,
          height: image.height,
          size: image.size,
          mimetype: image.mimetype,
        },
        threadRoot,
      );
    } catch (e) {
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
    <div style={{ position: "relative", padding: "12px 22px 18px" }}>
      {completing && (
        <ShortcodeMenu
          matches={completing.matches}
          active={completing.active}
          onPick={(image) => insertAtCaret(`:${image.shortcode}: `, completing.start)}
        />
      )}

      {pickerAnchor && (
        <EmojiPicker
          anchor={pickerAnchor}
          packs={packs}
          stickers
          onPick={(picked) => {
            if (picked.kind === "sticker") {
              void sendSticker(picked.image);
              return;
            }
            setPickerAnchor(null);
            insertAtCaret(
              picked.kind === "unicode" ? picked.emoji : `:${picked.image.shortcode}: `,
            );
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}

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
            updateCompletion(e.target.value, e.target.selectionStart);
            noteTyping();
            // Grow with the content, up to a point.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // While the shortcode menu is up it owns the keys that move through
            // it — otherwise Enter would send `:blobc` as a message.
            if (completing) {
              const { matches, active } = completing;

              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const next =
                  (active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
                setCompleting({ ...completing, active: next });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insertAtCaret(`:${matches[active].shortcode}: `, completing.start);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setCompleting(null);
                return;
              }
            }

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
          onKeyUp={(e) => updateCompletion(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setCompleting(null)}
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

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            ref={emojiButton}
            onClick={() =>
              setPickerAnchor((open) =>
                open ? null : (emojiButton.current?.getBoundingClientRect() ?? null),
              )
            }
            title="emoji and stickers"
            aria-label="emoji and stickers"
            style={{
              width: 34,
              height: 38,
              flex: "none",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon name="smiley" size={20} color="var(--text-tertiary)" />
          </button>

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

/**
 * The `:shortcode` menu, sitting above the composer.
 *
 * Mouse-down rather than click to choose: the textarea blurs on mouse-down, and
 * blur dismisses the menu, so waiting for the click would mean the menu is gone
 * before the click lands.
 */
function ShortcodeMenu({
  matches,
  active,
  onPick,
}: {
  matches: PackImage[];
  active: number;
  onPick: (image: PackImage) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="custom emotes"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 22,
        marginBottom: 4,
        minWidth: 220,
        maxWidth: 320,
        padding: 5,
        borderRadius: 16,
        background: "var(--surface-card-raised)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-pop)",
        zIndex: 30,
      }}
    >
      {matches.map((image, i) => (
        <div
          key={`${image.shortcode}-${image.url}`}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(image);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "5px 9px",
            borderRadius: 11,
            cursor: "pointer",
            background: i === active ? "rgba(255,255,255,.08)" : "transparent",
          }}
        >
          <EmoteThumb image={image} />
          <span
            className="uwu-ellipsis"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: i === active ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            :{image.shortcode}:
          </span>
        </div>
      ))}
    </div>
  );
}

function EmoteThumb({ image }: { image: PackImage }) {
  const src = ipc.mediaUrl(image.url, { width: 44, height: 44 });
  if (!src) return <span style={{ width: 22 }} />;

  return (
    <img
      src={src}
      alt={image.shortcode}
      draggable={false}
      style={{ width: 22, height: 22, objectFit: "contain", flex: "none" }}
    />
  );
}
