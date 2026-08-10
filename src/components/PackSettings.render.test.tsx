import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImagePack } from "../lib/types";

const getAllImagePacks = vi.fn();
const getPackRooms = vi.fn();
const editImagePack = vi.fn().mockResolvedValue(undefined);
const setPackEverywhere = vi.fn().mockResolvedValue(undefined);
const createPersonalPack = vi.fn().mockResolvedValue("!made:veil.gg");

vi.mock("../lib/ipc", () => ({
  getAllImagePacks: () => getAllImagePacks(),
  getPackRooms: () => getPackRooms(),
  editImagePack: (...args: unknown[]) => editImagePack(...args),
  setPackEverywhere: (...args: unknown[]) => setPackEverywhere(...args),
  createPersonalPack: (...args: unknown[]) => createPersonalPack(...args),
  uploadMedia: vi.fn(),
  asUwuError: (e: unknown) => ({ kind: "other", message: String(e) }),
  // The grid asks for a thumbnail; there's no protocol handler in a test.
  mediaUrl: () => null,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { PacksSection } = await import("./PackSettings");

const image = {
  shortcode: "blobcat",
  url: "mxc://veil.gg/cat",
  body: "blobcat",
  isEmoticon: true,
  isSticker: false,
  width: 64,
  height: 64,
  size: null,
  mimetype: "image/png",
};

const MINE: ImagePack = {
  id: "user",
  source: "user",
  roomId: null,
  stateKey: null,
  displayName: "your emotes",
  avatarUrl: null,
  attribution: null,
  images: [image],
  everywhere: true,
  canEdit: true,
};

const THEIRS: ImagePack = {
  ...MINE,
  id: "!r:veil.gg|blobs",
  source: "room",
  roomId: "!r:veil.gg",
  stateKey: "blobs",
  displayName: "the blob pack",
  everywhere: false,
  canEdit: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  getAllImagePacks.mockResolvedValue([MINE, THEIRS]);
  getPackRooms.mockResolvedValue([{ id: "!mine:veil.gg", name: "my room" }]);
});

afterEach(cleanup);

describe("PacksSection", () => {
  it("lists the room packs and any personal pack the account already has", async () => {
    render(<PacksSection />);

    expect(await screen.findByDisplayValue("your emotes")).toBeTruthy();
    expect(screen.getByText("the blob pack")).toBeTruthy();
  });

  it("makes a pack of your own, as many as asked for", async () => {
    render(<PacksSection />);

    const name = await screen.findByRole("textbox", { name: "new personal pack name" });
    fireEvent.change(name, { target: { value: "blobs" } });
    fireEvent.click(screen.getAllByRole("button", { name: "make it~" })[0]);

    await waitFor(() => expect(createPersonalPack).toHaveBeenCalledWith("blobs"));
  });

  it("doesn't offer a personal pack card when the account has never had one", async () => {
    // The MSC's account-data pack can't be created here, so an empty one is
    // not something to show an editor for.
    getAllImagePacks.mockResolvedValue([{ ...MINE, images: [] }, THEIRS]);
    render(<PacksSection />);

    await screen.findByText("the blob pack");
    expect(screen.queryByDisplayValue("your emotes")).toBeNull();
  });

  it("keeps a pack you can't edit read-only", async () => {
    render(<PacksSection />);
    await screen.findByText("the blob pack");

    // Editable packs get a name field; this one is plain text.
    expect(screen.queryByDisplayValue("the blob pack")).toBeNull();
    // And its images can't be opened for editing. Room packs render first, so
    // the locked pack's cell is the first one.
    expect(screen.getAllByRole("button", { name: ":blobcat:" })[0]).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("opens an editor for an image in a pack you own", async () => {
    getAllImagePacks.mockResolvedValue([MINE]);
    render(<PacksSection />);
    const cells = await screen.findAllByRole("button", { name: ":blobcat:" });

    fireEvent.click(cells[0]);
    expect(screen.getByRole("textbox", { name: "shortcode" })).toBeTruthy();
    // Usage reflects the image: an emote, not a sticker.
    expect(screen.getByRole("switch", { name: "emote" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "sticker" }).getAttribute("aria-checked")).toBe("false");
  });

  it("sends a rename as a rename, not a fresh image", async () => {
    getAllImagePacks.mockResolvedValue([MINE]);
    render(<PacksSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: ":blobcat:" }))[0]);

    const field = screen.getByRole("textbox", { name: "shortcode" });
    fireEvent.change(field, { target: { value: "blobcatjam" } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(editImagePack).toHaveBeenCalledWith(
        { roomId: null, stateKey: null },
        { kind: "rename", from: "blobcat", to: "blobcatjam" },
      ),
    );
  });

  it("turns a usage off without losing the rest of the image", async () => {
    getAllImagePacks.mockResolvedValue([MINE]);
    render(<PacksSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: ":blobcat:" }))[0]);
    fireEvent.click(screen.getByRole("switch", { name: "sticker" }));

    await waitFor(() =>
      expect(editImagePack).toHaveBeenCalledWith(
        { roomId: null, stateKey: null },
        expect.objectContaining({
          kind: "putImage",
          shortcode: "blobcat",
          url: "mxc://veil.gg/cat",
          isEmoticon: true,
          isSticker: true,
          width: 64,
          height: 64,
        }),
      ),
    );
  });

  it("removes an image", async () => {
    getAllImagePacks.mockResolvedValue([MINE]);
    render(<PacksSection />);
    fireEvent.click((await screen.findAllByRole("button", { name: ":blobcat:" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "remove :blobcat:" }));

    await waitFor(() =>
      expect(editImagePack).toHaveBeenCalledWith(
        { roomId: null, stateKey: null },
        { kind: "removeImage", shortcode: "blobcat" },
      ),
    );
  });

  it("carries a room pack everywhere on request", async () => {
    render(<PacksSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "use everywhere" }));

    await waitFor(() =>
      expect(setPackEverywhere).toHaveBeenCalledWith("!r:veil.gg", "blobs", true),
    );
  });

  it("makes a new room pack under a slug of its name", async () => {
    render(<PacksSection />);

    fireEvent.change(await screen.findByRole("combobox", { name: "room for the new pack" }), {
      target: { value: "!mine:veil.gg" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "new pack name" }), {
      target: { value: "Blob Pack" },
    });
    // Two "make it~" buttons now: one for a pack of your own, one for a room.
    fireEvent.click(screen.getAllByRole("button", { name: "make it~" })[1]);

    await waitFor(() =>
      expect(editImagePack).toHaveBeenCalledWith(
        { roomId: "!mine:veil.gg", stateKey: "blob-pack" },
        { kind: "setName", name: "Blob Pack" },
      ),
    );
  });
});
