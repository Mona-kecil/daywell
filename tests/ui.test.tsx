// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Today } from "../components/today";
import { Train } from "../components/train";
import { Water } from "../components/water";
import { Meals } from "../components/meals";
import { DayTimeline } from "../components/timeline";
import { Brand, FeedbackProvider } from "../components/ui";
import { mealTotals } from "../lib/nutrients";
const mocks = vi.hoisted(() => ({
  mutation: vi.fn(async () => {}),
  action: vi.fn(async () => {}),
  history: {
    results: [] as {
      _id: string;
      trainedAt: number;
      muscleIds: string[];
      note: string;
    }[],
    status: "Exhausted",
    loadMore: vi.fn(),
  },
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useAction: () => mocks.action,
  // Live queries stay loading; screens under test receive their data as props.
  useQuery: () => undefined,
  usePaginatedQuery: () => mocks.history,
}));
// WebGL can't run under jsdom; the 3D body has its own lab page.
vi.mock("../components/body3d", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/body3d")>()),
  BodyModel: () => <div className="body3d" aria-hidden />,
}));
let overview: FunctionReturnType<typeof api.tracker.overview>;
let entries: FunctionReturnType<typeof api.tracker.waterToday>;
let meals: FunctionReturnType<typeof api.meals.today>;
const now = new Date("2026-10-13T12:00:00Z").getTime();
beforeAll(async () => {
  // Use schema-generated IDs and values. UI RPC hooks alone are mocked.
  vi.stubGlobal("crypto", webcrypto);
  const t = convexTest(schema, import.meta.glob("../convex/**/*.{ts,js}"));
  const user = t.withIdentity({ subject: "ui-fixture" });
  await user.mutation(api.tracker.initialize, {});
  overview = await user.query(api.tracker.overview, {});
  await user.mutation(api.tracker.addWorkout, {
    muscleIds: [overview.muscles[0]._id],
    trainedAt: now - 36 * 3_600_000,
    note: "Fixture",
  });
  overview = await user.query(api.tracker.overview, {});
  await user.mutation(api.tracker.addWater, { amountMl: 500, at: now });
  entries = await user.query(api.tracker.waterToday, {
    startMs: now,
    endMs: now + 1000,
  });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture"], { type: "image/jpeg" })),
  );
  await t.run((ctx) =>
    ctx.db.insert("meals", {
      userId: "ui-fixture",
      storageId,
      at: now,
      description: "Rice",
      revision: 1,
      analysis: { status: "ready" },
      items: [
        {
          id: "rice",
          name: "Rice",
          grams: 150,
          searchQuery: "rice white cooked",
          status: "matched",
          fdcId: 2708422,
          foodDescription: "Rice, white, cooked, glutinous",
          per100g: { kcal: 96, protein: 2.01, carbs: 20.97, fat: 0.19 },
        },
      ],
    }),
  );
  meals = (
    await user.query(api.meals.today, { startMs: now, endMs: now + 1000 })
  ).map((meal) => ({ ...meal, photoUrl: "/icons/icon-192.png" }));
  vi.unstubAllGlobals();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.mutation.mockReset();
  vi.unstubAllGlobals();
  Object.assign(mocks.history, { results: [], status: "Exhausted" });
});
describe("screen actions", () => {
  it("opens Train from the Today action", async () => {
    const onTab = vi.fn();
    render(
      <FeedbackProvider>
        <Today
          now={now}
          overview={overview}
          waterMl={500}
          totals={mealTotals(meals[0].items)}
          mealCount={1}
          water={[]}
          meals={[]}
          pendingMeals={0}
          onTab={onTab}
        />
      </FeedbackProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Log workout" }));
    expect(onTab).toHaveBeenCalledWith("train");
  });
  it("adds quick water and a custom amount", async () => {
    render(
      <FeedbackProvider>
        <Water entries={entries} goal={2500} now={now} />
      </FeedbackProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /250 ml/ }));
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ amountMl: 250 }),
    );
    await userEvent.type(screen.getByLabelText("Custom amount (ml)"), "350");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ amountMl: 350 }),
    );
  });
  it("undoes a quick drink from the toast", async () => {
    mocks.mutation.mockResolvedValueOnce("water-1" as never);
    render(
      <FeedbackProvider>
        <Water entries={entries} goal={2500} now={now} />
      </FeedbackProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /250 ml/ }));
    expect(await screen.findByText("Added 250 ml")).toBeTruthy();
    await userEvent.click(screen.getByText("Undo"));
    expect(mocks.mutation).toHaveBeenLastCalledWith({ id: "water-1" });
    expect(await screen.findByText("Undone")).toBeTruthy();
    expect(screen.queryByText("Undo")).toBeNull();
  });
  it("undoes Today's quick drink", async () => {
    mocks.mutation.mockResolvedValueOnce("water-2" as never);
    render(
      <FeedbackProvider>
        <Today
          now={now}
          overview={overview}
          waterMl={500}
          totals={mealTotals(meals[0].items)}
          mealCount={1}
          water={[]}
          meals={[]}
          pendingMeals={0}
          onTab={() => {}}
        />
      </FeedbackProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "+ 250 ml" }));
    await userEvent.click(await screen.findByText("Undo"));
    expect(mocks.mutation).toHaveBeenLastCalledWith({ id: "water-2" });
    expect(await screen.findByText("Undone")).toBeTruthy();
  });
  it("undoes a saved workout", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    mocks.mutation.mockResolvedValueOnce("workout-1" as never);
    render(
      <FeedbackProvider>
        <Train muscles={overview.muscles} now={now} />
      </FeedbackProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: overview.muscles[1].name,
        pressed: false,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save workout" }));
    expect(await screen.findByText("Workout saved")).toBeTruthy();
    await userEvent.click(screen.getByText("Undo"));
    expect(mocks.mutation).toHaveBeenLastCalledWith({ id: "workout-1" });
    expect(await screen.findByText("Undone")).toBeTruthy();
  });
  it("shows why an undo failed", async () => {
    mocks.mutation
      .mockResolvedValueOnce("water-3" as never)
      .mockRejectedValueOnce(new Error("Water entry not found."));
    render(
      <FeedbackProvider>
        <Water entries={entries} goal={2500} now={now} />
      </FeedbackProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /250 ml/ }));
    await userEvent.click(await screen.findByText("Undo"));
    const toast = await screen.findByText("Water entry not found.");
    expect(toast.closest(".toast")?.classList.contains("error")).toBe(true);
    expect(screen.queryByText("Undone")).toBeNull();
  });
  it("loads workout history until it reaches before today", () => {
    const at = (h: number) => new Date(2026, 9, 13, h).getTime();
    const day = new Date(2026, 9, 13, 23).getTime();
    const workout = (id: string, trainedAt: number) => ({
      _id: id,
      trainedAt,
      muscleIds: [overview.muscles[0]._id],
      note: "",
    });
    Object.assign(mocks.history, {
      results: [workout("w1", at(9)), workout("w2", at(7))],
      status: "CanLoadMore",
    });
    const props = { now: day, water: [], meals: [], muscles: overview.muscles };
    const view = render(<DayTimeline {...props} />);
    expect(mocks.history.loadMore).toHaveBeenCalledWith(8);
    mocks.history.loadMore.mockClear();
    Object.assign(mocks.history, {
      results: [...mocks.history.results, workout("w0", at(-3))],
    });
    view.rerender(<DayTimeline {...props} />);
    expect(mocks.history.loadMore).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^Trained /)).toHaveLength(2);
  });
  it("offers no photo restart for a stalled photo-less meal", () => {
    const stalled = {
      ...meals[0],
      photoUrl: null,
      analysis: { status: "analyzing" as const, startedAt: now - 120_000 },
    };
    render(
      <FeedbackProvider>
        <Meals meals={[stalled]} totals={mealTotals([])} now={now} />
      </FeedbackProvider>,
    );
    expect(screen.queryByText("Restart analysis")).toBeNull();
    expect(screen.getByText(/delete the meal and log it again/)).toBeTruthy();
  });
  it("saves the edited description before re-analysis", async () => {
    render(
      <FeedbackProvider>
        <Meals meals={meals} totals={mealTotals(meals[0].items)} now={now} />
      </FeedbackProvider>,
    );
    const input = screen.getByLabelText("Meal description");
    await userEvent.clear(input);
    await userEvent.type(input, "Tofu and rice");
    await userEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(mocks.mutation).toHaveBeenCalledWith({
      id: meals[0]._id,
      description: "Tofu and rice",
    });
    expect(mocks.action).toHaveBeenCalledWith({ id: meals[0]._id });
    expect(mocks.mutation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.action.mock.invocationCallOrder[0],
    );
  });
  it("creates renderable mobile QA artifacts from the shipped screens", () => {
    const totals = mealTotals(meals[0].items);
    const screens = {
      today: (
        <Today
          now={now}
          overview={overview}
          waterMl={500}
          totals={totals}
          mealCount={1}
          water={[]}
          meals={[]}
          pendingMeals={0}
          onTab={() => {}}
        />
      ),
      train: <Train muscles={overview.muscles} now={now} />,
      water: <Water entries={entries} goal={2500} now={now} />,
      meals: <Meals meals={meals} totals={totals} now={now} />,
    };
    const css = readFileSync(
      resolve(process.cwd(), "app/globals.css"),
      "utf8",
    ).replace('@import "tailwindcss";', "");
    for (const [tab, content] of Object.entries(screens)) {
      const html = renderToStaticMarkup(
        <FeedbackProvider>
          <div className="app-shell">
            <header className="topbar">
              <Brand />
              <span className="pill amber">QA fixture</span>
            </header>
            <main id="main-content">
              <div className="date-line">Tuesday, October 13</div>
              {content}
            </main>
            <nav className="tabbar">
              {["today", "train", "water", "meals"].map((label) => (
                <button key={label} className={label === tab ? "active" : ""}>
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </FeedbackProvider>,
      );
      writeFileSync(
        `/tmp/daywell-ui-${tab}.html`,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daywell ${tab} QA fixture</title><style>${css}</style></head><body>${html}</body></html>`,
      );
      expect(html).toContain('id="main-content"');
    }
  });
});
