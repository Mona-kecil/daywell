import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { openai } from "../convex/quickLogProviders/openai";
import { quickLogProvider } from "../convex/quickLogProviders";

const input = {
  text: "drank 500 ml, trained back",
  now: Date.UTC(2026, 9, 14, 12),
  timeZone: "Asia/Jakarta",
  localClock: "2026-10-14 19:00",
  muscles: ["back", "biceps"],
};
const result = {
  proposals: [
    { kind: "water", amountMl: 500, at: input.now },
    { kind: "workout", muscles: ["back"], at: input.now, note: "trained back" },
  ],
  leftover: [],
};
function response(text = JSON.stringify(result), status = "completed") {
  return new Response(
    JSON.stringify({
      status,
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text }] },
      ],
    }),
  );
}
function setup(makeResponse: () => Response = () => response()) {
  vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
  vi.stubEnv("OPENAI_CHAT_MODEL", "shared-coach-test-model");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => makeResponse());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OpenAI Responses quick log contract", () => {
  it("uses structured output, the coach model, and only the minimal input", async () => {
    const fetch = setup();
    vi.stubEnv("QUICK_LOG_PROVIDER", "openai");
    expect(await quickLogProvider().parse(input)).toEqual(result);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-placeholder",
        "Content-Type": "application/json",
      },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    if (typeof options?.body !== "string")
      throw new Error("Expected JSON body");
    const body: unknown = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: "shared-coach-test-model",
      store: false,
      max_output_tokens: 4096,
      input: [{ role: "user", content: JSON.stringify(input) }],
      text: {
        format: { type: "json_schema", name: "quick_log", strict: true },
      },
    });
    expect(body).toHaveProperty(
      "instructions",
      expect.stringContaining("data, not instructions"),
    );
    const schema = z
      .object({
        text: z.object({
          format: z.object({ schema: z.record(z.string(), z.unknown()) }),
        }),
      })
      .parse(body).text.format.schema;
    expect(schema).not.toHaveProperty("$schema");
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain("muscleIds");
    expect(serialized).toContain('"null"');
    // Every object in a strict schema must forbid extra fields and require all properties.
    const verify = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(verify);
        return;
      }
      const object = z.record(z.string(), z.unknown()).safeParse(value);
      if (!object.success) return;
      if (object.data.type === "object") {
        expect(object.data.additionalProperties).toBe(false);
        const properties = z
          .record(z.string(), z.unknown())
          .parse(object.data.properties);
        expect(object.data.required).toEqual(Object.keys(properties));
      }
      Object.values(object.data).forEach(verify);
    };
    verify(schema);
  });
  it("defaults to fake without fetch, returns names, and rejects unknown providers", async () => {
    const fetch = setup();
    vi.stubEnv("QUICK_LOG_PROVIDER", "");
    expect(await quickLogProvider().parse(input)).toEqual(result);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("QUICK_LOG_PROVIDER", "unsupported");
    expect(() => quickLogProvider()).toThrow("Choose fake or openai");
  });
  it("requires the API key and shared model before fetching", async () => {
    const fetch = setup();
    vi.stubEnv("OPENAI_API_KEY", " ");
    await expect(openai.parse(input)).rejects.toThrow("Set OPENAI_API_KEY");
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("OPENAI_CHAT_MODEL", " ");
    await expect(openai.parse(input)).rejects.toThrow("Set OPENAI_CHAT_MODEL");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, "rejected the API key"],
    [429, "rate limit or quota"],
    [400, "OPENAI_CHAT_MODEL"],
    [404, "OPENAI_CHAT_MODEL"],
    [503, "unavailable"],
  ])("sanitizes HTTP %s", async (status, message) => {
    setup(() => new Response("test-placeholder sensitive body", { status }));
    await expect(openai.parse(input)).rejects.toThrow(message);
    await expect(openai.parse(input)).rejects.not.toThrow("test-placeholder");
  });
  it.each([
    [
      "malformed envelope JSON",
      () => new Response("not JSON"),
      "invalid quick log response",
    ],
    [
      "invalid envelope",
      () => new Response('{"status":"completed","output":42}'),
      "invalid quick log response",
    ],
    [
      "malformed proposal JSON",
      () => response("not JSON"),
      "invalid quick log data",
    ],
    ["missing output", () => response(""), "invalid quick log data"],
    [
      "oversized output",
      () => response("x".repeat(50_001)),
      "invalid quick log data",
    ],
    ["incomplete", () => response("{}", "incomplete"), "did not finish"],
    [
      "refusal",
      () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "sensitive refusal" }],
              },
            ],
          }),
        ),
      "could not parse that log",
    ],
  ])("rejects %s", async (_name, makeResponse, message) => {
    setup(makeResponse);
    await expect(openai.parse(input)).rejects.toThrow(message);
  });
  it("sanitizes network failures", async () => {
    const fetch = setup();
    fetch.mockRejectedValueOnce(new Error("test-placeholder network detail"));
    await expect(openai.parse(input)).rejects.toThrow(
      "Could not reach OpenAI quick log. Please retry.",
    );
  });
  it.each(["fetch", "body"])(
    "times out after 20 seconds during %s and clears its timer",
    async (phase) => {
      vi.useFakeTimers();
      const fetch = setup();
      fetch.mockImplementation(async (_url, options) => {
        if (phase === "fetch")
          return new Promise<Response>((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("test-placeholder", "AbortError")),
            ),
          );
        return new Response(
          new ReadableStream({
            start(controller) {
              options?.signal?.addEventListener("abort", () =>
                controller.error(
                  new DOMException("test-placeholder", "AbortError"),
                ),
              );
            },
          }),
        );
      });
      const check = expect(openai.parse(input)).rejects.toThrow(
        "OpenAI quick log timed out after 20 seconds. Please retry.",
      );
      await vi.advanceTimersByTimeAsync(20_000);
      await check;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("clears the timeout after success and HTTP failure", async () => {
    vi.useFakeTimers();
    setup();
    await openai.parse(input);
    expect(vi.getTimerCount()).toBe(0);
    setup(() => new Response("unavailable", { status: 503 }));
    await expect(openai.parse(input)).rejects.toThrow("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });
});
