/**
 * The emoji picker — search, categories, skin tone, and a preview line.
 *
 * Rendered into a fixed-position layer and placed against an anchor rectangle,
 * so it can be opened from a message hover bar near the bottom of the timeline
 * without being clipped by whatever scrolls above it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  EMOJI_GROUPS,
  emojiName,
  searchEmoji,
  TONE_SAMPLES,
  withSkinTone,
  type Emoji,
  type SkinTone,
} from "../lib/emoji";
import { useStore } from "../store";
import { Icon } from "./ui";

const WIDTH = 340;
const HEIGHT = 392;
/** Kept clear of the window edges so the picker never sits flush against them. */
const MARGIN = 10;

export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  /** Screen rect the picker should sit next to — usually the button that opened it. */
  anchor: DOMRect;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const skinTone = useStore((s) => s.settings.skinTone);
  const recent = useStore((s) => s.settings.recentReactions);
  const updateSettings = useStore((s) => s.updateSettings);

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search.current?.focus();
  }, []);

  // Escape closes, and so does a click anywhere else. Pointerdown rather than
  // click so a press that starts outside can't also land on something inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const results = useMemo(() => searchEmoji(query), [query]);
  const searching = query.trim().length > 0;

  const position = usePlacement(anchor);

  function pick(emoji: Emoji | string) {
    const raw = typeof emoji === "string" ? emoji : emoji.emoji;
    const toneable = typeof emoji === "string" ? false : emoji.skinToneSupport;
    onPick(toneable ? withSkinTone(raw, skinTone) : raw);
  }

  function jumpTo(index: number) {
    const target = scroller.current?.querySelector(`[data-group="${index}"]`);
    target?.scrollIntoView({ block: "start" });
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="pick an emoji"
      style={{
        position: "fixed",
        ...position,
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        borderRadius: 20,
        background: "var(--surface-card-raised)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-pop)",
        overflow: "hidden",
        zIndex: 60,
      }}
    >
      <div style={{ padding: "10px 12px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 11px",
            borderRadius: 999,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Icon name="magnifying-glass" size={13} color="var(--text-tertiary)" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search emoji~"
            aria-label="search emoji"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: 13,
            }}
          />
        </div>
      </div>

      {!searching && (
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "0 10px 6px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {EMOJI_GROUPS.map((group, i) => (
            <button
              key={group.name}
              onClick={() => jumpTo(i)}
              title={group.name}
              aria-label={group.name}
              style={{
                flex: 1,
                height: 26,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,.07)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <Icon name={group.icon} size={14} color="var(--text-tertiary)" />
            </button>
          ))}
        </div>
      )}

      <div ref={scroller} className="uwu-scroll" style={{ flex: 1, padding: "4px 8px 8px" }}>
        {searching ? (
          results.length > 0 ? (
            <Section title={`${results.length} match${results.length === 1 ? "" : "es"}`}>
              <Grid emojis={results} tone={skinTone} onPick={pick} onHover={setHovered} />
            </Section>
          ) : (
            <div
              style={{
                padding: "28px 12px",
                textAlign: "center",
                fontSize: 12.5,
                color: "var(--text-tertiary)",
              }}
            >
              nothing matches "{query.trim()}"
            </div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <Section title="recent">
                {/* Recents are stored with their tone already applied — they're
                    what was actually sent, not a base to re-tone. */}
                <div style={GRID}>
                  {recent.map((key) => (
                    <Cell
                      key={key}
                      label={key}
                      onClick={() => pick(key)}
                      onHover={() => setHovered(key)}
                    >
                      {key}
                    </Cell>
                  ))}
                </div>
              </Section>
            )}

            {EMOJI_GROUPS.map((group, i) => (
              <Section key={group.name} title={group.name} index={i}>
                <Grid
                  emojis={group.emojis}
                  tone={skinTone}
                  onPick={pick}
                  onHover={setHovered}
                />
              </Section>
            ))}
          </>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
        }}
      >
        <span style={{ fontSize: 17, lineHeight: 1 }}>{hovered ?? "🫧"}</span>
        <span
          className="uwu-ellipsis"
          style={{ flex: 1, fontSize: 11.5, color: "var(--text-secondary)" }}
        >
          {hovered ? (emojiName(hovered) ?? hovered) : "pick something~"}
        </span>

        <div style={{ display: "flex", gap: 1 }}>
          {TONE_SAMPLES.map((sample, tone) => (
            <button
              key={tone}
              onClick={() => updateSettings({ skinTone: tone as SkinTone })}
              title={tone === 0 ? "default skin tone" : `skin tone ${tone}`}
              // The swatch is a hand, so without a label the button announces
              // itself as "waving hand" rather than as the tone it sets.
              aria-label={tone === 0 ? "default skin tone" : `skin tone ${tone}`}
              aria-pressed={skinTone === tone}
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1,
                cursor: "pointer",
                background:
                  skinTone === tone ? "color-mix(in srgb, var(--accent-primary) 22%, transparent)" : "transparent",
              }}
            >
              {sample}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(8, 1fr)",
  gap: 1,
};

function Section({
  title,
  index,
  children,
}: {
  title: string;
  /** Marks the scroll target for the category rail. */
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <div data-group={index}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          padding: "6px 4px 4px",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          background: "var(--surface-card-raised)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Grid({
  emojis,
  tone,
  onPick,
  onHover,
}: {
  emojis: Emoji[];
  tone: SkinTone;
  onPick: (emoji: Emoji) => void;
  onHover: (emoji: string) => void;
}) {
  return (
    <div style={GRID}>
      {emojis.map((emoji) => {
        const shown = emoji.skinToneSupport ? withSkinTone(emoji.emoji, tone) : emoji.emoji;
        return (
          <Cell
            key={emoji.emoji}
            label={emoji.name}
            onClick={() => onPick(emoji)}
            // The preview names the base emoji, so hovering a toned hand still
            // says "waving hand" rather than falling back to the character.
            onHover={() => onHover(emoji.emoji)}
          >
            {shown}
          </Cell>
        );
      })}
    </div>
  );
}

function Cell({
  label,
  onClick,
  onHover,
  children,
}: {
  label: string;
  onClick: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => {
        onHover();
        e.currentTarget.style.background = "rgba(255,255,255,.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      title={label}
      aria-label={label}
      style={{
        height: 34,
        borderRadius: 8,
        fontSize: 20,
        lineHeight: 1,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Place the picker beside its anchor, flipping and sliding to stay on screen.
 *
 * Measured in a layout effect so the first paint is already in the right place
 * — a popover that visibly jumps after opening reads as a bug.
 */
function usePlacement(anchor: DOMRect) {
  const [placement, setPlacement] = useState<{ left: number; top: number }>(() =>
    place(anchor),
  );

  useLayoutEffect(() => {
    setPlacement(place(anchor));
  }, [anchor]);

  return placement;
}

function place(anchor: DOMRect): { left: number; top: number } {
  // Prefer below-right of the anchor, which is where the hover bar's button is.
  const left = clamp(anchor.right - WIDTH, MARGIN, window.innerWidth - WIDTH - MARGIN);

  const below = anchor.bottom + 6;
  const top =
    below + HEIGHT + MARGIN <= window.innerHeight
      ? below
      : Math.max(MARGIN, anchor.top - HEIGHT - 6);

  return { left, top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
