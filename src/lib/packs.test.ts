import { describe, expect, it } from "vitest";

import {
  emoteLookup,
  emoteRefs,
  matchEmotes,
  reactionImage,
  reactionShortcode,
  stickersOf,
  typingShortcode,
} from "./packs";
import type { ImagePack, PackImage } from "./types";

function image(shortcode: string, extra: Partial<PackImage> = {}): PackImage {
  return {
    shortcode,
    url: `mxc://veil.gg/${shortcode}`,
    body: shortcode,
    isEmoticon: true,
    isSticker: false,
    width: null,
    height: null,
    size: null,
    mimetype: null,
    ...extra,
  };
}

function pack(id: string, images: PackImage[], extra: Partial<ImagePack> = {}): ImagePack {
  return {
    id,
    source: id === "user" ? "user" : "room",
    roomId: id === "user" ? null : "!r:veil.gg",
    stateKey: id === "user" ? null : id,
    displayName: id,
    avatarUrl: null,
    attribution: null,
    images,
    everywhere: true,
    canEdit: false,
    ...extra,
  };
}

describe("emoteLookup", () => {
  it("lets the first pack keep a shortcode two packs both claim", () => {
    const mine = image("blobcat");
    const theirs = image("blobcat", { url: "mxc://elsewhere/cat" });

    const lookup = emoteLookup([pack("user", [mine]), pack("room", [theirs])]);
    expect(lookup.get("blobcat")).toBe(mine);
  });

  it("keeps a room's own pack, which is usable in that room", () => {
    // `everywhere` is about following you elsewhere, not about being usable
    // where it lives, so it must not filter here.
    const lookup = emoteLookup([pack("room", [image("blobcat")], { everywhere: false })]);
    expect(lookup.size).toBe(1);
  });

  it("skips images that are stickers only", () => {
    const lookup = emoteLookup([
      pack("user", [image("wave", { isEmoticon: false, isSticker: true })]),
    ]);
    expect(lookup.size).toBe(0);
  });
});

describe("emoteRefs", () => {
  it("hands over just what the backend substitutes with", () => {
    expect(emoteRefs([pack("user", [image("uwu")])])).toEqual([
      { shortcode: "uwu", url: "mxc://veil.gg/uwu" },
    ]);
  });
});

describe("stickersOf", () => {
  it("collects stickers across every pack, in order", () => {
    const sticker = image("wave", { isEmoticon: false, isSticker: true });
    const other = image("hidden", { isSticker: true });
    const packs = [pack("user", [image("uwu"), sticker]), pack("room", [other])];

    expect(stickersOf(packs)).toEqual([sticker, other]);
  });
});

describe("reactionShortcode", () => {
  it("recognises a reaction that is exactly one shortcode", () => {
    expect(reactionShortcode(":blobcat:")).toBe("blobcat");
    expect(reactionShortcode("  :blobcat:  ")).toBe("blobcat");
  });

  it("leaves anything else alone", () => {
    expect(reactionShortcode("👍")).toBeNull();
    expect(reactionShortcode("nice :blobcat:")).toBeNull();
    expect(reactionShortcode("::")).toBeNull();
  });
});

describe("reactionImage", () => {
  const lookup = emoteLookup([pack("user", [image("blobcat")])]);

  it("draws a shortcode we have the pack for", () => {
    expect(reactionImage(":blobcat:", lookup)).toEqual({
      url: "mxc://veil.gg/blobcat",
      label: ":blobcat:",
    });
  });

  it("leaves a shortcode we don't have as text", () => {
    expect(reactionImage(":whoknows:", lookup)).toBeNull();
  });

  it("draws a bare mxc key, which is what some clients react with", () => {
    // FluffyChat and friends put the image's own address in the reaction. No
    // pack is needed to show it — the key *is* the picture.
    expect(reactionImage("mxc://m.uwu.lt/E0BVMUGArK7dEk9", lookup)).toEqual({
      url: "mxc://m.uwu.lt/E0BVMUGArK7dEk9",
      label: "mxc://m.uwu.lt/E0BVMUGArK7dEk9",
    });
  });

  it("names an mxc key from the pack when we happen to have that image", () => {
    expect(reactionImage("mxc://veil.gg/blobcat", lookup)).toEqual({
      url: "mxc://veil.gg/blobcat",
      label: ":blobcat:",
    });
  });

  it("leaves ordinary reactions alone", () => {
    expect(reactionImage("👍", lookup)).toBeNull();
    expect(reactionImage("nice one", lookup)).toBeNull();
    // Not an address — a sentence that happens to mention one.
    expect(reactionImage("see mxc://veil.gg/blobcat", lookup)).toBeNull();
    expect(reactionImage("https://example.org/cat.png", lookup)).toBeNull();
  });
});

describe("typingShortcode", () => {
  const at = (text: string) => typingShortcode(text, text.length);

  it("catches a shortcode being typed at the start of a word", () => {
    expect(at(":blob")).toEqual({ query: "blob", start: 0 });
    expect(at("hello :blob")).toEqual({ query: "blob", start: 6 });
  });

  it("waits for at least one character after the colon", () => {
    expect(at(":")).toBeNull();
  });

  it("ignores a colon in the middle of a word", () => {
    // Otherwise every URL and every clock time would open the menu.
    expect(at("https://example")).toBeNull();
    expect(at("3:15")).toBeNull();
  });

  it("stops once the shortcode is closed or the word ends", () => {
    expect(at(":blobcat: ")).toBeNull();
    expect(at(":blob cat")).toBeNull();
  });

  it("reads at the caret, not at the end of the line", () => {
    const text = ":blob and more";
    expect(typingShortcode(text, 5)).toEqual({ query: "blob", start: 0 });
  });
});

describe("matchEmotes", () => {
  const lookup = emoteLookup([
    pack("user", [image("blobcat"), image("catjam"), image("uwu")]),
  ]);

  it("puts what starts with the query first", () => {
    expect(matchEmotes(lookup, "cat").map((i) => i.shortcode)).toEqual(["catjam", "blobcat"]);
  });

  it("matches without regard to case", () => {
    expect(matchEmotes(lookup, "UWU").map((i) => i.shortcode)).toEqual(["uwu"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(matchEmotes(lookup, "zzz")).toEqual([]);
  });
});
