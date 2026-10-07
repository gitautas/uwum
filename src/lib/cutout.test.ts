import { describe, expect, it } from "vitest";
import { isCutout } from "./cutout";

/** `total` RGBA pixels, the first `clear` of them fully transparent. */
function pixels(total: number, clear: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(total * 4).fill(255);
  for (let i = 0; i < clear; i++) rgba[i * 4 + 3] = 0;
  return rgba;
}

describe("isCutout", () => {
  it("leaves an opaque image a picture", () => {
    expect(isCutout(pixels(2304, 0))).toBe(false);
  });

  it("leaves a screenshot with rounded corners a picture", () => {
    // Four small transparent corners on a 48×48 sample: well under 4%.
    expect(isCutout(pixels(2304, 40))).toBe(false);
  });

  it("calls a character on an empty background a cut-out", () => {
    expect(isCutout(pixels(2304, 1200))).toBe(true);
  });

  it("doesn't count half-transparent pixels as see-through", () => {
    const rgba = new Uint8ClampedArray(2304 * 4).fill(255);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 200;
    expect(isCutout(rgba)).toBe(false);
  });

  it("has nothing to say about no pixels", () => {
    expect(isCutout(new Uint8ClampedArray())).toBe(false);
  });
});
