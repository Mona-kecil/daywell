// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { ProgressPhotos, compareLine } from "../components/progress-photos";

type Ref = Parameters<typeof getFunctionName>[0];
const state = vi.hoisted(() => ({
  photos: undefined as unknown,
  calls: [] as [string, unknown][],
  fail: "",
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.photos,
  useMutation: (ref: Ref) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      state.calls.push([name, args]);
      if (state.fail === name) return Promise.reject(new Error("Nope."));
      if (name === "progress:uploadUrl")
        return Promise.resolve({ url: "https://up.test/x", ticketId: "t1" });
      return Promise.resolve(null);
    };
  },
}));
vi.mock("../lib/photo", () => ({
  downscalePhoto: async () => new Blob(["jpeg"], { type: "image/jpeg" }),
  photoDigest: async () => "digest",
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

const now = new Date(2026, 9, 15, 9, 0).getTime();
type Pose = "front" | "side" | "back";
const photo = (
  id: string,
  pose: Pose,
  day: string,
  weightKg: number | null = null,
) => ({
  id: id as Id<"progressPhotos">,
  url: `https://example.test/${id}.jpg`,
  pose,
  day,
  takenAt: now,
  weightKg,
});
// Newest first, as the query returns them.
const photos = [
  photo("f3", "front", "2026-10-14", 80.2),
  photo("s1", "side", "2026-09-01"),
  photo("f2", "front", "2026-09-15", 82),
  photo("f1", "front", "2025-12-20", 84.5),
];

const fetchMock = vi.fn();
beforeEach(() => {
  state.photos = undefined;
  state.calls = [];
  state.fail = "";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ storageId: "st1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pose = (name: RegExp) =>
  within(screen.getAllByRole("group", { name: "Pose" })[0]).getByRole(
    "button",
    { name },
  );
const choose = async (lastModified: number) => {
  const input = document.querySelector<HTMLInputElement>("#progress-photo")!;
  const file = new File(["x"], "me.jpg", { type: "image/jpeg", lastModified });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

describe("progress photos", () => {
  it("stays out of the way while loading and invites a first photo", () => {
    const { container } = render(<ProgressPhotos now={now} />);
    expect(container.innerHTML).toBe("");
    cleanup();

    state.photos = [];
    render(<ProgressPhotos now={now} />);
    expect(
      screen.getByText(
        "Private photos of you, to compare over time. Only you can see them.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Same spot, same light, same time of day works best."),
    ).toBeTruthy();
    expect(screen.getByText("Add front photo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  });

  it("shows one pose at a time, newest first", () => {
    state.photos = photos;
    render(<ProgressPhotos now={now} />);
    expect(screen.getByText("4 photos, only visible to you.")).toBeTruthy();
    const grid = () =>
      within(document.querySelector(".progress-grid") as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"));
    // Dates from another year carry the year.
    const old = new Date(2025, 11, 20).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(grid()).toEqual([
      `Front photo, ${new Date(2026, 9, 14).toLocaleDateString([], { month: "short", day: "numeric" })}, 80.2 kg`,
      `Front photo, ${new Date(2026, 8, 15).toLocaleDateString([], { month: "short", day: "numeric" })}, 82 kg`,
      `Front photo, ${old}, 84.5 kg`,
    ]);
    expect(pose(/^Front/).ariaPressed).toBe("true");
    expect(pose(/^Side/).textContent).toBe("Side, 1 photos");
    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy();

    fireEvent.click(pose(/^Side/));
    expect(grid()).toHaveLength(1);
    expect(screen.getByText("Add side photo")).toBeTruthy();
    // One photo is nothing to compare against.
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();

    fireEvent.click(pose(/^Back/));
    expect(screen.getByText("No back photos yet.")).toBeTruthy();
  });

  it("uploads a library photo on the day it was taken", async () => {
    state.photos = photos;
    render(<ProgressPhotos now={now} />);
    await choose(new Date(2026, 9, 12, 20, 0).getTime());
    const sheet = screen.getByRole("dialog", { name: "New progress photo" });
    const date = within(sheet).getByLabelText("Taken on") as HTMLInputElement;
    expect(date.value).toBe("2026-10-12");
    expect(date.max).toBe("2026-10-15");
    expect(
      within(sheet).getByRole("button", { name: "Front" }).ariaPressed,
    ).toBe("true");

    fireEvent.click(within(sheet).getByRole("button", { name: "Side" }));
    await act(async () => {
      fireEvent.click(
        within(sheet).getByRole("button", { name: "Save photo" }),
      );
    });
    expect(state.calls[0]).toEqual([
      "progress:uploadUrl",
      { sha256: "digest" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://up.test/x", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: expect.any(Blob),
    });
    expect(state.calls[1]).toEqual([
      "progress:add",
      {
        ticketId: "t1",
        storageId: "st1",
        pose: "side",
        day: "2026-10-12",
        takenAt: expect.any(Number),
      },
    ]);
    // The sheet closes onto the pose just saved.
    expect(
      screen.queryByRole("dialog", { name: "New progress photo" }),
    ).toBeNull();
    expect(pose(/^Side/).ariaPressed).toBe("true");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("never dates a photo after today", async () => {
    state.photos = [];
    render(<ProgressPhotos now={now} />);
    await choose(now + 3 * 86_400_000);
    const sheet = screen.getByRole("dialog", { name: "New progress photo" });
    const date = within(sheet).getByLabelText("Taken on") as HTMLInputElement;
    expect(date.value).toBe("2026-10-15");
    const save = within(sheet).getByRole("button", { name: "Save photo" });
    fireEvent.change(date, { target: { value: "2026-10-16" } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(date, { target: { value: "" } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the photo when the upload fails", async () => {
    state.photos = [];
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<ProgressPhotos now={now} />);
    await choose(now);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    });
    expect(state.calls.map((c) => c[0])).toEqual(["progress:uploadUrl"]);
    expect(
      screen.getByRole("dialog", { name: "New progress photo" }),
    ).toBeTruthy();
  });

  it("asks twice before deleting", async () => {
    state.photos = photos;
    render(<ProgressPhotos now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /80\.2 kg$/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("80.2 kg that day")).toBeTruthy();
    const del = within(sheet).getByRole("button", { name: "Delete photo" });
    fireEvent.click(del);
    expect(state.calls).toEqual([]);
    expect(del.textContent).toBe("Tap again to delete");
    // Moving away resets the confirm.
    fireEvent.blur(del);
    expect(del.textContent).toBe("Delete photo");
    fireEvent.click(del);
    await act(async () => {
      fireEvent.click(del);
    });
    expect(state.calls).toEqual([["progress:remove", { id: "f3" }]]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("compares the oldest and newest photo with a divider", () => {
    state.photos = photos;
    render(<ProgressPhotos now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const sheet = screen.getByRole("dialog", { name: "Compare front" });
    const before = within(sheet).getByLabelText("Before") as HTMLSelectElement;
    const after = within(sheet).getByLabelText("After") as HTMLSelectElement;
    expect([before.value, after.value]).toEqual(["f1", "f3"]);
    expect(within(sheet).getByText("−4.3 kg over 298 days.")).toBeTruthy();

    const range = within(sheet).getByRole("slider", {
      name: "Before and after divider",
    });
    expect(range.getAttribute("aria-valuetext")).toBe("Showing 50% after");
    fireEvent.change(range, { target: { value: "20" } });
    expect(range.getAttribute("aria-valuetext")).toBe("Showing 80% after");
    const stage = sheet.querySelector<HTMLElement>(".compare-stage")!;
    expect(stage.style.getPropertyValue("--reveal")).toBe("20%");

    // Picking them the wrong way round still reads forward in time.
    fireEvent.change(before, { target: { value: "f3" } });
    fireEvent.change(after, { target: { value: "f2" } });
    expect(within(sheet).getByText("−1.8 kg over 29 days.")).toBeTruthy();
  });
});

describe("compareLine", () => {
  const a = photo("a", "front", "2026-10-01", 80);
  it("says how weight moved and over how long", () => {
    expect(compareLine(a, photo("b", "front", "2026-10-02", 80.44))).toBe(
      "+0.4 kg over 1 day.",
    );
    expect(compareLine(a, photo("b", "front", "2026-10-01", 80))).toBe(
      "Same weight on the same day.",
    );
    expect(compareLine(a, photo("b", "front", "2026-10-15"))).toBe(
      "Over 14 days.",
    );
    expect(compareLine(a, photo("b", "front", "2026-10-01"))).toBe(
      "Taken the same day.",
    );
  });
});
