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

/** The design's four neon accents: [base, hover, pressed]. */
const ACCENTS: Record<Accent, [string, string, string]> = {
  acid: ["#C8FF4D", "#D9FF7A", "#A6E020"],
  pink: ["#FF6187", "#FF85A2", "#E8456C"],
  violet: ["#B14EFF", "#C97DFF", "#8F2FE0"],
  cyan: ["#4DE8FF", "#7EEFFF", "#22C4DE"],
};

export const ACCENT_SWATCHES = Object.entries(ACCENTS).map(([name, [base]]) => ({
  name: name as Accent,
  colour: base,
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
  root.style.setProperty("--accent-primary", base);
  root.style.setProperty("--accent-primary-hover", hover);
  root.style.setProperty("--accent-primary-press", press);
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
