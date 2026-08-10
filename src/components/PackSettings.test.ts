import { describe, expect, it } from "vitest";

import { shortcodeFromPath, stateKeyFor } from "./PackSettings";

describe("shortcodeFromPath", () => {
  it("uses the filename, which is nearly always what was meant", () => {
    expect(shortcodeFromPath("/home/g/pics/blobcat.png")).toBe("blobcat");
    expect(shortcodeFromPath("C:\\Users\\g\\blobcat.gif")).toBe("blobcat");
  });

  it("reduces a name to something typeable between colons", () => {
    expect(shortcodeFromPath("/tmp/Blob Cat (1).png")).toBe("blob_cat_1");
    expect(shortcodeFromPath("/tmp/ačiū.png")).toBe("a_i");
  });

  it("always produces something, even from a name with nothing usable in it", () => {
    expect(shortcodeFromPath("/tmp/....png")).toBe("emote");
    expect(shortcodeFromPath("/tmp/🐱.png")).toBe("emote");
  });
});

describe("stateKeyFor", () => {
  it("slugs the pack name so a state dump stays readable", () => {
    expect(stateKeyFor("The Blob Pack")).toBe("the-blob-pack");
  });

  it("falls back to something unique when the name slugs to nothing", () => {
    expect(stateKeyFor("🐱🐱🐱")).toMatch(/^pack-[a-z0-9]+$/);
  });
});
