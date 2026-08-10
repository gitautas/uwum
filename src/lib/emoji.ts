/**
 * The Unicode emoji set, prepared for the picker.
 *
 * The dataset ships one entry per emoji with its skin-tone variants folded into
 * a flag, which is the shape a picker wants: five rows of identical hands are
 * noise. Tones are applied on the way out instead, from whichever one the user
 * has chosen.
 *
 * Everything here is derived once at module load. The set is ~1900 entries —
 * small enough that a linear search per keystroke is imperceptible, and far
 * cheaper than maintaining an index that has to be kept in step with it.
 */

import groups from "unicode-emoji-json/data-by-group.json";

export interface Emoji {
  /** The character itself, without any skin tone applied. */
  emoji: string;
  /** "grinning face with big eyes" — also what search matches against. */
  name: string;
  skinToneSupport: boolean;
}

export interface EmojiGroup {
  name: string;
  /** Phosphor icon for the category rail. */
  icon: string;
  emojis: Emoji[];
}

/**
 * Icons for the dataset's nine groups, by name.
 *
 * Keyed by the group names the data actually uses, so a dataset update that
 * renames or adds a group shows a neutral icon rather than crashing the picker.
 */
const GROUP_ICONS: Record<string, string> = {
  "Smileys & Emotion": "smiley",
  "People & Body": "hand-waving",
  "Animals & Nature": "cat",
  "Food & Drink": "hamburger",
  "Travel & Places": "airplane-tilt",
  Activities: "basketball",
  Objects: "lightbulb",
  Symbols: "heart",
  Flags: "flag",
};

interface RawGroup {
  name: string;
  emojis: { emoji: string; name: string; skin_tone_support: boolean }[];
}

export const EMOJI_GROUPS: EmojiGroup[] = (groups as RawGroup[]).map((group) => ({
  name: group.name.toLowerCase(),
  icon: GROUP_ICONS[group.name] ?? "dots-three-circle",
  emojis: group.emojis.map((e) => ({
    emoji: e.emoji,
    name: e.name,
    skinToneSupport: e.skin_tone_support,
  })),
}));

const ALL: Emoji[] = EMOJI_GROUPS.flatMap((group) => group.emojis);

/** Look up an emoji's name, for the picker's preview line. */
const BY_CHAR = new Map(ALL.map((e) => [e.emoji, e]));

export function emojiName(emoji: string): string | undefined {
  return BY_CHAR.get(emoji)?.name;
}

// ---------------------------------------------------------------------------
// skin tones
// ---------------------------------------------------------------------------

/** 0 is the default yellow; 1–5 are the Fitzpatrick modifiers. */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

const TONE_MODIFIERS = ["🏻", "🏼", "🏽", "🏾", "🏿"];

/** U+FE0F, as an escape because the character itself is invisible. */
const VARIATION_SELECTOR = "\uFE0F";

/** A swatch each, for the tone picker. Index 0 is the default. */
export const TONE_SAMPLES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];

/**
 * Apply a skin tone, which goes immediately after the base character.
 *
 * In a sequence like 👨‍💻 the tone attaches to the person, not to the end — and
 * a base that carries a variation selector (☝️) drops it, since the modifier
 * already forces the emoji presentation.
 */
export function withSkinTone(emoji: string, tone: SkinTone): string {
  if (tone === 0) return emoji;

  const points = [...emoji];
  const rest = points.slice(points[1] === VARIATION_SELECTOR ? 2 : 1);
  return [points[0], TONE_MODIFIERS[tone - 1], ...rest].join("");
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Emoji whose name matches every word of the query.
 *
 * Requiring all words lets "red heart" narrow rather than widen, and matching
 * on word starts keeps "car" off "scar" while still finding "racing car".
 * Results that begin with the query sort first, so "hear" leads with ❤️ rather
 * than with something that merely contains it.
 */
export function searchEmoji(query: string, limit = 90): Emoji[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const matches: { emoji: Emoji; leading: boolean }[] = [];

  for (const emoji of ALL) {
    const name = emoji.name.toLowerCase();
    if (!words.every((word) => wordStartsWith(name, word))) continue;

    matches.push({ emoji, leading: name.startsWith(words[0]) });
    if (matches.length >= limit * 2) break;
  }

  return matches
    .sort((a, b) => Number(b.leading) - Number(a.leading))
    .slice(0, limit)
    .map((m) => m.emoji);
}

function wordStartsWith(haystack: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(word, from);
    if (at === -1) return false;
    // The start of the name, or just past a separator, counts as a word start.
    if (at === 0 || /[\s\-_&]/.test(haystack[at - 1])) return true;
    from = at + 1;
  }
}
