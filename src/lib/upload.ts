/**
 * Getting a file into a room, from wherever the user had it.
 *
 * Three routes arrive here: the composer's file picker and anything dropped on
 * the window come as *paths* (Rust reads them), while a paste comes as bytes
 * the WebView is already holding. Same destination, so the same error handling
 * and the same limit.
 */

import * as ipc from "./ipc";
import { useStore } from "../store";

/**
 * Refuse anything larger than this before it crosses IPC.
 *
 * Homeservers have their own, usually smaller, limit — this exists so a
 * misdirected drop of something enormous fails immediately and legibly instead
 * of pushing gigabytes through the bridge to find out.
 */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** Files the WebView handed us as data: a paste, mostly. */
export async function uploadFiles(
  files: File[],
  roomId: string,
  threadRoot?: string,
): Promise<void> {
  const { showBanner } = useStore.getState();

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showBanner("error", `${nameFor(file)} is too big to send — 100mb is the limit here`);
      continue;
    }

    try {
      const bytes = await file.arrayBuffer();
      await ipc.sendAttachmentBytes(
        roomId,
        { name: nameFor(file), type: file.type, bytes },
        threadRoot,
      );
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }
}

/** Files that exist on disk: the picker, and anything dropped on the window. */
export async function uploadPaths(
  paths: string[],
  roomId: string,
  threadRoot?: string,
): Promise<void> {
  const { showBanner } = useStore.getState();

  for (const path of paths) {
    try {
      await ipc.sendAttachment(roomId, path, undefined, threadRoot);
    } catch (e) {
      showBanner("error", ipc.asUwuError(e).message);
    }
  }
}

/**
 * A name to send the file under.
 *
 * Clipboard images often arrive as a bare `image.png`, or with no name at all —
 * every screenshot would then land in the timeline under the same word. A
 * timestamp makes them tellable apart afterwards.
 */
function nameFor(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;

  const extension = file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `pasted-${stamp}.${extension}`;
}
