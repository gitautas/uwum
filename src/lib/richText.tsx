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

function renderChildren(node: Node, depth: number): ReactNode[] {
  return Array.from(node.childNodes).map((child, i) => (
    <RenderNode key={i} node={child} depth={depth + 1} />
  ));
}

/** Guards against a pathological or hostile nesting depth. */
const MAX_DEPTH = 24;

function RenderNode({ node, depth }: { node: Node; depth: number }): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (depth > MAX_DEPTH) return node.textContent;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (INLINE_STYLES[tag]) {
    return <span style={INLINE_STYLES[tag]}>{renderChildren(el, depth)}</span>;
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
        {renderChildren(el, depth)}
      </div>
    );
  }

  switch (tag) {
    case "br":
      return <br />;

    case "p":
      return <div style={{ margin: "0 0 4px" }}>{renderChildren(el, depth)}</div>;

    case "code":
      // A <code> inside <pre> is styled by the <pre>; don't double up.
      if (el.parentElement?.tagName.toLowerCase() === "pre") {
        return <>{renderChildren(el, depth)}</>;
      }
      return <code style={codeStyle}>{renderChildren(el, depth)}</code>;

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
          {renderChildren(el, depth)}
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
          {renderChildren(el, depth)}
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
              <span>{renderChildren(li, depth)}</span>
            </div>
          ))}
        </div>
      );

    case "a": {
      const href = safeHref(el.getAttribute("href"));
      if (!href) return <>{renderChildren(el, depth)}</>;
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {renderChildren(el, depth)}
        </a>
      );
    }

    case "img": {
      // Only inline images we fetch ourselves. A remote URL here would leak the
      // reader's IP to whoever sent the message.
      const src = mediaUrl(el.getAttribute("src"), { width: 240, height: 180 });
      if (!src) return <>{el.getAttribute("alt") ?? ""}</>;
      return (
        <img
          src={src}
          alt={el.getAttribute("alt") ?? ""}
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
      return <>{renderChildren(el, depth)}</>;
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

  return <>{renderChildren(doc.body, 0)}</>;
}
