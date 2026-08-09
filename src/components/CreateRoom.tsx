import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import { Button, Icon, RaveLabel, Spinner, Toggle } from "./ui";

type Mode = "create" | "join";

/**
 * Making a room, and joining one by alias.
 *
 * Mounted from the shell; opened from the `+` in the room list header and from
 * the empty state, which has always told people to join a room without giving
 * them any way to.
 */
export function CreateRoom() {
  const open = useStore((s) => s.showCreateRoom);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const close = useStore((s) => s.closeCreateRoom);
  const selectRoom = useStore((s) => s.selectRoom);
  const showBanner = useStore((s) => s.showBanner);
  const refreshSpaces = useStore((s) => s.refreshSpaces);
  const activeSpaceId = useStore((s) => s.activeSpaceId);
  const space = useStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId));

  const [mode, setMode] = useState<Mode>("create");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [alias, setAlias] = useState("");
  // On by default, and only ever a choice here: a room can't be encrypted
  // afterwards in any way that protects what came before, and can't be
  // un-encrypted at all.
  const [encrypted, setEncrypted] = useState(true);
  const [addToSpace, setAddToSpace] = useState(true);

  const [aliasOrId, setAliasOrId] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await ipc.createRoom({
        name: name.trim(),
        topic: topic.trim() || undefined,
        isPublic,
        alias: isPublic ? alias.trim() || undefined : undefined,
        encrypted,
        parentSpace: addToSpace ? activeSpaceId : null,
      });

      close();
      if (result.spaceWarning) showBanner("error", result.spaceWarning);

      // The space's children list is only re-read on a slow poll, and the
      // sidebar filters on it. Ask for it now so the room is where the user
      // just put it.
      if (addToSpace && activeSpaceId) void refreshSpaces();

      // The room arrives through the sliding-sync diff like any other, and
      // opening a timeline for a room the room list hasn't heard of yet fails.
      // So wait for it to turn up rather than inserting it by hand.
      await waitForRoom(result.roomId);
      void selectRoom(result.roomId);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!aliasOrId.trim() || busy) return;
    setBusy(true);
    try {
      const roomId = await ipc.joinRoom(aliasOrId.trim());
      close();
      await waitForRoom(roomId);
      void selectRoom(roomId);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 180,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(11,11,15,.7)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="uwu-scroll"
        style={{
          width: 420,
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          padding: 24,
          borderRadius: 24,
          background: "var(--surface-card-raised)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-pop)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 20,
              flex: 1,
            }}
          >
            {mode === "create" ? "make a room~" : "join a room"}
          </div>
          <button onClick={close} aria-label="close" style={{ cursor: "pointer", display: "flex" }}>
            <Icon name="x" size={15} color="var(--text-tertiary)" />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          <ModeTab label="make one" active={mode === "create"} onClick={() => setMode("create")} />
          <ModeTab label="join one" active={mode === "join"} onClick={() => setMode("join")} />
        </div>

        {mode === "create" ? (
          <>
            <Field label="name">
              <Input value={name} onChange={setName} placeholder="movie night" autoFocus />
            </Field>

            <Field label="what's it for">
              <Input value={topic} onChange={setTopic} placeholder="optional~" />
            </Field>

            <SwitchRow
              label="anyone can join"
              hint={
                isPublic
                  ? "listed in your server's directory, and anyone can walk in"
                  : "invite only"
              }
              on={isPublic}
              onToggle={setIsPublic}
            />

            {isPublic && (
              <Field label="address">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                    #
                  </span>
                  <Input value={alias} onChange={setAlias} placeholder="movie-night" />
                </div>
              </Field>
            )}

            <SwitchRow
              label="encrypt it"
              hint={
                encrypted
                  ? "only people in the room can read it. this can't be turned off later."
                  : "your homeserver can read everything sent here. you can't turn encryption on later."
              }
              on={encrypted}
              onToggle={setEncrypted}
            />

            {space && (
              <SwitchRow
                label={`put it in ${space.name}`}
                hint="you need permission to manage that space — if you haven't got it, the room still gets made, just not filed there"
                on={addToSpace}
                onToggle={setAddToSpace}
              />
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
              <Button onClick={() => void create()} disabled={!name.trim() || busy}>
                {busy ? <Spinner size={14} color="var(--text-on-accent)" /> : "make it"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field label="address or id">
              <Input
                value={aliasOrId}
                onChange={setAliasOrId}
                placeholder="#room:server.tld"
                autoFocus
                onEnter={() => void join()}
              />
            </Field>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-tertiary)",
                lineHeight: 1.5,
                marginTop: -4,
              }}
            >
              an alias like <code>#uwu:m.uwu.lt</code>, or a room id if someone gave you one.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
              <Button onClick={() => void join()} disabled={!aliasOrId.trim() || busy}>
                {busy ? <Spinner size={14} color="var(--text-on-accent)" /> : "join"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Wait for a room to appear in the store, for a few seconds at most.
 *
 * Creating and joining both return a room ID before sliding sync has told us
 * the room exists, and `open_timeline` on a room the room list doesn't know
 * yet raises. Giving up quietly is fine — the room list will still fill in.
 */
async function waitForRoom(roomId: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (useStore.getState().rooms.some((r) => r.id === roomId)) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px",
        borderRadius: 999,
        cursor: "pointer",
        fontFamily: "var(--font-rave)",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        ...(active
          ? {
              background: "var(--surface-inset)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }
          : {
              background: "transparent",
              color: "var(--text-tertiary)",
              border: "1px solid transparent",
            }),
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <RaveLabel style={{ marginBottom: 6 }}>{label}</RaveLabel>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      className="selectable"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) onEnter();
      }}
      style={{
        width: "100%",
        padding: "10px 13px",
        borderRadius: 14,
        background: "var(--surface-inset)",
        border: "1px solid var(--border-subtle)",
        outline: "none",
        color: "var(--text-primary)",
        fontSize: 14,
      }}
    />
  );
}

function SwitchRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-tertiary)",
            lineHeight: 1.45,
            marginTop: 2,
          }}
        >
          {hint}
        </div>
      </div>
      <div style={{ paddingTop: 2 }}>
        <Toggle on={on} onToggle={onToggle} label={label} />
      </div>
    </div>
  );
}
