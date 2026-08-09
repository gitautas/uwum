import { useShallow } from "zustand/react/shallow";

import { localpart } from "../lib/display";
import * as ipc from "../lib/ipc";
import { useStore } from "../store";
import { Button, Icon } from "./ui";

/**
 * Emoji SAS verification.
 *
 * The whole point is that both people compare the same seven pictures out of
 * band, so the copy has to be unambiguous about what "they match" means — a
 * user who clicks through this without looking has verified nothing.
 */
export function VerificationModal() {
  const { request, sas, setRequest, showBanner } = useStore(
    useShallow((s) => ({
      request: s.verificationRequest,
      sas: s.sasState,
      setRequest: s.setVerificationRequest,
      showBanner: s.showBanner,
    })),
  );

  if (!request) return null;

  const otherUser = request.otherUserId;
  const who = request.isSelfVerification ? "your other device" : localpart(otherUser);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }

  const emoji = sas?.emoji ?? null;
  const done = sas?.state === "done";
  const cancelled = sas?.state === "cancelled" || request.state === "cancelled";
  const waiting = sas?.state === "confirmed";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--surface-overlay)",
        backdropFilter: "var(--blur-glass)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 440,
          padding: 28,
          borderRadius: 28,
          background: "var(--surface-card)",
          border: "1px solid rgba(177,78,255,.35)",
          boxShadow: "var(--shadow-pop), var(--glow-violet)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 15,
              background: "var(--accent-tertiary)",
              color: "var(--text-on-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="shield-star" size={20} color="var(--text-on-accent)" />
          </div>
          <div>
            <div
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18 }}
            >
              {done ? "verified~" : cancelled ? "verification stopped" : "verify " + who}
            </div>
            <div
              className="selectable"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-tertiary)",
              }}
            >
              {otherUser}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          {done ? (
            <Outcome
              icon="seal-check"
              colour="var(--accent-primary)"
              title="all good"
              body={
                request.isSelfVerification
                  ? "your devices trust each other now, and your message history will follow you."
                  : `you and ${who} are verified. messages between you are now marked as trusted.`
              }
            />
          ) : cancelled ? (
            <Outcome
              icon="warning-circle"
              colour="var(--status-danger)"
              title="not verified"
              body={
                sas?.cancelReason ??
                "the verification was cancelled. nothing has changed — you can try again."
              }
            />
          ) : emoji ? (
            <>
              <div
                style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}
              >
                compare these with {who}. they should be in the{" "}
                <strong style={{ color: "var(--text-primary)" }}>same order</strong> on both
                screens.
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 10,
                  margin: "18px 0 6px",
                }}
              >
                {emoji.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "12px 4px 9px",
                      borderRadius: 16,
                      background: "var(--surface-card-raised)",
                      border: "1px solid var(--border-subtle)",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 28, lineHeight: 1 }}>{e.symbol}</div>
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: "var(--font-mono)",
                        fontSize: 9.5,
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {e.description.toLowerCase()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : waiting ? (
            <Waiting text="waiting for them to confirm…" />
          ) : (
            <Waiting
              text={
                request.weStarted
                  ? "waiting for them to accept…"
                  : "accept to see the emoji to compare"
              }
            />
          )}
        </div>

        <div style={{ marginTop: 22, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {done || cancelled ? (
            <Button onClick={() => setRequest(null)}>close</Button>
          ) : emoji ? (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  void run(() => ipc.mismatchVerification(otherUser, request.flowId))
                }
              >
                they don't match
              </Button>
              <Button
                onClick={() =>
                  void run(() => ipc.confirmVerification(otherUser, request.flowId))
                }
              >
                they match~
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  void run(() => ipc.cancelVerification(otherUser, request.flowId))
                }
              >
                later
              </Button>
              {!request.weStarted && (
                <Button
                  onClick={() =>
                    void run(() => ipc.acceptVerification(otherUser, request.flowId))
                  }
                >
                  verify
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Outcome({
  icon,
  colour,
  title,
  body,
}: {
  icon: string;
  colour: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Icon name={icon} size={22} color={colour} style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            marginTop: 4,
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "22px 0",
        color: "var(--text-secondary)",
        fontSize: 13.5,
      }}
    >
      <span style={{ display: "inline-flex", gap: 4 }}>
        {[0, 0.2, 0.4].map((d) => (
          <span
            key={d}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-tertiary)",
              animation: `uwuPulse 1s ${d}s infinite`,
            }}
          />
        ))}
      </span>
      {text}
    </div>
  );
}

/** The dismissible strip at the top of the timeline from the design. */
export function VerifyBanner() {
  const { request, setRequest, showBanner } = useStore(
    useShallow((s) => ({
      request: s.verificationRequest,
      setRequest: s.setVerificationRequest,
      showBanner: s.showBanner,
    })),
  );

  // Only unsolicited incoming requests get a banner; ones we started already
  // have the modal open.
  if (!request || request.weStarted || request.state !== "requested") return null;

  const who = request.isSelfVerification
    ? "another device"
    : localpart(request.otherUserId);

  return (
    <div
      style={{
        margin: "14px 22px 0",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        borderRadius: 20,
        background: "var(--surface-card-raised)",
        border: "1px solid rgba(177,78,255,.35)",
        boxShadow: "0 0 24px rgba(177,78,255,.16)",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          flex: "none",
          borderRadius: 14,
          background: "var(--accent-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="shield-star" size={19} color="var(--text-on-accent)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
          new device wants in~
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
          {who} asked to verify. verify it so your messages stay readable everywhere.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button
          size="sm"
          onClick={() =>
            void ipc
              .acceptVerification(request.otherUserId, request.flowId)
              .catch((e) => showBanner("error", ipc.asUwuError(e).message))
          }
        >
          verify
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRequest(null)}>
          later
        </Button>
      </div>
    </div>
  );
}
