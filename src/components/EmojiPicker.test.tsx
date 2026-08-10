import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImagePack } from "../lib/types";
import { useStore } from "../store";
import { EmojiPicker } from "./EmojiPicker";

const ANCHOR = new DOMRect(400, 300, 28, 26);

function open(onPick = vi.fn(), onClose = vi.fn()) {
  render(<EmojiPicker anchor={ANCHOR} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose };
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function type(query: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "search emoji" }), {
    target: { value: query },
  });
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().updateSettings({ skinTone: 0, recentReactions: ["💜"] });
});

// The suite doesn't run with `globals`, so React Testing Library's automatic
// teardown never registers and each render would stack on the last.
afterEach(cleanup);

describe("EmojiPicker", () => {
  it("hands back the emoji that was clicked", () => {
    const { onPick } = open();
    click("grinning face");
    expect(onPick).toHaveBeenCalledWith({ kind: "unicode", emoji: "😀" });
  });

  it("narrows to matches as you type, and says so when there are none", () => {
    open();

    type("grinning face");
    expect(screen.getByRole("button", { name: "grinning face" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "cat" })).toBeNull();

    type("zzzznope");
    expect(screen.getByText(/nothing matches/)).toBeTruthy();
  });

  it("sends the chosen skin tone with emoji that support one", () => {
    const { onPick } = open();

    click("skin tone 5");
    click("waving hand");
    expect(onPick).toHaveBeenCalledWith({ kind: "unicode", emoji: "👋🏿" });

    // A face has no tone variants, so it comes back untouched.
    click("grinning face");
    expect(onPick).toHaveBeenLastCalledWith({ kind: "unicode", emoji: "😀" });
  });

  it("offers recents as they were sent, without re-toning them", () => {
    useStore.getState().updateSettings({ skinTone: 4, recentReactions: ["👋🏻"] });
    const { onPick } = open();

    click("👋🏻");
    expect(onPick).toHaveBeenCalledWith({ kind: "unicode", emoji: "👋🏻" });
  });

  it("closes on escape and on a press outside", () => {
    const { onClose } = open();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();

    onClose.mockClear();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open for a press on itself", () => {
    const { onClose } = open();

    fireEvent.pointerDown(screen.getByRole("textbox", { name: "search emoji" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

const BLOBCAT = {
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

const STICKER = { ...BLOBCAT, shortcode: "wave", url: "mxc://veil.gg/wave", isEmoticon: false, isSticker: true };

const PACK: ImagePack = {
  id: "user",
  source: "user",
  roomId: null,
  stateKey: null,
  displayName: "my emotes",
  avatarUrl: null,
  attribution: null,
  images: [BLOBCAT, STICKER],
  everywhere: true,
  canEdit: true,
};

describe("EmojiPicker — custom packs", () => {
  it("offers a pack's emotes and hands back the image", () => {
    const onPick = vi.fn();
    render(<EmojiPicker anchor={ANCHOR} packs={[PACK]} onPick={onPick} onClose={vi.fn()} />);

    click("blobcat");
    expect(onPick).toHaveBeenCalledWith({ kind: "emote", image: BLOBCAT });
  });

  it("keeps stickers out of a picker that can't send them", () => {
    render(<EmojiPicker anchor={ANCHOR} packs={[PACK]} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "wave" })).toBeNull();
  });

  it("offers stickers when the caller can send them", () => {
    const onPick = vi.fn();
    render(
      <EmojiPicker anchor={ANCHOR} packs={[PACK]} stickers onPick={onPick} onClose={vi.fn()} />,
    );

    click("wave");
    expect(onPick).toHaveBeenCalledWith({ kind: "sticker", image: STICKER });
  });

  it("searches shortcodes alongside emoji names", () => {
    render(<EmojiPicker anchor={ANCHOR} packs={[PACK]} onPick={vi.fn()} onClose={vi.fn()} />);

    type("blob");
    expect(screen.getByRole("button", { name: "blobcat" })).toBeTruthy();
  });

  it("draws a remembered shortcode as its image, and picks it as an emote", () => {
    useStore.getState().updateSettings({ recentReactions: [":blobcat:"] });
    const onPick = vi.fn();
    render(<EmojiPicker anchor={ANCHOR} packs={[PACK]} onPick={onPick} onClose={vi.fn()} />);

    // Two cells show it — the recents row and the pack itself — and both are
    // images rather than the literal `:blobcat:`.
    const cells = screen.getAllByRole("button", { name: "blobcat" });
    expect(cells.length).toBe(2);
    expect(cells[0].querySelector("img")).toBeTruthy();

    fireEvent.click(cells[0]);
    expect(onPick).toHaveBeenCalledWith({ kind: "emote", image: BLOBCAT });
  });

  it("shows a room's own pack even when it isn't carried everywhere", () => {
    render(
      <EmojiPicker
        anchor={ANCHOR}
        packs={[{ ...PACK, everywhere: false }]}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "blobcat" })).toBeTruthy();
  });
});

describe("EmojiPicker — reactions from other clients", () => {
  it("draws a remembered mxc reaction as its image, and sends it back unchanged", () => {
    // Clicking someone else's custom-emoji reaction remembers their key, which
    // is an address rather than a shortcode.
    const key = "mxc://m.uwu.lt/E0BVMUGArK7dEk9";
    useStore.getState().updateSettings({ recentReactions: [key] });

    const onPick = vi.fn();
    render(<EmojiPicker anchor={ANCHOR} packs={[PACK]} onPick={onPick} onClose={vi.fn()} />);

    const cell = screen.getByRole("button", { name: key });
    expect(cell.querySelector("img")).toBeTruthy();

    fireEvent.click(cell);
    expect(onPick).toHaveBeenCalledWith({ kind: "unicode", emoji: key });
  });
});
