/**
 * The shapes that cross the bridge.
 *
 * Generated from the Rust wire types into `./bindings` by `npm run bindings`,
 * so there is nothing here to keep in step by hand: change the Rust type,
 * regenerate, and the compiler finds every use that no longer fits. A new type
 * the frontend needs gets `#[derive(TS)]` in Rust rather than a copy here.
 *
 * What does live here is how the frontend reads them.
 */

import type { SasStateInfo, VerificationRequestInfo } from "./bindings";

export type * from "./bindings";

/** The two verification payloads share an event channel; this tells them apart. */
export function isSasUpdate(
  update: VerificationRequestInfo | SasStateInfo,
): update is SasStateInfo {
  return "emoji" in update;
}

/**
 * Is this verification still running?
 *
 * A finished flow stays in the store on purpose, so the user can read the
 * outcome before dismissing it. That makes "there is a request" a useless test
 * for "a verification is in progress" — this is the one that means it.
 */
export function isLiveVerification(
  request: VerificationRequestInfo | null,
): request is VerificationRequestInfo {
  return !!request && request.state !== "done" && request.state !== "cancelled";
}
