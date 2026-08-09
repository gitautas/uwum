import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import * as ipc from "./lib/ipc";
import { applyAccent, load as loadSettings } from "./lib/settings";
import { selectActiveRoom, useStore } from "./store";
import { ChatPane, EmptyPane } from "./components/ChatPane";
import { CreateRoom } from "./components/CreateRoom";
import { DropZone } from "./components/DropZone";
import { Lightbox } from "./components/Lightbox";
import { LoginScreen } from "./components/LoginScreen";
import { ProfileCard } from "./components/ProfileCard";
import { RoomInfo } from "./components/RoomInfo";
import { RoomList } from "./components/RoomList";
import { SettingsView } from "./components/SettingsView";
import { SpacesRail } from "./components/SpacesRail";
import { VerificationModal } from "./components/VerificationModal";
import { BackdropPattern, Icon, Spinner } from "./components/ui";

export default function App() {
  const { session, bootstrapped, setSession, setBootstrapped, showBanner } = useStore(
    useShallow((s) => ({
      session: s.session,
      bootstrapped: s.bootstrapped,
      setSession: s.setSession,
      setBootstrapped: s.setBootstrapped,
      showBanner: s.showBanner,
    })),
  );

  // Paint the saved accent before anything renders, so the app never flashes
  // the default colour on the way to the chosen one.
  useEffect(() => {
    applyAccent(loadSettings().accent);
  }, []);

  // Try to pick up where we left off before showing anything, so a returning
  // user never sees the login screen flash past.
  useEffect(() => {
    let cancelled = false;

    ipc
      .restoreSession()
      .then((restored) => {
        if (cancelled) return;
        if (restored) setSession(restored);
      })
      .catch((e) => {
        if (!cancelled) showBanner("error", ipc.asUwuError(e).message);
      })
      .finally(() => {
        if (!cancelled) setBootstrapped(true);
      });

    return () => {
      cancelled = true;
    };
  }, [setSession, setBootstrapped, showBanner]);

  if (!bootstrapped) return <Booting />;
  if (!session) return <LoginScreen />;
  return <Shell />;
}

function Booting() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "var(--surface-app)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <BackdropPattern />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 44,
          letterSpacing: "-0.03em",
          color: "var(--accent-secondary)",
        }}
        className="uwu-wobble"
      >
        uwum
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <Spinner size={20} />
      </div>
    </div>
  );
}

function Shell() {
  const { activeRoomId, showInfo, banner, dismissBanner } = useStore(
    useShallow((s) => ({
      activeRoomId: s.activeRoomId,
      showInfo: s.showInfo,
      banner: s.banner,
      dismissBanner: s.dismissBanner,
    })),
  );
  const activeRoom = useStore(selectActiveRoom);

  useBackendEvents();
  useAppShortcuts();

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        minHeight: 620,
        background: "var(--surface-app)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-body)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <BackdropPattern />

      <SpacesRail />
      <RoomList />

      {activeRoom ? <ChatPane room={activeRoom} /> : <EmptyPane />}

      {showInfo && activeRoom && <RoomInfo room={activeRoom} />}

      <SettingsView />
      <ProfileCard />
      <DropZone />
      <Lightbox />
      <CreateRoom />
      <VerificationModal />
      <SyncIndicator />

      {banner && (
        <div
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 18px",
            borderRadius: 18,
            maxWidth: 520,
            background: "var(--surface-card-raised)",
            border: `1px solid ${
              banner.tone === "error" ? "rgba(255,84,112,.4)" : "var(--border-default)"
            }`,
            boxShadow: "var(--shadow-pop)",
          }}
        >
          <Icon
            name={banner.tone === "error" ? "warning-circle" : "info"}
            size={16}
            color={banner.tone === "error" ? "var(--status-danger)" : "var(--accent-quaternary)"}
          />
          <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            {banner.message}
          </span>
          <button onClick={dismissBanner} style={{ cursor: "pointer", display: "flex" }}>
            <Icon name="x" size={13} color="var(--text-tertiary)" />
          </button>
        </div>
      )}

      {/* Fills the space left of the traffic lights so the window is draggable. */}
      {activeRoomId === null && (
        <div
          className="uwu-drag"
          style={{ position: "absolute", top: 0, left: 76, right: 0, height: 28 }}
        />
      )}
    </div>
  );
}

/** A quiet dot in the corner, loud only when something is actually wrong. */
function SyncIndicator() {
  const status = useStore((s) => s.syncStatus);
  const insecure = useStore((s) => s.session?.insecureStorage ?? false);

  const problem = status.state === "offline" || status.state === "error";
  if (!problem && !insecure) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 14,
        zIndex: 150,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        background: "var(--surface-card-raised)",
        border: "1px solid rgba(255,194,77,.4)",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        color: "var(--status-warning)",
      }}
      title={
        insecure
          ? "no system keychain was available, so your session is stored in a file readable only by your user account"
          : (status.message ?? "")
      }
    >
      <Icon
        name={problem ? "wifi-slash" : "shield-warning"}
        size={12}
        color="var(--status-warning)"
      />
      {problem ? (status.message ?? status.state) : "session stored without a keychain"}
    </div>
  );
}

/**
 * Shortcuts that belong to the app rather than to any one view.
 *
 * `cmd+,` on macOS arrives as a *menu event* rather than a keypress: the menu
 * bar is offered command-key combinations first, and anything no menu item
 * claims is swallowed before the web content ever sees it. So the mac half of
 * this lives in `install_settings_menu_item` on the Rust side and comes back as
 * an event. The listener below is for Windows and Linux, where `ctrl+,` reaches
 * the page normally.
 *
 * Settings closes on Escape already, so this only has to open.
 */
function useAppShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().openSettings();
      }
    };

    window.addEventListener("keydown", onKey);
    const menu = ipc.onOpenSettings(() => useStore.getState().openSettings());

    return () => {
      window.removeEventListener("keydown", onKey);
      void menu.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
}

/** Subscribe to everything Rust pushes, for as long as the shell is mounted. */
function useBackendEvents() {
  useEffect(() => {
    const store = useStore.getState();

    const subscriptions = [
      ipc.onRooms((diffs) => useStore.getState().applyRoomDiffs(diffs)),
      ipc.onTimeline((update) => useStore.getState().applyTimelineUpdate(update)),
      ipc.onTyping((update) => useStore.getState().applyTyping(update)),
      ipc.onSyncStatus((status) => useStore.getState().setSyncStatus(status)),
      ipc.onVerificationRequest((request) =>
        useStore.getState().setVerificationRequest(request),
      ),
      ipc.onVerificationUpdate((update) =>
        useStore.getState().applyVerificationUpdate(update),
      ),
    ];

    // Sync is already running by the time this mounts, so the backend's first
    // room-list push has come and gone. Take a snapshot to catch up — but only
    // once the listeners are actually attached.
    //
    // `listen` is asynchronous: it registers the handler over IPC and resolves
    // afterwards. Firing the snapshot alongside it leaves a window where a diff
    // is emitted and nobody is listening, and a *dropped* diff is worse than a
    // late one — every index in every diff after it refers to a list one entry
    // longer or shorter than ours, so rooms start landing in the wrong place.
    // (`applyDiff` clamps rather than corrupting, and a later `reset` puts it
    // right, but the drift is real until then.)
    void Promise.all(subscriptions)
      .then(() => ipc.getRooms())
      .then(store.setRooms)
      .catch((e) => store.showBanner("error", ipc.asUwuError(e).message));

    // Spaces don't stream — they change rarely enough that a fetch on mount and
    // a slow poll is plenty.
    const loadSpaces = () => {
      ipc
        .getSpaces()
        .then(store.setSpaces)
        .catch(() => {});
    };
    loadSpaces();
    const spacesTimer = window.setInterval(loadSpaces, 60_000);

    return () => {
      window.clearInterval(spacesTimer);
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, []);
}
