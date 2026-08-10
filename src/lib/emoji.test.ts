import { describe, expect, it } from "vitest";

import { emojiName, searchEmoji, withSkinTone } from "./emoji";

describe("withSkinTone", () => {
  it("leaves the default tone alone", () => {
    expect(withSkinTone("✋", 0)).toBe("✋");
  });

  it("attaches the modifier to a plain emoji", () => {
    expect(withSkinTone("✋", 3)).toBe("✋🏽");
  });

  it("attaches to the person in a joined sequence, not the end", () => {
    // 👨‍💻 is man + ZWJ + laptop; the tone belongs to the man.
    expect(withSkinTone("👨‍💻", 5)).toBe("👨🏿‍💻");
  });

  it("drops a variation selector the modifier makes redundant", () => {
    // ☝️ is U+261D + U+FE0F. Keeping both renders as a boxed glyph on some
    // platforms, so the selector goes.
    expect(withSkinTone("☝️", 1)).toBe("☝🏻");
  });
});

describe("searchEmoji", () => {
  it("finds an emoji by a word in its name", () => {
    const names = searchEmoji("cat").map((e) => e.name);
    expect(names).toContain("cat");
    expect(names).toContain("cat face");
  });

  it("matches word starts rather than any substring", () => {
    // "scarf" contains "car", but is not what someone typing "car" wants.
    expect(searchEmoji("car").map((e) => e.name)).not.toContain("scarf");
  });

  it("narrows as words are added", () => {
    const one = searchEmoji("face");
    const two = searchEmoji("face heart");
    expect(two.length).toBeLessThan(one.length);
    expect(two.every((e) => /face/.test(e.name) && /heart/.test(e.name))).toBe(true);
  });

  it("returns nothing for a blank query", () => {
    expect(searchEmoji("   ")).toEqual([]);
  });
});

describe("emojiName", () => {
  it("names an emoji the picker can show", () => {
    expect(emojiName("😀")).toBe("grinning face");
  });

  it("has no name for something outside the set", () => {
    expect(emojiName("not an emoji")).toBeUndefined();
  });
});
