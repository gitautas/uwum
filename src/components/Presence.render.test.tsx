import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Presence } from "../lib/types";

const watchPresence = vi.fn((_userIds: string[]) => Promise.resolve());

vi.mock("../lib/ipc", () => ({
  watchPresence: (userIds: string[]) => watchPresence(userIds),
}));

const { PresenceDot, PresenceLine } = await import("./Presence");
const { resetPresence } = await import("../lib/presence");
const { useStore } = await import("../store");

const THEM = "@fa:veil.gg";

function presence(patch: Partial<Presence> = {}): Presence {
  return {
    userId: THEM,
    presence: "online",
    statusMsg: null,
    lastActive: Date.now(),
    currentlyActive: true,
    ...patch,
  };
}

/** The dot has no text, so it's found by the title the tooltip uses. */
function dot(): HTMLElement | null {
  return document.querySelector("[title]");
}

beforeEach(() => {
  vi.useFakeTimers();
  // The watch set is module state shared by every test in the file; a pending
  // flush from the last one would swallow the next one's.
  resetPresence();
  useStore.setState({ presence: {}, presenceSupported: true });
  watchPresence.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PresenceDot", () => {
  it("draws nothing until an answer arrives", () => {
    render(<PresenceDot userId={THEM} />);
    expect(dot()).toBeNull();
  });

  it("draws nothing at all on a server without presence", () => {
    // The distinction that matters: "we don't know" must not be painted as
    // "offline", which is what every user on such a server would look like.
    useStore.setState({
      presence: { [THEM]: presence({ presence: "offline" }) },
      presenceSupported: false,
    });
    render(<PresenceDot userId={THEM} />);
    expect(dot()).toBeNull();
  });

  it("shows an answer once there is one", () => {
    useStore.setState({ presence: { [THEM]: presence() } });
    render(<PresenceDot userId={THEM} />);
    expect(dot()?.getAttribute("title")).toBe("online");
  });

  it("spells out when someone away was last seen", () => {
    useStore.setState({
      presence: {
        [THEM]: presence({
          presence: "unavailable",
          lastActive: Date.now() - 12 * 60_000,
        }),
      },
    });
    render(<PresenceDot userId={THEM} />);
    expect(dot()?.getAttribute("title")).toBe("away · last seen 12m ago");
  });
});

describe("watching", () => {
  it("asks the backend for exactly the people on screen, once", () => {
    const view = render(
      <>
        <PresenceDot userId={THEM} />
        <PresenceDot userId={THEM} />
        <PresenceDot userId="@gintas:veil.gg" />
      </>,
    );

    // The set is debounced: three mounts in one pass are one round trip.
    vi.runAllTimers();
    expect(watchPresence).toHaveBeenCalledTimes(1);
    expect([...watchPresence.mock.calls[0][0]].sort()).toEqual([
      "@fa:veil.gg",
      "@gintas:veil.gg",
    ]);

    watchPresence.mockClear();
    view.unmount();
    vi.runAllTimers();

    // Nothing is drawing anyone any more, so nothing should still be polled.
    expect(watchPresence).toHaveBeenCalledWith([]);
  });
});

describe("PresenceLine", () => {
  it("reads out the state and the last-seen time together", () => {
    useStore.setState({
      presence: {
        [THEM]: presence({ presence: "offline", lastActive: Date.now() - 3_600_000 }),
      },
    });
    render(<PresenceLine userId={THEM} />);

    expect(screen.getByText("offline")).toBeTruthy();
    expect(screen.getByText("last seen 1h ago")).toBeTruthy();
  });

  it("drops the last-seen half while someone is actually here", () => {
    useStore.setState({ presence: { [THEM]: presence() } });
    render(<PresenceLine userId={THEM} />);

    expect(screen.getByText("online")).toBeTruthy();
    expect(screen.queryByText(/last seen/)).toBeNull();
  });
});
