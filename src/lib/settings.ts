/**
 * Local preferences — things that belong to this machine rather than the
 * account, so they live in `localStorage` and never touch the homeserver.
 */

export type Accent = "acid" | "pink" | "violet" | "cyan";

export interface Settings {
  accent: Accent;
  /** `deviceId` of the microphone, or "" for the system default. */
  audioInput: string;
  /** `deviceId` of the speaker, or "" for the system default. */
  audioOutput: string;
  /** Overrides the LiveKit SFU discovered from `.well-known`. */
  livekitUrl: string;
  /** Send on Enter (Discord-style) vs. Cmd+Enter. */
  sendOnEnter: boolean;
  /** Show the room info panel beside the timeline. */
  showInfoPanel: boolean;
}

export const DEFAULTS: Settings = {
  accent: "acid",
  audioInput: "",
  audioOutput: "",
  livekitUrl: "",
  sendOnEnter: true,
  showInfoPanel: true,
};

const STORAGE_KEY = "uwum:settings";

/**
 * The design's four neon accents, as the palette tokens they come from.
 *
 * Each accent is the 500/400/600 step of one ramp — base, hover, pressed —
 * which is exactly how the design system defines them. Naming the tokens rather
 * than repeating their hex keeps `tokens/colors.css` the only place a colour is
 * written down.
 */
const ACCENTS: Record<Accent, [string, string, string]> = {
  acid: ["--acid-500", "--acid-400", "--acid-600"],
  pink: ["--pink-500", "--pink-400", "--pink-600"],
  violet: ["--violet-500", "--violet-400", "--violet-600"],
  cyan: ["--cyan-500", "--cyan-400", "--cyan-600"],
};

export const ACCENT_SWATCHES = Object.entries(ACCENTS).map(([name, [base]]) => ({
  name: name as Accent,
  colour: `var(${base})`,
}));

export function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    // Merge over the defaults so a settings file written by an older build
    // doesn't leave new keys undefined.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or disabled localStorage shouldn't break the app; the user just
    // loses their preferences on restart.
  }
}

/** Paint the chosen accent onto the document, as the design's `accent` prop does. */
export function applyAccent(accent: Accent): void {
  const [base, hover, press] = ACCENTS[accent] ?? ACCENTS.acid;
  const root = document.documentElement;
  // A custom property can hold a `var()` reference, so the accent aliases point
  // at palette tokens rather than carrying copies of their values.
  root.style.setProperty("--accent-primary", `var(${base})`);
  root.style.setProperty("--accent-primary-hover", `var(${hover})`);
  root.style.setProperty("--accent-primary-press", `var(${press})`);
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

/**
 * List the microphones and speakers we're allowed to see.
 *
 * Labels are blank until the user has granted microphone access at least once,
 * so this asks for permission first — otherwise the picker shows a list of
 * anonymous "Device 1", "Device 2" entries that nobody can choose between.
 */
export async function listAudioDevices(): Promise<{
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // We only wanted the permission, not the audio.
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Denied or no microphone — we can still list outputs, just without labels.
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    devices
      .filter((d) => d.kind === kind)
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `${fallback} ${i + 1}`,
      }));

  return {
    inputs: pick("audioinput", "microphone"),
    outputs: pick("audiooutput", "speaker"),
  };
}
