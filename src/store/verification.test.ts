import { beforeEach, describe, expect, it } from "vitest";

import type { SasStateInfo, VerificationRequestInfo } from "../lib/types";
import { useStore } from "./index";

/**
 * Verification state is addressed by flow id, and for a long time nothing
 * checked it. Abandoned flows keep emitting long after the user has moved on —
 * a retry leaves the first attempt open, and the other client cancels the one
 * it superseded — so the last event to arrive won, whichever verification it
 * belonged to. What the user saw was a live verification abruptly reporting
 * "not verified — the user cancelled": the epitaph of a flow they had already
 * forgotten about, printed over the one in front of them.
 */

function request(over: Partial<VerificationRequestInfo> = {}): VerificationRequestInfo {
  return {
    flowId: "flow-1",
    otherUserId: "@them:example.org",
    otherDeviceId: null,
    isSelfVerification: false,
    weStarted: false,
    state: "requested",
    cancelReason: null,
    cancelledByUs: null,
    cancelCode: null,
    ...over,
  };
}

function sas(over: Partial<SasStateInfo> = {}): SasStateInfo {
  return {
    flowId: "flow-1",
    otherUserId: "@them:example.org",
    state: "keysExchanged",
    emoji: [{ symbol: "🐶", description: "Dog" }],
    decimals: null,
    cancelReason: null,
    cancelledByUs: null,
    cancelCode: null,
    ...over,
  };
}

const state = () => useStore.getState();

beforeEach(() => {
  state().reset();
});

describe("setVerificationRequest", () => {
  it("keeps the running flow when a second request arrives", () => {
    state().setVerificationRequest(request({ flowId: "live" }));
    state().setVerificationRequest(request({ flowId: "other" }));

    expect(state().verificationRequest?.flowId).toBe("live");
  });

  it("takes the new request once the running one has finished", () => {
    state().setVerificationRequest(request({ flowId: "live" }));
    state().applyVerificationUpdate(request({ flowId: "live", state: "done" }));
    state().setVerificationRequest(request({ flowId: "next" }));

    expect(state().verificationRequest?.flowId).toBe("next");
  });

  it("lets the user close the modal while a flow is still running", () => {
    state().setVerificationRequest(request({ flowId: "live" }));
    state().setVerificationRequest(null);

    expect(state().verificationRequest).toBeNull();
  });
});

describe("applyVerificationUpdate", () => {
  it("ignores a cancel belonging to some other flow", () => {
    state().setVerificationRequest(request({ flowId: "live" }));
    state().applyVerificationUpdate(
      request({
        flowId: "abandoned",
        state: "cancelled",
        cancelReason: "The user cancelled the verification.",
        cancelCode: "m.user",
        cancelledByUs: false,
      }),
    );

    expect(state().verificationRequest?.state).toBe("requested");
  });

  it("ignores SAS emoji belonging to some other flow", () => {
    state().setVerificationRequest(request({ flowId: "live" }));
    state().applyVerificationUpdate(sas({ flowId: "abandoned" }));

    expect(state().sasState).toBeNull();
  });

  it("applies updates for the flow on screen", () => {
    state().setVerificationRequest(request({ flowId: "live" }));
    state().applyVerificationUpdate(request({ flowId: "live", state: "ready" }));
    state().applyVerificationUpdate(sas({ flowId: "live" }));

    expect(state().verificationRequest?.state).toBe("ready");
    expect(state().sasState?.emoji).toHaveLength(1);
  });

  it("drops updates that arrive with no request on screen", () => {
    state().applyVerificationUpdate(sas({ flowId: "live" }));

    expect(state().sasState).toBeNull();
  });
});
