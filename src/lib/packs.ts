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

/**
 * Shortcode → image across *every* image, whatever it's for.
 *
 * Used to work out what a shortcode someone sent stands for, which is a
 * different question from what this person may type. A pack marked stickers-only
 * still has names, and a reaction carrying one of those names should be drawn
 * rather than left as `:endurance:` because it wouldn't have appeared in the
 * emote picker.
 */
export function imageLookup(packs: ImagePack[]): Map<string, PackImage> {
  const out = new Map<string, PackImage>();

  for (const pack of packs) {
    for (const image of pack.images) {
      if (!out.has(image.shortcode)) out.set(image.shortcode, image);
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
 * Some clients react with `:blobcat:` rather than with the image's address —
 * we used to as well — so this is still read even though nothing writes it.
 */
export function reactionShortcode(key: string): string | null {
  const match = /^:([^\s:]+):$/.exec(key.trim());
  return match ? match[1] : null;
}

/**
 * The reaction key a pick should be sent as.
 *
 * A custom emote goes in as the image's own address, which is what the clients
 * this account's friends use send: reactions aggregate on exact string
 * equality, so matching them is what decides whether the same emote makes one
 * pile or two. Read the other way round by `reactionImage`, which is why the
 * two live together.
 *
 * Not every client agrees — some send `:shortcode:` and show nothing useful for
 * an address. There is no key that satisfies both, so this follows the one we
 * have evidence for.
 *
 * Stickers aren't reactable — a reaction is a string — so they never reach
 * here; a caller that asks anyway gets the sticker's address, which at least
 * shows the right picture.
 */
export function reactionKeyFor(picked: Picked): string {
  return picked.kind === "unicode" ? picked.emoji : picked.image.url;
}

/** A reaction that should be drawn as a picture rather than as text. */
export interface ReactionImage {
  url: string;
  /** What to put in the tooltip and the alt text. */
  label: string;
}

/**
 * The image a reaction key stands for, if any.
 *
 * There are two ways a custom emote ends up in a reaction, because a reaction
 * key is a bare string and the ecosystem never agreed on what to put in it:
 *
 * * `:blobcat:` — the shortcode, which needs the pack to mean anything, and
 *   reads as those characters everywhere else.
 * * `mxc://…` — the image's own address, which FluffyChat sends and so do we.
 *   Nothing has to be looked up: the key *is* the picture.
 *
 * Both are drawn as the image. An mxc key is named from the pack when we happen
 * to have that image, since `:blobcat:` is a better tooltip than a media ID,
 * and left as the URI when we don't — we can still show it, we just can't say
 * what its owner calls it.
 */
export function reactionImage(
  key: string,
  lookup: Map<string, PackImage>,
): ReactionImage | null {
  const trimmed = key.trim();

  const shortcode = reactionShortcode(trimmed);
  if (shortcode) {
    const image = lookup.get(shortcode);
    return image ? { url: image.url, label: `:${shortcode}:` } : null;
  }

  if (!trimmed.startsWith("mxc://") || /\s/.test(trimmed)) return null;

  const known = [...lookup.entries()].find(([, image]) => image.url === trimmed);
  return { url: trimmed, label: known ? `:${known[0]}:` : trimmed };
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
