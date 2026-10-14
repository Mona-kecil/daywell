// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { Train } from "../components/train";
import { FeedbackProvider } from "../components/ui";
import { FREQUENCY_HUE, PALETTE } from "../components/body3d";

const mocks = vi.hoisted(() => ({ results: {} as Record<string, unknown> }));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => mocks.results[getFunctionName(ref as never)],
  useMutation: () => async () => null,
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: () => {},
  }),
}));
// Shows what the picker body would paint: each muscle's caption and colour.
// Replay's body has no selection and renders nothing here.
vi.mock("../components/body3d", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/body3d")>()),
  BodyModel: ({
    states,
    selected,
    colorOf,
  }: {
    states: Record<string, { label: string }>;
    selected?: string[];
    colorOf?: (key: string, dark: boolean) => string;
  }) =>
    selected && (
      <ul aria-label="Body">
        {Object.entries(states).map(([key, s]) => (
          <li key={key}>
            {key}: {s.label} · {colorOf ? colorOf(key, false) : "recovery"}
          </li>
        ))}
      </ul>
    ),
}));

const now = new Date(2026, 9, 14, 9).getTime();
const muscles = ["chest", "back", "calves"].map((name) => ({
  _id: `m-${name}`,
  name,
  lastTrainedAt: name === "chest" ? now - 3_600_000 : null,
  cooldownHours: 48,
}));
const body = () =>
  within(screen.getByRole("list", { name: "Body" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  mocks.results["volume:weekly"] = {
    weeks: [{ start: "2026-10-12", perMuscle: {} }],
    muscles: [
      {
        id: "m-chest",
        name: "chest",
        current: 25,
        average: 12,
        status: "high",
      },
      {
        id: "m-back",
        name: "back",
        current: 1,
        average: 8,
        status: "on-track",
      },
      {
        id: "m-calves",
        name: "calves",
        current: 0,
        average: 0,
        status: "none",
      },
    ],
  };
});
afterEach(() => {
  cleanup();
  mocks.results = {};
  vi.unstubAllGlobals();
});

describe("Train body map", () => {
  it("switches between recovery and this week's sets", async () => {
    render(
      <FeedbackProvider>
        <Train muscles={muscles as never} now={now} />
      </FeedbackProvider>,
    );
    const modes = within(
      screen.getByRole("group", { name: "Colour muscles by" }),
    );
    expect(
      modes
        .getByRole("button", { name: "Recovery" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(body().every((t) => t!.endsWith("· recovery"))).toBe(true);

    await userEvent.click(
      modes.getByRole("button", { name: "Sets this week" }),
    );
    const { light } = PALETTE;
    expect(body()).toEqual([
      // Capped at 20+ for colour; the caption keeps the real count.
      `chest: 25 working sets this week · ${FREQUENCY_HUE.light}`,
      expect.stringMatching(/^back: 1 working set this week · #[0-9a-f]{6}$/),
      `calves: 0 working sets this week · ${light.never}`,
    ]);
    // One set is tinted, but much lighter than the full hue.
    expect(body()[1]).not.toContain(light.never);
    expect(body()[1]).not.toContain(FREQUENCY_HUE.light);
  });
});
