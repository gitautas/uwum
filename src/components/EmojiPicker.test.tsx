import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(onPick).toHaveBeenCalledWith("😀");
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
    expect(onPick).toHaveBeenCalledWith("👋🏿");

    // A face has no tone variants, so it comes back untouched.
    click("grinning face");
    expect(onPick).toHaveBeenLastCalledWith("😀");
  });

  it("offers recents as they were sent, without re-toning them", () => {
    useStore.getState().updateSettings({ skinTone: 4, recentReactions: ["👋🏻"] });
    const { onPick } = open();

    click("👋🏻");
    expect(onPick).toHaveBeenCalledWith("👋🏻");
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
