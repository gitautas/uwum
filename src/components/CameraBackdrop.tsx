/**
 * The chosen camera, live, filling the video settings card — so you can tell
 * it works (and that it's the camera you meant) before turning video on in a
 * call.
 *
 * Deliberately quiet: faded and desaturated, because a full-strength picture
 * of your own face is loud, and sinking into the card along the bottom where
 * the camera picker sits over it.
 */

import { useEffect, useRef, useState } from "react";

export function CameraBackdrop({ deviceId }: { deviceId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setLive(false);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          // A preferred device, not an exact one: if it's been unplugged, show
          // whatever the system would fall back to rather than nothing.
          ...(deviceId ? { deviceId } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      .then((opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        if (video.current) video.current.srcObject = opened;
        setLive(true);
      })
      // No camera, or no permission: the pane just has no backdrop. The device
      // picker already says when nothing was found.
      .catch(() => {});

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [deviceId]);

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        opacity: live ? 1 : 0,
        transition: "opacity var(--dur-slow) var(--ease-out)",
      }}
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // Mirrored, like every self-view: unmirrored reads as "wrong" to
          // people looking at themselves.
          transform: "scaleX(-1)",
          opacity: 0.3,
          filter: "saturate(0.35)",
        }}
      />
      {/* Fade into the card behind the label and hint, which would otherwise be
          grey text on whatever you happen to be wearing. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, transparent 25%, var(--surface-card) 92%)",
        }}
      />
    </div>
  );
}
