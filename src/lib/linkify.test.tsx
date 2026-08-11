/**
 * Finding links in text nobody marked up.
 *
 * The security half is in `richText.test.tsx`; this is about not guessing
 * wrong — a linkifier that swallows the full stop after a URL, or turns a
 * sentence into a link, is worse than one that does nothing.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));

const { linkify, renderFormattedBody } = await import("./richText");

afterEach(cleanup);

function text(source: string): HTMLElement {
  const { container } = render(<div>{linkify(source)}</div>);
  return container;
}

/** The one link in the rendered output. */
function link(source: string): HTMLAnchorElement {
  const anchor = text(source).querySelector("a");
  if (!anchor) throw new Error(`no link found in ${source}`);
  return anchor;
}

describe("linkify", () => {
  it("finds a plain https url", () => {
    const anchor = link("look at https://uwu.lt/docs please");
    expect(anchor.getAttribute("href")).toBe("https://uwu.lt/docs");
    expect(anchor.textContent).toBe("https://uwu.lt/docs");
  });

  it("keeps the surrounding words", () => {
    expect(text("look at https://uwu.lt now").textContent).toBe("look at https://uwu.lt now");
  });

  it("treats a bare www as https", () => {
    expect(link("www.uwu.lt").getAttribute("href")).toBe("https://www.uwu.lt/");
  });

  it("leaves the sentence's full stop out of the link", () => {
    const container = text("read https://uwu.lt/docs.");
    expect(container.querySelector("a")!.textContent).toBe("https://uwu.lt/docs");
    expect(container.textContent).toBe("read https://uwu.lt/docs.");
  });

  it("keeps brackets the url opened itself", () => {
    const anchor = link("https://en.wikipedia.org/wiki/Cat_(disambiguation)");
    expect(anchor.textContent).toBe("https://en.wikipedia.org/wiki/Cat_(disambiguation)");
  });

  it("drops a bracket the url never opened", () => {
    const container = text("(see https://uwu.lt/docs)");
    expect(container.querySelector("a")!.textContent).toBe("https://uwu.lt/docs");
    expect(container.textContent).toBe("(see https://uwu.lt/docs)");
  });

  it("finds several links in one message", () => {
    const { container } = render(<div>{linkify("https://a.example and https://b.example")}</div>);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://a.example/", "https://b.example/"]);
  });

  it("leaves ordinary prose alone", () => {
    const container = text("no links here. none at all!");
    expect(container.querySelector("a")).toBeNull();
  });

  it("doesn't link a scheme glued to a word with no host", () => {
    expect(text("https://localgarbage").querySelector("a")).toBeNull();
  });

  it("does link localhost, which people really do paste", () => {
    expect(link("http://localhost:1420/x").getAttribute("href")).toBe(
      "http://localhost:1420/x",
    );
  });

  it("refuses a javascript: url even if someone types one", () => {
    // Not matched at all — but the assertion is about the outcome, not the
    // mechanism, because that's what matters if the pattern ever changes.
    const container = text("javascript:alert(1)");
    expect(container.querySelector("a")).toBeNull();
  });

  it("opens in the browser rather than navigating the app", () => {
    const anchor = link("https://uwu.lt/docs");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(openUrl).toHaveBeenCalledWith("https://uwu.lt/docs");
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("linkify inside formatted bodies", () => {
  it("finds a bare url in html nobody linked", () => {
    const { container } = render(
      <div>{renderFormattedBody("<p>see https://uwu.lt/docs</p>")}</div>,
    );
    expect(container.querySelector("a")!.getAttribute("href")).toBe("https://uwu.lt/docs");
  });

  it("never nests a link inside a real one", () => {
    const { container } = render(
      <div>
        {renderFormattedBody('<a href="https://uwu.lt">https://uwu.lt/other</a>')}
      </div>,
    );
    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("https://uwu.lt/");
  });

  it("leaves code blocks verbatim", () => {
    const { container } = render(
      <div>{renderFormattedBody("<pre><code>curl https://uwu.lt</code></pre>")}</div>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("curl https://uwu.lt");
  });

  it("still linkifies a marked-up link", () => {
    render(<div>{renderFormattedBody('<a href="https://uwu.lt">docs</a>')}</div>);
    expect(screen.getByText("docs").getAttribute("href")).toBe("https://uwu.lt/");
  });
});
