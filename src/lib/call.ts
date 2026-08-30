/**
 * Voice calls.
 *
 * Rust handles the Matrix half — publishing our `m.rtc.member` state event and
 * trading an OpenID token for a LiveKit JWT. This module owns the media half:
 * connecting to the SFU, publishing the microphone, and attaching everyone
 * else's audio to the page.
 *
 * WebRTC lives in the WebView deliberately: it already has the platform's echo
 * cancellation, noise suppression and device handling, which we would otherwise
 * have to rebuild in Rust.
 */

import {
  ConnectionState,
  DisconnectReason,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type TrackPublication,
} from "livekit-client";

import type { UwuError } from "./types";

import * as ipc from "./ipc";
import { load as loadSettings } from "./settings";

export interface CallParticipantView {
  identity: string;
  /** The Matrix user ID, which LiveKit carries as the participant identity. */
  userId: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isLocal: boolean;
  audioLevel: number;
  /**
   * Live tracks, handed to the UI to attach to a `<video>`.
   *
   * These are SDK objects rather than plain data on purpose: a video frame
   * can't cross a serialisation boundary, so the tile attaches the track to an
   * element directly. `null` means the camera is off or unsubscribed, which is
   * the cue to fall back to an avatar.
   */
  cameraTrack: Track | null;
  screenTrack: Track | null;
}

export interface CallState {
  roomId: string | null;
  status: "idle" | "connecting" | "connected" | "reconnecting" | "failed";
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  deafened: boolean;
  participants: CallParticipantView[];
  error: string | null;
}

export const IDLE_CALL: CallState = {
  roomId: null,
  status: "idle",
  micEnabled: true,
  cameraEnabled: false,
  screenShareEnabled: false,
  deafened: false,
  participants: [],
  error: null,
};

/**
 * Whether this WebView can capture a screen at all.
 *
 * `getDisplayMedia` is not universally present in WKWebView, and calling it
 * where it's missing throws rather than degrading. Feature-detect so the button
 * can be hidden instead of offering something that can't work.
 */
export function screenShareSupported(): boolean {
  return typeof navigator?.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Why this WebView has no WebRTC, in a sentence that names something real.
 *
 * The causes are indistinguishable from JavaScript — the constructor is simply
 * absent — and one of them is indistinguishable from the native side too:
 * WebKitGTK stores `enable-webrtc` whether or not there is any WebRTC behind
 * it, so a build with WebRTC compiled out looks, from every API we can reach,
 * exactly like one that has it. That is also the usual case, so it is what we
 * say when nothing else explains it.
 */
async function describeMissingWebrtc(): Promise<string> {
  const info = await ipc.webrtcDiagnosis().catch(() => null);
  if (!info) {
    return "this webview has no webrtc stack, so calls can't work here.";
  }
  const missing = [
    info.gstWebrtc ? null : "gst-plugins-bad",
    info.gstNice ? null : "gstreamer's libnice",
  ].filter(Boolean);
  const webkit = info.appimage
    ? `the appimage's webkitgtk ${info.webkitVersion}`
    : `webkitgtk ${info.webkitVersion}`;

  return (
    `voice can't work in this webview: ${webkit} was built without webrtc. ` +
    "webkit leaves it off unless it is built with -DENABLE_WEB_RTC=ON, and no " +
    "distribution turns it on" +
    (missing.length ? `, and ${missing.join(" and ")} would be missing too` : "") +
    "."
  );
}

type Listener = (state: CallState) => void;

/**
 * A single live call. Only one can be active at a time, which matches how
 * people actually use voice chat and keeps device handling simple.
 */
class CallController {
  private room: Room | null = null;
  private state: CallState = { ...IDLE_CALL };
  private listeners = new Set<Listener>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private outputDeviceId = "";
  private refreshTimer: number | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  getState(): CallState {
    return this.state;
  }

  async join(roomId: string, options: { video?: boolean } = {}): Promise<void> {
    // Switching rooms mid-call should leave the old one cleanly first.
    if (this.state.roomId && this.state.roomId !== roomId) {
      await this.leave();
    }
    if (this.state.status === "connecting" || this.state.status === "connected") return;

    this.update({ roomId, status: "connecting", error: null, participants: [] });

    try {
      // Before advertising membership: a WebView with no `RTCPeerConnection`
      // can't hold up its end of the call, and livekit's own message for it
      // ("update your browser", "disable your extensions") describes a browser
      // nobody here is running. Say what's actually wrong instead.
      if (typeof RTCPeerConnection === "undefined") {
        throw { kind: "other", message: await describeMissingWebrtc() } satisfies UwuError;
      }

      const settings = loadSettings();
      const credentials = await ipc.joinCall(roomId, settings.livekitUrl || undefined);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Voice-only: these are the settings that make a call sound like a call
        // rather than a speakerphone in a stairwell.
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(settings.audioInput ? { deviceId: settings.audioInput } : {}),
        },
      });

      this.room = room;
      this.wire(room);

      await room.connect(credentials.livekitUrl, credentials.jwt);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.outputDeviceId = settings.audioOutput;

      this.update({ status: "connected", micEnabled: true });

      // Camera comes up after connecting, not as part of it: a refused camera
      // permission shouldn't take the whole call down with it.
      if (options.video) {
        await this.setCameraEnabled(true).catch(() => {});
      }
      this.syncParticipants();
      this.startMembershipRefresh(roomId);
    } catch (error) {
      const message = ipc.asUwuError(error).message;
      await this.cleanup();
      this.update({ status: "failed", error: message, roomId: null });
      throw error;
    }
  }

  async leave(reason?: string): Promise<void> {
    const roomId = this.state.roomId;
    await this.cleanup();
    this.update({
      ...IDLE_CALL,
      status: reason ? "failed" : "idle",
      error: reason ?? null,
    });

    // Withdraw the Matrix membership even if the SFU disconnect failed, so we
    // don't linger as a ghost participant for everyone else.
    if (roomId) {
      await ipc.leaveCall(roomId).catch(() => {});
    }
  }

  /**
   * Switch the microphone mid-call. LiveKit republishes the track, so the other
   * side hears the new device without the call dropping.
   */
  async setAudioInput(deviceId: string): Promise<void> {
    if (!this.room) return;
    await this.room.switchActiveDevice("audioinput", deviceId || "default");
  }

  /**
   * Route playback to a specific speaker.
   *
   * `setSinkId` is per-element, so this has to reach every audio element we've
   * attached — and any attached later, hence remembering the choice.
   */
  async setAudioOutput(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    await Promise.all(
      [...this.audioElements.values()].map((el) => applySink(el, deviceId)),
    );
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    const { videoInput } = loadSettings();
    await this.room.localParticipant.setCameraEnabled(
      enabled,
      enabled && videoInput ? { deviceId: { exact: videoInput } } : undefined,
    );
    this.update({ cameraEnabled: enabled });
    this.syncParticipants();
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    if (enabled && !screenShareSupported()) {
      throw new Error("this webview can't capture the screen");
    }
    // The picker is a user gesture the person can cancel; that throws, and a
    // cancelled share is not an error worth surfacing.
    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled, {
        audio: true,
      });
      this.update({ screenShareEnabled: enabled });
    } catch (error) {
      this.update({ screenShareEnabled: false });
      if (enabled && !isUserCancellation(error)) throw error;
    }
    this.syncParticipants();
  }

  async setVideoInput(deviceId: string): Promise<void> {
    if (!this.room) return;
    await this.room.switchActiveDevice("videoinput", deviceId || "default");
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
    this.update({ micEnabled: enabled });
    this.syncParticipants();
  }

  /** Deafen mutes everyone else's audio *and* our own mic, as Discord does. */
  async setDeafened(deafened: boolean): Promise<void> {
    for (const el of this.audioElements.values()) el.muted = deafened;
    this.update({ deafened });
    if (deafened) {
      await this.setMicEnabled(false);
    }
  }

  private wire(room: Room) {
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) {
          // Video is attached by the tile that renders it, not here.
          this.syncParticipants();
          return;
        }
        const element = track.attach() as HTMLAudioElement;
        element.autoplay = true;
        element.muted = this.state.deafened;
        // Off-screen: we only need the element for playback, not for layout.
        element.style.display = "none";
        document.body.appendChild(element);
        void applySink(element, this.outputDeviceId);
        this.audioElements.set(track.sid ?? String(this.audioElements.size), element);
        this.syncParticipants();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        if (track.sid) this.audioElements.delete(track.sid);
        this.syncParticipants();
      })
      .on(RoomEvent.LocalTrackPublished, () => this.syncParticipants())
      .on(RoomEvent.LocalTrackUnpublished, () => this.syncParticipants())
      .on(RoomEvent.TrackPublished, () => this.syncParticipants())
      .on(RoomEvent.TrackUnpublished, () => this.syncParticipants())
      .on(RoomEvent.ParticipantConnected, () => this.syncParticipants())
      .on(RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
      .on(RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
      .on(RoomEvent.TrackMuted, () => this.syncParticipants())
      .on(RoomEvent.TrackUnmuted, () => this.syncParticipants())
      .on(RoomEvent.ConnectionStateChanged, (connectionState: ConnectionState) => {
        if (connectionState === ConnectionState.Reconnecting) {
          this.update({ status: "reconnecting" });
        } else if (connectionState === ConnectionState.Connected) {
          this.update({ status: "connected" });
        }
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        // Dropping straight after connecting almost always means the media
        // path never came up, which looks identical to "it just didn't work"
        // unless we say so.
        void this.leave(describeDisconnect(reason));
      });
  }

  private syncParticipants() {
    const room = this.room;
    if (!room) return;

    const view = (
      participant: RemoteParticipant | Room["localParticipant"],
      isLocal: boolean,
    ): CallParticipantView => {
      const audio = participant.getTrackPublication(Track.Source.Microphone);

      return {
        identity: participant.identity,
        // LiveKit identities are `@user:server:DEVICEID` in MatrixRTC; the
        // Matrix user ID is everything before the device suffix.
        userId: matrixUserFromIdentity(participant.identity),
        isSpeaking: participant.isSpeaking,
        isMuted: isLocal ? !this.state.micEnabled : (audio?.isMuted ?? true),
        isLocal,
        audioLevel: participant.audioLevel ?? 0,
        cameraTrack: liveVideo(participant.getTrackPublication(Track.Source.Camera)),
        screenTrack: liveVideo(
          participant.getTrackPublication(Track.Source.ScreenShare),
        ),
      };
    };

    this.update({
      participants: [
        view(room.localParticipant, true),
        ...[...room.remoteParticipants.values()].map((p) => view(p, false)),
      ],
    });
  }

  /**
   * MatrixRTC memberships expire. Re-publish periodically so a long call
   * doesn't quietly drop out of the participant list on other clients.
   */
  private startMembershipRefresh(roomId: string) {
    this.stopMembershipRefresh();
    this.refreshTimer = window.setInterval(
      () => {
        void ipc.refreshCallMembership(roomId).catch(() => {});
      },
      25 * 60 * 1000,
    );
  }

  private stopMembershipRefresh() {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async cleanup() {
    this.stopMembershipRefresh();

    for (const el of this.audioElements.values()) el.remove();
    this.audioElements.clear();

    if (this.room) {
      this.room.removeAllListeners();
      await this.room.disconnect().catch(() => {});
      this.room = null;
    }
  }
}

/**
 * Point one audio element at a specific output device.
 *
 * `setSinkId` is still not universally available, and fails outright on some
 * device IDs; playback on the default device is a far better outcome than a
 * thrown error mid-call, so failures are swallowed deliberately.
 */
async function applySink(element: HTMLAudioElement, deviceId: string): Promise<void> {
  if (!deviceId) return;
  const withSink = element as HTMLAudioElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (typeof withSink.setSinkId !== "function") return;
  try {
    await withSink.setSinkId(deviceId);
  } catch {
    // Keep playing on the default device.
  }
}

/**
 * Turn LiveKit's disconnect reason into something that points at a cause.
 *
 * The common failure with a self-hosted SFU is that signalling succeeds over
 * 443 while the media ports never made it through the firewall — so say that
 * rather than "disconnected".
 */
function describeDisconnect(reason?: DisconnectReason): string | undefined {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return undefined;
    case DisconnectReason.ROOM_DELETED:
      return "the call ended";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "you were removed from the call";
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "this device joined the call somewhere else";
    case DisconnectReason.SERVER_SHUTDOWN:
      return "the voice server shut down";
    case DisconnectReason.JOIN_FAILURE:
      return "couldn't join the call";
    default:
      return (
        "lost the voice connection — the server was reachable but media wasn't. " +
        "check that the sfu's udp and tcp media ports are open."
      );
  }
}

/**
 * The playable video track behind a publication, if there is one.
 *
 * A remote publication only carries a track once subscribed, and a muted camera
 * keeps its publication but stops producing frames — both cases should show an
 * avatar rather than a frozen or black tile.
 */
function liveVideo(publication: TrackPublication | undefined): Track | null {
  if (!publication || publication.isMuted) return null;
  const track = publication.track;
  return track && track.kind === Track.Kind.Video ? track : null;
}

/** Cancelling the screen picker rejects; that's a choice, not a failure. */
function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

export function matrixUserFromIdentity(identity: string): string {
  // `@kii:uwu.gg:ABCDEF` → `@kii:uwu.gg`
  const parts = identity.split(":");
  return parts.length > 2 ? parts.slice(0, -1).join(":") : identity;
}

export const call = new CallController();
