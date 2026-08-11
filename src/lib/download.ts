/**
 * Saving an attachment to disk.
 *
 * The WebView can't do this itself: attachment bytes live behind `mxc://`, and
 * in an encrypted room they're ciphertext until Rust decrypts them. So the
 * picker runs here and the actual write happens in the backend.
 */

import { save } from "@tauri-apps/plugin-dialog";

import * as ipc from "./ipc";
import { useStore } from "../store";

/**
 * Ask where to put `mxc`, then write it there. A cancelled picker is a no-op.
 */
export async function saveAttachment(mxc: string, name: string): Promise<void> {
  const { showBanner } = useStore.getState();
  try {
    const destination = await save({ defaultPath: suggestedName(name) });
    if (!destination) return;
    await ipc.saveMedia(mxc, destination);
    showBanner("info", "saved~");
  } catch (e) {
    showBanner("error", ipc.asUwuError(e).message);
  }
}

/**
 * The filename to pre-fill the picker with.
 *
 * A message body is whatever the sender put there, including path separators,
 * so take the last segment and fall back to something neutral. The user still
 * chooses the directory; this only keeps the suggestion sane.
 */
function suggestedName(body: string): string {
  const last = body.split(/[\\/]/).pop()?.trim();
  return last && last !== "." && last !== ".." ? last : "attachment";
}
