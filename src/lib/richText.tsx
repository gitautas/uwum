/**
 * Rendering Matrix's `formatted_body`.
 *
 * Messages arrive as an HTML subset produced by whatever client sent them, and
 * a homeserver can serve anything it likes. In a Tauri WebView an XSS is not a
 * stolen cookie — it is arbitrary access to the IPC bridge, and through it the
 * user's session and message keys. So this never touches `innerHTML`.
 *
 * Instead the markup is parsed inert, walked, and rebuilt as React elements
 * from a strict allowlist. Anything not on the list is dropped while keeping
 * its text, so an unknown tag degrades to plain words rather than vanishing.
 * Because we construct elements rather than inject markup, an attribute or tag
 * we failed to anticipate has no way to become executable.
 *
 * The allowlist follows the "safe" subset in the Matrix spec (§ m.room.message).
 */

import type { CSSProperties, ReactNode } from "react";

import { mediaUrl } from "./ipc";

/** Tags we render, mapped to how they're drawn. */
const INLINE_STYLES: Record<string, CSSProperties> = {
  strong: { fontWeight: 700 },
  b: { fontWeight: 700 },
  em: { fontStyle: "italic" },
  i: { fontStyle: "italic" },
  u: { textDecoration: "underline" },
  del: { textDecoration: "line-through", opacity: 0.7 },
  s: { textDecoration: "line-through", opacity: 0.7 },
  strike: { textDecoration: "line-through", opacity: 0.7 },
  sup: { verticalAlign: "super", fontSize: "0.8em" },
  sub: { verticalAlign: "sub", fontSize: "0.8em" },
};

const HEADING_SIZES: Record<string, number> = {
  h1: 21,
  h2: 19,
  h3: 17,
  h4: 15.5,
  h5: 15,
  h6: 14.5,
};

/**
 * URL schemes a link may use.
 *
 * `javascript:` and `data:` are the obvious attacks; `blob:` and `file:` are
 * excluded too, since neither has any business arriving from a remote message.
 */
const SAFE_SCHEMES = ["http:", "https:", "mailto:", "matrix:"];

function safeHref(raw: string | null): string | undefined {
  if (!raw) return undefined;
  // A relative URL has nothing sensible to resolve against here, so require an
  // absolute one and check its scheme explicitly.
  try {
    const url = new URL(raw);
    return SAFE_SCHEMES.includes(url.protocol) ? url.toString() : undefined;
  } catch {
    // Not absolute, so we can't establish what it points at. Render the link
    // text without making it clickable.
    return undefined;
  }
}

const codeStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.9em",
  background: "var(--ink-900)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 6,
  padding: "1px 5px",
};

/**
 * How tall an inline custom emote is drawn.
 *
 * MSC2545 emotes arrive as `<img data-mx-emoticon>` with whatever height the
 * sending client felt like (FluffyChat says 32, Cinny leaves it off), so the
 * attribute is ignored and they're drawn to match the text they sit in. A
 * message that is *only* emotes gets the big treatment, the same as a message
 * of nothing but Unicode emoji.
 */
const EMOTICON_SIZE = "1.45em";
const EMOTICON_JUMBO = 48;

function renderChildren(node: Node, depth: number, emoticon: string): ReactNode[] {
  return Array.from(node.childNodes).map((child, i) => (
    <RenderNode key={i} node={child} depth={depth + 1} emoticon={emoticon} />
  ));
}

/** Guards against a pathological or hostile nesting depth. */
const MAX_DEPTH = 24;

function RenderNode({
  node,
  depth,
  emoticon,
}: {
  node: Node;
  depth: number;
  /** CSS height for custom emotes in this message. */
  emoticon: string;
}): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (depth > MAX_DEPTH) return node.textContent;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (INLINE_STYLES[tag]) {
    return <span style={INLINE_STYLES[tag]}>{renderChildren(el, depth, emoticon)}</span>;
  }

  if (HEADING_SIZES[tag]) {
    return (
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: HEADING_SIZES[tag],
          margin: "6px 0 2px",
        }}
      >
        {renderChildren(el, depth, emoticon)}
      </div>
    );
  }

  switch (tag) {
    case "br":
      return <br />;

    case "p":
      return <div style={{ margin: "0 0 4px" }}>{renderChildren(el, depth, emoticon)}</div>;

    case "code":
      // A <code> inside <pre> is styled by the <pre>; don't double up.
      if (el.parentElement?.tagName.toLowerCase() === "pre") {
        return <>{renderChildren(el, depth, emoticon)}</>;
      }
      return <code style={codeStyle}>{renderChildren(el, depth, emoticon)}</code>;

    case "pre":
      return (
        <div
          className="selectable"
          style={{
            marginTop: 6,
            maxWidth: 560,
            background: "var(--ink-900)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            padding: "11px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            color: "var(--acid-400)",
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {renderChildren(el, depth, emoticon)}
        </div>
      );

    case "blockquote":
      return (
        <div
          style={{
            borderLeft: "3px solid var(--border-strong)",
            paddingLeft: 10,
            margin: "4px 0",
            color: "var(--text-secondary)",
          }}
        >
          {renderChildren(el, depth, emoticon)}
        </div>
      );

    case "ul":
    case "ol":
      return (
        <div style={{ margin: "4px 0", paddingLeft: 18 }}>
          {Array.from(el.children).map((li, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: "var(--text-tertiary)", flex: "none" }}>
                {tag === "ol" ? `${i + 1}.` : "•"}
              </span>
              <span>{renderChildren(li, depth, emoticon)}</span>
            </div>
          ))}
        </div>
      );

    case "a": {
      const href = safeHref(el.getAttribute("href"));
      if (!href) return <>{renderChildren(el, depth, emoticon)}</>;
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {renderChildren(el, depth, emoticon)}
        </a>
      );
    }

    case "img": {
      const emote = isEmoticon(el);
      const alt = el.getAttribute("alt") ?? "";

      // Only inline images we fetch ourselves. A remote URL here would leak the
      // reader's IP to whoever sent the message.
      const src = mediaUrl(
        el.getAttribute("src"),
        emote ? { width: 64, height: 64 } : { width: 240, height: 180 },
      );
      // A shortcode is the sender's own fallback text, so an emote we can't
      // fetch still reads as `:blobcat:` rather than disappearing.
      if (!src) return <>{alt}</>;

      if (emote) {
        return (
          <img
            src={src}
            alt={alt}
            title={alt}
            style={{
              height: emoticon,
              // Emotes are rarely square; let the width follow the aspect ratio
              // instead of squashing a wide one into a box.
              width: "auto",
              maxWidth: "8em",
              verticalAlign: "-0.28em",
              objectFit: "contain",
            }}
          />
        );
      }

      return (
        <img
          src={src}
          alt={alt}
          style={{ maxWidth: 240, maxHeight: 180, borderRadius: 10, verticalAlign: "middle" }}
        />
      );
    }

    case "hr":
      return (
        <div style={{ height: 1, background: "var(--border-subtle)", margin: "8px 0" }} />
      );

    case "mx-reply":
      // The reply fallback is duplicated in our own reply chip.
      return null;

    // Anything else — including <script>, <style>, <iframe> and every unknown
    // tag — contributes its text and nothing more.
    default:
      return <>{renderChildren(el, depth, emoticon)}</>;
  }
}

/**
 * Render a Matrix `formatted_body`, or `null` when there's nothing worth
 * rendering and the caller should fall back to the plain body.
 */
export function renderFormattedBody(html: string): ReactNode | null {
  const trimmed = html.trim();
  if (!trimmed) return null;

  // `DOMParser` builds an inert document: no scripts run, no resources load.
  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  if (!doc.body) return null;

  const emoticon = onlyEmoticons(doc.body) ? `${EMOTICON_JUMBO}px` : EMOTICON_SIZE;
  return <>{renderChildren(doc.body, 0, emoticon)}</>;
}

/** MSC2545 marks custom emotes with a bare `data-mx-emoticon` attribute. */
function isEmoticon(el: Element): boolean {
  return el.hasAttribute("data-mx-emoticon");
}

/**
 * True when the message is emotes and nothing else.
 *
 * The reply fallback doesn't count against it — a one-emote reply is still a
 * one-emote message — and neither does whitespace between them.
 */
function onlyEmoticons(body: Element): boolean {
  // The reply fallback is dropped at render time, so it has no business
  // deciding how big the message itself is drawn.
  const stripped = body.cloneNode(true) as Element;
  stripped.querySelectorAll("mx-reply").forEach((el) => el.remove());

  const images = [...stripped.querySelectorAll("img")];
  if (images.length === 0 || !images.every(isEmoticon)) return false;

  return textOutsideImages(stripped).trim() === "";
}

function textOutsideImages(node: Node): string {
  let text = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue ?? "";
    else if (child.nodeType === Node.ELEMENT_NODE) {
      if ((child as Element).tagName.toLowerCase() === "img") continue;
      text += textOutsideImages(child);
    }
  }
  return text;
}
