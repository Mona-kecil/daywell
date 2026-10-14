// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoachChatSheet } from "../components/coach-chat";
import { FeedbackProvider } from "../components/ui";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(args: unknown) => Promise<null>>(async () => null),
  messages: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useQuery: () => mocks.messages,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.messages = [];
});

const at = new Date(2026, 9, 14, 9, 30).getTime();
const open = () =>
  render(
    <FeedbackProvider>
      <CoachChatSheet open onClose={() => {}} />
    </FeedbackProvider>,
  );

describe("coach chat", () => {
  it("asks a starter question with the device time zone", async () => {
    open();
    await userEvent.click(
      screen.getByRole("button", { name: "Can I train legs tomorrow?" }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith({
      text: "Can I train legs tomorrow?",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("sends on Enter, keeps Shift+Enter for new lines, and clears the box", async () => {
    open();
    const box = screen.getByLabelText("Your question");
    await userEvent.type(box, "Protein?{Shift>}{Enter}{/Shift}today");
    expect(mocks.mutation).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Protein?\ntoday" }),
    );
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the coach typing and blocks another question meanwhile", async () => {
    mocks.messages = [
      { _id: "u", role: "user", text: "Hi", at, status: "done" },
      { _id: "a", role: "assistant", text: "", at, status: "pending" },
    ];
    open();
    expect(screen.getByText("Coach is typing")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Your question"), "More{Enter}");
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows a failed answer's reason", () => {
    mocks.messages = [
      { _id: "u", role: "user", text: "Hi", at, status: "done" },
      {
        _id: "a",
        role: "assistant",
        text: "",
        at,
        status: "error",
        error: "OpenAI rate limit or quota reached.",
      },
    ];
    open();
    expect(screen.getByRole("alert").textContent).toBe(
      "OpenAI rate limit or quota reached.",
    );
  });

  it("asks for a second tap before clearing the conversation", async () => {
    mocks.messages = [
      { _id: "u", role: "user", text: "Hi", at, status: "done" },
    ];
    open();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear conversation" }),
    );
    expect(mocks.mutation).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Tap again to clear" }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith({});
  });
});
