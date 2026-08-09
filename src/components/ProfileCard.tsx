import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { localpart } from "../lib/display";
import * as ipc from "../lib/ipc";
import { mediaUrl } from "../lib/ipc";
import type { Profile } from "../lib/types";
import { useStore } from "../store";
import { Avatar, Icon, Spinner } from "./ui";

/**
 * The popout from the avatar in the rail — cover, name, status, bio.
 *
 * Discord-shaped but deliberately shorter: this is for *reading* a profile.
 * Editing lives in settings, and there's one button here to get there.
 */
export function ProfileCard({
  userId,
  anchor,
  onClose,
}: {
  userId: string;
  /** Where to hang the card — the bounding box of whatever opened it. */
  anchor: DOMRect;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const openSettings = useStore((s) => s.openSettings);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .getProfile(userId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Click-away and Escape, the two ways out of any popover.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!card.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Deferred: the click that opened this would otherwise close it again.
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const name = profile?.displayName ?? localpart(userId);
  const cover = mediaUrl(profile?.coverUrl, { width: 300, height: 100 });

  return createPortal(
    <div
      ref={card}
      style={{
        position: "fixed",
        left: anchor.right + 12,
        // Sits above the rail avatar rather than below it — there's no room
        // below, the avatar is already at the bottom of the window.
        bottom: Math.max(12, window.innerHeight - anchor.bottom),
        zIndex: 130,
        width: 300,
        borderRadius: 20,
        overflow: "hidden",
        background: "var(--surface-card-raised)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-pop)",
      }}
    >
      <div
        style={{
          height: 76,
          background: cover
            ? `center/cover no-repeat url("${cover}")`
            : "var(--accent-tertiary)",
        }}
      />

      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ marginTop: -26, marginBottom: 10 }}>
          <Avatar
            id={userId}
            name={name}
            mxc={profile?.avatarUrl}
            size={58}
            radius={20}
            style={{ border: "3px solid var(--surface-card-raised)" }}
          />
        </div>

        <div
          style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18 }}
        >
          {name}
        </div>
        <div
          className="selectable"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-tertiary)",
          }}
        >
          {userId}
        </div>

        {!profile && (
          <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
            <Spinner size={14} />
          </div>
        )}

        {profile?.status && (
          <div
            className="selectable"
            style={{
              marginTop: 10,
              padding: "7px 11px",
              borderRadius: 12,
              background: "var(--surface-inset)",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            {profile.status}
          </div>
        )}

        {profile?.bio && (
          <div
            className="selectable"
            style={{
              marginTop: 10,
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {profile.bio}
          </div>
        )}

        <button
          onClick={() => {
            onClose();
            openSettings();
          }}
          style={{
            marginTop: 14,
            width: "100%",
            padding: "8px 0",
            borderRadius: 999,
            background: "var(--surface-card)",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
          }}
        >
          <Icon name="pencil-simple" size={13} color="var(--text-secondary)" />
          edit profile
        </button>
      </div>
    </div>,
    document.body,
  );
}
