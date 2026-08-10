/**
 * Custom emotes and stickers, on the frontend side.
 *
 * The backend hands over whole packs; everything here is about turning those
 * into the three things the UI actually asks for — "what does `:blobcat:` look
 * like", "what can I type into this message", and "what should the picker show".
 */

import type { ImagePack, PackImage } from "./types";

/** What a pick from the emoji picker turns out to be. */
export type Picked =
  | { kind: "unicode"; emoji: string }
  | { kind: "emote"; image: PackImage }
  | { kind: "sticker"; image: PackImage };

/**
 * Shortcode → image, for everything usable as an inline emote.
 *
 * Shortcodes aren't unique across packs — two rooms can both call something
 * `blobcat` — so the first pack to claim one keeps it. Packs arrive with the
 * personal one first, which makes "mine wins" the rule without anything here
 * having to know about it.
 */
export function emoteLookup(packs: ImagePack[]): Map<string, PackImage> {
  const out = new Map<string, PackImage>();

  for (const pack of packs) {
    for (const image of pack.images) {
      if (image.isEmoticon && !out.has(image.shortcode)) out.set(image.shortcode, image);
    }
  }

  return out;
}

/** The emotes to offer the backend when sending, so it can substitute them. */
export function emoteRefs(packs: ImagePack[]): { shortcode: string; url: string }[] {
  return [...emoteLookup(packs)].map(([shortcode, image]) => ({
    shortcode,
    url: image.url,
  }));
}

/** Every sticker on offer, in pack order. */
export function stickersOf(packs: ImagePack[]): PackImage[] {
  return packs.flatMap((p) => p.images.filter((i) => i.isSticker));
}

/**
 * A reaction key that is exactly one shortcode, or null.
 *
 * Reactions are plain strings in Matrix, so reacting with a custom emote sends
 * `:blobcat:` and every other client shows those characters. We draw the image
 * when we know it and leave the text alone when we don't, which is the same
 * bargain the sender made.
 */
export function reactionShortcode(key: string): string | null {
  const match = /^:([^\s:]+):$/.exec(key.trim());
  return match ? match[1] : null;
}

/**
 * The shortcode being typed at the caret, for autocomplete.
 *
 * Triggers on `:` plus at least one character, and only when the colon starts a
 * word — otherwise every `http://` and `3:15` would open the menu. Returns the
 * partial code and where it starts, so the caller can replace exactly that run.
 */
export function typingShortcode(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const colon = before.lastIndexOf(":");
  if (colon === -1) return null;

  const query = before.slice(colon + 1);
  if (query.length === 0 || /[\s:]/.test(query)) return null;

  const preceding = colon === 0 ? "" : before[colon - 1];
  if (preceding !== "" && !/\s/.test(preceding)) return null;

  return { query, start: colon };
}

/** Emotes whose shortcode contains the query, best matches first. */
export function matchEmotes(
  lookup: Map<string, PackImage>,
  query: string,
  limit = 8,
): PackImage[] {
  const needle = query.toLowerCase();

  return [...lookup.entries()]
    .filter(([shortcode]) => shortcode.toLowerCase().includes(needle))
    .sort(([a], [b]) => {
      const lead = Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle));
      return lead || a.localeCompare(b);
    })
    .slice(0, limit)
    .map(([, image]) => image);
}
