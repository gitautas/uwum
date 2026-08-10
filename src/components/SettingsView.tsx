import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { open } from "@tauri-apps/plugin-dialog";

import { call } from "../lib/call";
import * as ipc from "../lib/ipc";
import { mediaUrl } from "../lib/ipc";
import { invalidateProfile } from "../lib/profiles";
import {
  ACCENT_SWATCHES,
  listMediaDevices,
  type Accent,
  type AudioDevice,
} from "../lib/settings";
import type { DeviceInfo, Profile, RecoveryStatus } from "../lib/types";
import { useStore } from "../store";
import { PacksSection } from "./PackSettings";
import { Card, Field, Heading, inputStyle, Row } from "./settingsUi";
import { Avatar, Button, Icon, RaveLabel, Spinner, Toggle } from "./ui";

type Section = "account" | "security" | "voice" | "packs" | "appearance" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "account", label: "account", icon: "user-circle" },
  { id: "security", label: "security", icon: "shield-check" },
  { id: "voice", label: "voice & video", icon: "microphone" },
  { id: "packs", label: "emotes & stickers", icon: "sticker" },
  { id: "appearance", label: "appearance", icon: "palette" },
  { id: "about", label: "about", icon: "info" },
];

/**
 * The full-window settings surface, in the shape people already know from
 * Discord: a nav rail of sections on the left, one pane of content on the
 * right, and Escape to get out.
 */
export function SettingsView() {
  const { open, close, session } = useStore(
    useShallow((s) => ({
      open: s.showSettings,
      close: s.closeSettings,
      session: s.session,
    })),
  );

  const [section, setSection] = useState<Section>("account");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !session) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "flex",
        background: "var(--surface-app)",
      }}
    >
      <div
        className="uwu-drag"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 34 }}
      />

      {/* nav */}
      <div
        className="uwu-scroll"
        style={{
          width: 232,
          flex: "none",
          padding: "52px 12px 20px",
          background: "var(--ink-900)",
          borderRight: "1px solid var(--border-subtle)",
        }}
      >
        <RaveLabel style={{ padding: "0 10px 10px" }}>settings</RaveLabel>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setSection(entry.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "9px 12px",
              marginBottom: 3,
              borderRadius: 12,
              cursor: "pointer",
              textAlign: "left",
              background: section === entry.id ? "rgba(255,255,255,.07)" : "transparent",
              color:
                section === entry.id ? "var(--text-primary)" : "var(--text-secondary)",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <Icon
              name={entry.icon}
              size={16}
              color={
                section === entry.id ? "var(--accent-primary)" : "var(--text-tertiary)"
              }
            />
            {entry.label}
          </button>
        ))}
      </div>

      {/* content */}
      <div className="uwu-scroll" style={{ flex: 1, padding: "52px 0 40px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "0 40px" }}>
          {section === "account" && <AccountSection />}
          {section === "security" && <SecuritySection />}
          {section === "voice" && <VoiceSection />}
          {section === "packs" && <PacksSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>

      <button
        onClick={close}
        title="close settings (esc)"
        style={{
          position: "absolute",
          top: 46,
          right: 34,
          width: 38,
          height: 38,
          borderRadius: 999,
          border: "2px solid var(--border-default)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Icon name="x" size={16} color="var(--text-secondary)" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// layout helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

function AccountSection() {
  const { session, showBanner } = useStore(
    useShallow((s) => ({ session: s.session!, showBanner: s.showBanner })),
  );
  const [confirmingWipe, setConfirmingWipe] = useState(false);

  async function signOut(wipe: boolean) {
    try {
      await ipc.logout(wipe);
      // A sign-out invalidates everything the UI is holding, so start clean.
      window.location.reload();
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  return (
    <>
      <Heading>account</Heading>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Avatar
            id={session.userId}
            name={session.displayName ?? session.userId}
            mxc={session.avatarUrl}
            size={64}
            radius={22}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}
            >
              {session.displayName ?? session.userId}
            </div>
            <div
              className="selectable"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-tertiary)",
              }}
            >
              {session.userId}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <Row title="homeserver" subtitle={session.homeserver} />
        <Row title="this device" subtitle={session.deviceId} />
      </Card>

      <Heading>profile</Heading>
      <ProfileEditor />

      {session.insecureStorage && (
        <Card tone="warning">
          <div style={{ display: "flex", gap: 12 }}>
            <Icon name="warning" size={20} color="var(--status-warning)" />
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              no system keychain was available, so your access token and encryption
              keys are in a file readable only by your user account. anyone who can
              read your home directory can read them.
            </div>
          </div>
        </Card>
      )}

      <Heading>sign out</Heading>
      <Card>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          signing out keeps your local encryption keys, so you can sign back in and
          still read your history.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => void signOut(false)}>
            sign out
          </Button>
          <Button
            variant={confirmingWipe ? "danger" : "ghost"}
            onClick={() => {
              if (confirmingWipe) void signOut(true);
              else setConfirmingWipe(true);
            }}
          >
            {confirmingWipe ? "yes — erase everything" : "sign out and erase keys"}
          </Button>
        </div>
        {confirmingWipe && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12.5,
              color: "var(--status-danger)",
              lineHeight: 1.55,
            }}
          >
            this deletes the encrypted store on this machine. any messages whose keys
            aren't in your key backup become permanently unreadable — including for
            you.
          </div>
        )}
      </Card>
    </>
  );
}

/**
 * Bio, status and cover photo — MSC4133 extended profile fields.
 *
 * Bio and status use Commet's keys so the two clients show the same thing;
 * `set_profile` handles the shape difference. Everything here is public and
 * federated, which the UI says rather than assuming people know.
 */
function ProfileEditor() {
  const showBanner = useStore((s) => s.showBanner);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipc
      .getProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setBio(p.bio ?? "");
        setStatus(p.status ?? "");
        setCoverUrl(p.coverUrl ?? "");
      })
      .catch((e) => {
        if (!cancelled) showBanner("error", ipc.asUwuError(e).message);
      });
    return () => {
      cancelled = true;
    };
  }, [showBanner]);

  const dirty =
    profile !== null &&
    (bio !== (profile.bio ?? "") ||
      status !== (profile.status ?? "") ||
      coverUrl !== (profile.coverUrl ?? ""));

  async function pickCover() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "image", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (typeof selected !== "string") return;
      setBusy(true);
      setCoverUrl(await ipc.uploadMedia(selected));
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      // Only send what changed; a field left alone stays alone server-side.
      await ipc.setProfile({
        ...(bio !== (profile?.bio ?? "") ? { bio } : {}),
        ...(status !== (profile?.status ?? "") ? { status } : {}),
        ...(coverUrl !== (profile?.coverUrl ?? "") ? { coverUrl } : {}),
      });
      const updated = await ipc.getProfile();
      setProfile(updated);
      // Your card and the top of your DMs read from the cache; without this
      // they'd keep showing the old bio for the rest of the session.
      invalidateProfile(updated.userId);
      setSaved(true);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <Card>
        <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
          <Spinner />
        </div>
      </Card>
    );
  }

  const coverPreview = mediaUrl(coverUrl, { width: 560, height: 140 });

  return (
    <Card>
      <Field label="cover photo" hint="shown behind your avatar on your profile card.">
        <div
          style={{
            height: 96,
            borderRadius: 16,
            marginBottom: 10,
            border: "1px solid var(--border-subtle)",
            background: coverPreview
              ? `center/cover no-repeat url("${coverPreview}")`
              : "var(--surface-inset)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
            fontSize: 12.5,
          }}
        >
          {!coverPreview && "no cover yet"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void pickCover()}>
            choose an image
          </Button>
          {coverUrl && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCoverUrl("")}>
              remove
            </Button>
          )}
        </div>
      </Field>

      <Field label="status" hint="a short line — what you're up to.">
        <input
          className="selectable"
          value={status}
          maxLength={120}
          onChange={(e) => setStatus(e.target.value)}
          placeholder="vibing~"
          style={inputStyle}
        />
      </Field>

      <Field label="bio">
        <textarea
          className="selectable"
          value={bio}
          rows={4}
          maxLength={1000}
          onChange={(e) => setBio(e.target.value)}
          placeholder="say something about yourself~"
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.55 }}
        />
      </Field>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 4,
        }}
      >
        <Button disabled={!dirty || busy} onClick={() => void save()}>
          save
        </Button>
        {busy && <Spinner size={14} />}
        {saved && !dirty && (
          <span style={{ fontSize: 12.5, color: "var(--accent-primary)" }}>saved~</span>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            textAlign: "right",
            lineHeight: 1.45,
          }}
        >
          public and federated — anyone
          <br />
          who can see you can read this
        </span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// security
// ---------------------------------------------------------------------------

function SecuritySection() {
  const showBanner = useStore((s) => s.showBanner);

  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState("");
  const [busy, setBusy] = useState(false);

  function refresh() {
    ipc.getOwnDevices().then(setDevices).catch(() => setDevices([]));
    ipc.getRecoveryStatus().then(setRecovery).catch(() => setRecovery(null));
  }

  useEffect(refresh, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showBanner("error", `${label}: ${ipc.asUwuError(e).message}`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <>
      <Heading>your devices</Heading>
      <Card>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            marginBottom: 6,
          }}
        >
          verifying a device proves it's really yours and lets your encrypted history
          reach it. unverified devices show a warning beside their messages.
        </div>

        {!devices && (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
            <Spinner />
          </div>
        )}

        {devices?.map((device) => (
          <Row
            key={device.deviceId}
            icon={device.isCurrent ? "desktop" : "devices"}
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {device.displayName ?? device.deviceId}
                {device.isCurrent && (
                  <span
                    style={{
                      fontFamily: "var(--font-rave)",
                      fontSize: 8.5,
                      fontWeight: 800,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--accent-quaternary)",
                    }}
                  >
                    this one
                  </span>
                )}
              </span>
            }
            subtitle={device.deviceId}
          >
            {device.isVerified ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--accent-primary)",
                  fontSize: 12.5,
                }}
              >
                <Icon name="seal-check" size={15} color="var(--accent-primary)" />
                verified
              </span>
            ) : device.isCurrent ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run("verification", () => ipc.requestVerification())
                }
              >
                verify from another device
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run("verification", () => ipc.verifyDevice(device.deviceId))
                }
              >
                verify
              </Button>
            )}
          </Row>
        ))}
      </Card>

      <Heading>key backup</Heading>
      <Card>
        {recovery ? (
          <>
            <Row
              icon={recovery.state === "enabled" ? "key" : "key-return"}
              title={
                recovery.state === "enabled"
                  ? "recovery is on"
                  : recovery.state === "incomplete"
                    ? "recovery is half set up"
                    : "recovery is off"
              }
              subtitle={
                recovery.crossSigningReady
                  ? "cross-signing ready"
                  : "cross-signing not set up"
              }
            />
            {recovery.state === "incomplete" ? (
              <div
                style={{
                  margin: "14px 0",
                  padding: 14,
                  borderRadius: 16,
                  background: "rgba(255,194,77,.08)",
                  border: "1px solid rgba(255,194,77,.35)",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                <strong style={{ color: "var(--status-warning)" }}>
                  this is why your old messages are unreadable.
                </strong>{" "}
                you have a key backup on the server, but this device doesn't have the
                key to open it. paste your recovery key below and your history will
                decrypt.
              </div>
            ) : (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  margin: "14px 0",
                }}
              >
                key backup stores your message keys on the server, encrypted with a
                recovery key only you hold. without it, losing this device means
                losing your encrypted history.
              </div>
            )}

            {recoveryKey ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: 16,
                  background: "var(--ink-950)",
                  border: "1px solid var(--accent-primary)",
                }}
              >
                <RaveLabel style={{ marginBottom: 8 }}>
                  write this down — you'll only see it once
                </RaveLabel>
                <div
                  className="selectable"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    color: "var(--accent-primary)",
                    wordBreak: "break-all",
                    lineHeight: 1.6,
                  }}
                >
                  {recoveryKey}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  style={{ marginTop: 12 }}
                  onClick={() => setRecoveryKey(null)}
                >
                  i've saved it
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {recovery.state !== "enabled" && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run("key backup", async () => {
                        setRecoveryKey(await ipc.enableRecovery());
                      })
                    }
                  >
                    turn on key backup
                  </Button>
                )}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <Field
                label="restore from a recovery key"
                hint="paste the key you saved when you turned on backup."
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="selectable"
                    value={restoreKey}
                    onChange={(e) => setRestoreKey(e.target.value)}
                    placeholder="EsT... "
                    spellCheck={false}
                    style={inputStyle}
                  />
                  <Button
                    disabled={busy || !restoreKey.trim()}
                    onClick={() =>
                      void run("restore", async () => {
                        await ipc.recoverWithKey(restoreKey.trim());
                        setRestoreKey("");
                      })
                    }
                  >
                    restore
                  </Button>
                </div>
              </Field>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
            <Spinner />
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// voice
// ---------------------------------------------------------------------------

function VoiceSection() {
  const { settings, updateSettings } = useStore(
    useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings })),
  );

  const [devices, setDevices] = useState<{
    inputs: AudioDevice[];
    outputs: AudioDevice[];
    cameras: AudioDevice[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMediaDevices()
      .then((found) => {
        if (!cancelled) setDevices(found);
      })
      .catch(() => {
        if (!cancelled) setDevices({ inputs: [], outputs: [], cameras: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Heading>voice & video</Heading>

      <Card>
        {!devices ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
            <Spinner />
          </div>
        ) : (
          <>
            <Field
              label="input device"
              hint="the microphone other people hear. changing this mid-call switches it live."
            >
              <select
                value={settings.audioInput}
                onChange={(e) => {
                  updateSettings({ audioInput: e.target.value });
                  void call.setAudioInput(e.target.value);
                }}
                style={inputStyle}
              >
                <option value="">system default</option>
                {devices.inputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="output device" hint="where you hear everyone else.">
              <select
                value={settings.audioOutput}
                onChange={(e) => {
                  updateSettings({ audioOutput: e.target.value });
                  void call.setAudioOutput(e.target.value);
                }}
                style={inputStyle}
              >
                <option value="">system default</option>
                {devices.outputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="camera"
              hint="used when you turn video on in a call. changing this mid-call switches it live."
            >
              <select
                value={settings.videoInput}
                onChange={(e) => {
                  updateSettings({ videoInput: e.target.value });
                  void call.setVideoInput(e.target.value);
                }}
                style={inputStyle}
              >
                <option value="">system default</option>
                {devices.cameras.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </Field>

            {(devices.inputs.length === 0 || devices.cameras.length === 0) && (
              <div style={{ fontSize: 12.5, color: "var(--status-warning)" }}>
                no {devices.inputs.length === 0 ? "microphones" : "cameras"} found —
                check that uwum has permission in system settings.
              </div>
            )}
          </>
        )}
      </Card>

      <Heading>call server</Heading>
      <Card>
        <Field
          label="livekit sfu"
          hint="leave blank to use whatever your homeserver advertises in .well-known, or whichever server the people already in a call are using."
        >
          <input
            className="selectable"
            value={settings.livekitUrl}
            onChange={(e) => updateSettings({ livekitUrl: e.target.value })}
            placeholder="https://livekit.example.org"
            spellCheck={false}
            style={inputStyle}
          />
        </Field>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// appearance
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const { settings, updateSettings } = useStore(
    useShallow((s) => ({
      settings: s.settings,
      updateSettings: s.updateSettings,
    })),
  );

  return (
    <>
      <Heading>appearance</Heading>

      <Card>
        <Field label="accent" hint="the colour of buttons, badges and highlights.">
          <div style={{ display: "flex", gap: 12 }}>
            {ACCENT_SWATCHES.map(({ name, colour }) => (
              <button
                key={name}
                onClick={() => updateSettings({ accent: name as Accent })}
                title={name}
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 18,
                  background: colour,
                  cursor: "pointer",
                  border:
                    settings.accent === name
                      ? "3px solid var(--text-primary)"
                      : "2px solid var(--ink-950)",
                  boxShadow:
                    settings.accent === name ? "var(--shadow-sticker-ink)" : "none",
                  transform: settings.accent === name ? "rotate(-3deg)" : "none",
                  transition: "all var(--dur-fast) var(--ease-bounce)",
                }}
              />
            ))}
          </div>
        </Field>
      </Card>

      <Heading>composer</Heading>
      <Card>
        <Row
          icon="keyboard"
          title="send with enter"
          subtitle="off: enter makes a new line, cmd+enter sends"
        >
          <Toggle
            on={settings.sendOnEnter}
            onToggle={(next) => updateSettings({ sendOnEnter: next })}
          />
        </Row>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// about
// ---------------------------------------------------------------------------

function AboutSection() {
  return (
    <>
      <Heading>about</Heading>
      <Card>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 34,
            color: "var(--accent-secondary)",
            letterSpacing: "-0.03em",
          }}
        >
          uwum
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 6 }}>
          a cute matrix client~
        </div>
        <div
          style={{
            marginTop: 16,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            lineHeight: 1.9,
          }}
        >
          <div>version 0.1.0</div>
          <div>matrix-rust-sdk 0.18 · e2ee via megolm</div>
          <div>voice over matrixrtc + livekit</div>
        </div>
      </Card>
    </>
  );
}
