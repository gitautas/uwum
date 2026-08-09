/** The small shared pieces the design repeats everywhere. */

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { accentFor, initialsFor } from "../lib/display";
import { mediaUrl } from "../lib/ipc";

export function Icon({
  name,
  size = 16,
  color = "var(--text-secondary)",
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      className={`ph-fill ph-${name}`}
      aria-hidden
      style={{ fontSize: size, color, lineHeight: 1, ...style }}
    />
  );
}

/**
 * The one size every avatar is fetched at, in CSS pixels before the retina
 * multiplier. Comfortably above the largest avatar the design draws (76px, in
 * the room header), so nothing is ever upscaled.
 */
const AVATAR_FETCH_SIZE = 88;

/**
 * The design's signature avatar: a chunky rounded tile with an ink border,
 * showing the real image when there is one and a neon monogram when there
 * isn't.
 */
export function Avatar({
  id,
  name,
  mxc,
  size = 38,
  radius,
  fontSize,
  style,
}: {
  id: string;
  name: string;
  mxc?: string | null;
  size?: number;
  radius?: number;
  fontSize?: number;
  style?: CSSProperties;
}) {
  // Every avatar in the app asks for one size, whatever it's drawn at.
  //
  // The size is part of the URL and therefore the cache key, so a 38px timeline
  // avatar and a 66px card avatar would otherwise be two fetches of the same
  // picture — and on a bad day the second one is a ten-second federation stall
  // that ends in a monogram while the first renders fine. One bucket, scaled by
  // CSS, means an avatar is fetched once and then always instant.
  const src = mediaUrl(mxc, { width: AVATAR_FETCH_SIZE, height: AVATAR_FETCH_SIZE });

  // The monogram is not just the no-avatar case: it's also what's shown while
  // the image loads and if it never arrives. Remote avatars can take seconds or
  // fail outright (see ARCHITECTURE.md on thumbnails), and the alternative is
  // the WebView's broken-image glyph, which looks like a bug in us.
  //
  // These track *which* src succeeded rather than a plain loaded/failed flag:
  // a cached image can fire `load` before an effect could reset the flag, and a
  // state reset racing that event leaves a loaded image sitting at opacity 0
  // behind its own monogram.
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();
  const loaded = !!src && loadedSrc === src;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        width: size,
        height: size,
        flex: "none",
        borderRadius: radius ?? Math.round(size * 0.36),
        border: "2px solid var(--ink-950)",
        background: loaded ? "var(--ink-900)" : accentFor(id),
        color: "var(--text-on-accent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        fontSize: fontSize ?? Math.max(10, Math.round(size * 0.37)),
        userSelect: "none",
        ...style,
      }}
    >
      {!loaded && initialsFor(name)}
      {src && failedSrc !== src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          // A cached image can finish before React attaches `onLoad`, so the
          // element is asked directly on mount as well.
          ref={(node) => {
            if (node?.complete && node.naturalWidth > 0 && loadedSrc !== src) {
              setLoadedSrc(src);
            }
          }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // Fades in over the monogram rather than popping.
            opacity: loaded ? 1 : 0,
            transition: "opacity var(--dur-fast) var(--ease-out)",
          }}
        />
      )}
    </div>
  );
}

/**
 * A small corner badge marking what kind of room this is: `#` for a text
 * channel, a camera for a video room. DMs get nothing — a person isn't a
 * channel, and the avatar already says who they are.
 */
export function ChannelBadge({
  kind,
  size = 16,
  ring = "var(--ink-900)",
}: {
  kind: "text" | "video";
  size?: number;
  ring?: string;
}) {
  const video = kind === "video";
  return (
    <div
      title={video ? "video room" : "text room"}
      style={{
        position: "absolute",
        left: -4,
        bottom: -4,
        width: size,
        height: size,
        borderRadius: "50%",
        background: video ? "var(--accent-tertiary)" : "var(--ink-700)",
        border: `2px solid ${ring}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      {video ? (
        <Icon name="video-camera" size={size * 0.5} color="var(--ink-950)" />
      ) : (
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: size * 0.62,
            lineHeight: 1,
            color: "var(--text-secondary)",
          }}
        >
          #
        </span>
      )}
    </div>
  );
}

export function PresenceDot({
  colour = "var(--status-online)",
  size = 12,
  ring = "var(--ink-900)",
}: {
  colour?: string;
  size?: number;
  ring?: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        right: -3,
        bottom: -3,
        width: size,
        height: size,
        borderRadius: "50%",
        background: colour,
        border: `2px solid ${ring}`,
      }}
    />
  );
}

/** The uppercase, letter-spaced section label used throughout the design. */
export function RaveLabel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-rave)",
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  type = "button",
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
}) {
  const palette = {
    primary: {
      background: "var(--accent-primary)",
      color: "var(--text-on-accent)",
      border: "2px solid var(--ink-950)",
      boxShadow: "var(--shadow-sticker-ink)",
    },
    ghost: {
      background: "transparent",
      color: "var(--text-secondary)",
      border: "1px solid var(--border-default)",
    },
    danger: {
      background: "var(--status-danger)",
      color: "var(--ink-950)",
      border: "2px solid var(--ink-950)",
    },
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: size === "sm" ? "7px 15px" : "10px 20px",
        borderRadius: 999,
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size === "sm" ? 13 : 14.5,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "transform var(--dur-fast) var(--ease-bounce)",
        whiteSpace: "nowrap",
        ...palette,
        ...style,
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
      }}
    >
      {children}
    </button>
  );
}

/** A small pill used for the e2e badge, bridge tags and role labels. */
export function Tag({
  children,
  colour = "var(--accent-primary)",
  icon,
}: {
  children: ReactNode;
  colour?: string;
  icon?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${colour} 40%, transparent)`,
        background: `color-mix(in srgb, ${colour} 12%, transparent)`,
        color: colour,
        fontFamily: "var(--font-rave)",
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {icon && <Icon name={icon} size={11} color={colour} />}
      {children}
    </span>
  );
}

/** The full-bleed ray pattern behind the whole app. */
export function BackdropPattern() {
  return (
    <div className="uwu-pattern">
      <div className="uwu-rays" />
    </div>
  );
}

export function Spinner({ size = 16, color = "var(--accent-primary)" }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid color-mix(in srgb, ${color} 25%, transparent)`,
        borderTopColor: color,
        animation: "uwuSpin 0.7s linear infinite",
      }}
    />
  );
}

/** A row that dims and highlights on hover, used by list items. */
export function HoverRow({
  children,
  onClick,
  active,
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        cursor: onClick ? "pointer" : "default",
        background: active ? "rgba(255,255,255,.07)" : "transparent",
        transition: "background var(--dur-fast) var(--ease-out)",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "rgba(255,255,255,.07)" : "transparent";
      }}
    >
      {children}
    </div>
  );
}
