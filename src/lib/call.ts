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
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";

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
}

export interface CallState {
  roomId: string | null;
  status: "idle" | "connecting" | "connected" | "reconnecting" | "failed";
  micEnabled: boolean;
  deafened: boolean;
  participants: CallParticipantView[];
  error: string | null;
}

export const IDLE_CALL: CallState = {
  roomId: null,
  status: "idle",
  micEnabled: true,
  deafened: false,
  participants: [],
  error: null,
};

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

  async join(roomId: string): Promise<void> {
    // Switching rooms mid-call should leave the old one cleanly first.
    if (this.state.roomId && this.state.roomId !== roomId) {
      await this.leave();
    }
    if (this.state.status === "connecting" || this.state.status === "connected") return;

    this.update({ roomId, status: "connecting", error: null, participants: [] });

    try {
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
        if (track.kind !== Track.Kind.Audio) return;
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
      const publications = [...participant.trackPublications.values()];
      const audio = publications.find(
        (p) => p.kind === Track.Kind.Audio,
      ) as RemoteTrackPublication | undefined;

      return {
        identity: participant.identity,
        // LiveKit identities are `@user:server:DEVICEID` in MatrixRTC; the
        // Matrix user ID is everything before the device suffix.
        userId: matrixUserFromIdentity(participant.identity),
        isSpeaking: participant.isSpeaking,
        isMuted: isLocal ? !this.state.micEnabled : (audio?.isMuted ?? true),
        isLocal,
        audioLevel: participant.audioLevel ?? 0,
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

export function matrixUserFromIdentity(identity: string): string {
  // `@kii:uwu.gg:ABCDEF` → `@kii:uwu.gg`
  const parts = identity.split(":");
  return parts.length > 2 ? parts.slice(0, -1).join(":") : identity;
}

export const call = new CallController();
