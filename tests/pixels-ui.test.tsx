// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
import { YearPixelsView } from "../components/pixels";

afterEach(cleanup);

const checkins = [
  { day: "2026-08-04", mood: 5, energy: 4, sleepHours: 8.25 },
  { day: "2026-08-05", mood: 4, energy: 4 },
  { day: "2026-08-06", mood: 5 },
  { day: "2026-09-14", mood: 2, sleepHours: 5.5 },
  { day: "2026-10-13", mood: 3, energy: 1, sleepHours: 6 },
  { day: "2026-10-14", mood: 4 },
];
const readout = () =>
  document.querySelector(".pixels-readout")?.textContent ?? "";

describe("Year in pixels", () => {
  it("summarises the year and reads days from the keyboard", async () => {
    render(<YearPixelsView today="2026-10-14" checkins={checkins} />);
    expect(readout()).toBe("Average 3.8 of 5 over 6 days · best month August");
    // Nov 2025 through Oct 14 2026; later October days aren't drawn.
    expect(document.querySelectorAll("rect.pixel")).toHaveLength(348);
    expect(document.querySelector("rect.today")?.classList).toContain("pix-4");

    const grid = screen.getByRole("img", { name: /Mood by day/ });
    grid.focus();
    await userEvent.keyboard("{End}");
    expect(readout()).toBe("Wed, Oct 14 · Good, 4 of 5");
    await userEvent.keyboard("{ArrowLeft}");
    expect(readout()).toBe("Tue, Oct 13 · Okay, 3 of 5");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    // Today is the last day there is.
    expect(readout()).toBe("Wed, Oct 14 · Good, 4 of 5");
    await userEvent.keyboard("{ArrowUp}");
    expect(readout()).toBe("Mon, Sep 14 · Low, 2 of 5");
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}");
    expect(readout()).toBe("Thu, Aug 13 · No mood logged");
    expect(document.querySelector("rect.active")?.classList).toContain("pix-0");
    await userEvent.keyboard("{Home}{ArrowLeft}");
    expect(readout()).toBe("Sat, Nov 1 · No mood logged");
  });

  it("switches to energy and sleep", async () => {
    render(<YearPixelsView today="2026-10-14" checkins={checkins} />);
    await userEvent.click(screen.getByRole("button", { name: "Energy" }));
    expect(readout()).toBe("Average 3 of 5 over 3 days");
    expect(screen.getByText("Charged")).toBeTruthy();
    screen.getByRole("img", { name: /Energy by day/ }).focus();
    await userEvent.keyboard("{End}{ArrowLeft}");
    expect(readout()).toBe("Tue, Oct 13 · Drained energy, 1 of 5");

    await userEvent.click(screen.getByRole("button", { name: "Sleep" }));
    expect(readout()).toBe("Average 6.6 h over 3 nights");
    screen.getByRole("img", { name: /Sleep by day/ }).focus();
    await userEvent.keyboard("{End}{ArrowUp}");
    expect(readout()).toBe("Mon, Sep 14 · 5.5 h sleep");
    expect(document.querySelector("rect.active")?.classList).toContain("pix-2");
  });

  it("says so when nothing is logged", () => {
    render(<YearPixelsView today="2026-10-14" checkins={[]} />);
    expect(readout()).toBe("No mood logged in the last 12 months yet.");
  });
});
