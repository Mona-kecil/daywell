// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BarcodeSheet,
  ManualMealSheet,
  RecentMeals,
} from "../components/meal-add";
import { FeedbackProvider } from "../components/ui";
import { manualMealSchema, mealSummary } from "../lib/manual-meal";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(async () => {}),
  action: vi.fn(async () => null),
  query: undefined as unknown,
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useAction: () => mocks.action,
  useQuery: () => mocks.query,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.query = undefined;
  vi.unstubAllGlobals();
  delete window.BarcodeDetector;
});

const sheet = (node: React.ReactNode) =>
  render(<FeedbackProvider>{node}</FeedbackProvider>);

function camera(getUserMedia: () => Promise<unknown>, codes: string[]) {
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { getUserMedia },
  });
  window.BarcodeDetector = class {
    detect = async () => codes.map((rawValue) => ({ rawValue }));
  };
}

describe("barcode camera", () => {
  it("releases a camera granted after the sheet closed", async () => {
    let grant!: (stream: unknown) => void;
    const stop = vi.fn();
    camera(() => new Promise((resolve) => (grant = resolve)), []);
    const view = sheet(<BarcodeSheet open onClose={() => {}} />);
    view.unmount();
    await act(async () => grant({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalled();
  });

  it("looks each code up once and keeps scanning after a miss", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(
      4,
    );
    const codes = ["012345678905"];
    camera(async () => ({ getTracks: () => [{ stop: () => {} }] }), codes);
    sheet(<BarcodeSheet open onClose={() => {}} />);
    await act(() => new Promise((r) => setTimeout(r, 1000)));
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/No USDA product/)).toBeTruthy();
    codes[0] = "96385074";
    await act(() => new Promise((r) => setTimeout(r, 600)));
    expect(mocks.action).toHaveBeenCalledTimes(2);
    expect(mocks.action).toHaveBeenLastCalledWith({ code: "96385074" });
  });
});

describe("manual meal form", () => {
  async function fill(name: string, values: Record<string, string>) {
    sheet(<ManualMealSheet open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText("Food 1 name"), name);
    for (const [label, value] of Object.entries(values))
      await userEvent.type(screen.getByLabelText(`Food 1 ${label}`), value);
    await userEvent.click(screen.getByText("Log meal"));
  }

  it("asks for a name instead of sending a blank one", async () => {
    await fill("   ", { kcal: "100" });
    expect(screen.getByRole("alert").textContent).toBe("Food 1 needs a name.");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("explains values the server would reject", async () => {
    await fill("Seeds", { kcal: "1500" });
    expect(screen.getByRole("alert").textContent).toMatch(
      /Seeds works out to more than 1,000 kcal per 100 g/,
    );
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("sends anything the server accepts", async () => {
    await fill("Seeds", { "Protein g": "60", "Fat g": "50" });
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Seeds" }),
    );
  });

  it("keeps a fallback name from many long foods within the limit", () => {
    const names = Array.from({ length: 21 }, (_, i) => `${i}`.padEnd(200, "x"));
    const description = mealSummary(names);
    expect(description.length).toBeLessThanOrEqual(4000);
    expect(
      manualMealSchema.shape.description.safeParse(description).success,
    ).toBe(true);
  });
});

describe("recent meals", () => {
  it("undoes a repeated meal", async () => {
    mocks.query = [
      { id: "meal-1", description: "Oats", kcal: 380, at: Date.now() },
    ];
    mocks.mutation.mockResolvedValueOnce("meal-2" as never);
    sheet(<RecentMeals />);
    await userEvent.click(
      screen.getByRole("button", { name: /Log Oats again/ }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ mealId: "meal-1" }),
    );
    expect(await screen.findByText("Logged Oats")).toBeTruthy();
    await userEvent.click(screen.getByText("Undo"));
    expect(mocks.mutation).toHaveBeenLastCalledWith({ id: "meal-2" });
    expect(await screen.findByText("Undone")).toBeTruthy();
  });
});
