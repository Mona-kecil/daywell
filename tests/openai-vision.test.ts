import { afterEach, describe, expect, it, vi } from "vitest";
import { openai } from "../convex/mealVision/openai";
import { mealVisionProvider } from "../convex/mealVision";
const result = {
  description: "Roasted chicken with rice",
  items: [
    {
      name: "chicken",
      estimatedGrams: 150,
      searchQuery: "chicken breast roasted",
    },
  ],
};
const imageUrl = "http://127.0.0.1:3210/api/storage/photo";
function response(value: unknown = result, status = "completed") {
  return new Response(
    JSON.stringify({
      status,
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
  );
}
function setup(makeResponse: () => Response = () => response()) {
  vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
  vi.stubEnv("OPENAI_VISION_MODEL", "configured-test-model");
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    url === imageUrl
      ? new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        })
      : makeResponse(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("OpenAI Responses meal vision contract", () => {
  it("sends fetched image data, edited text, configured model, and a strict schema", async () => {
    const fetchMock = setup();
    vi.stubEnv("MEAL_VISION_PROVIDER", "openai");
    expect(
      await mealVisionProvider().analyze({
        imageUrl,
        description: "Rice with chicken",
      }),
    ).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({
      Authorization: "Bearer test-placeholder",
      "Content-Type": "application/json",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    if (typeof options?.body !== "string")
      throw new Error("Expected JSON request body");
    const body: unknown = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: "configured-test-model",
      store: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: "data:image/jpeg;base64,AQID",
              detail: "auto",
            },
            {
              type: "input_text",
              text: "User's meal description: Rice with chicken",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meal_vision",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["description", "items"],
            properties: {
              description: { type: "string", minLength: 1, maxLength: 4000 },
              items: {
                maxItems: 30,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "estimatedGrams", "searchQuery"],
                  properties: {
                    estimatedGrams: {
                      type: "number",
                      exclusiveMinimum: 0,
                      maximum: 10000,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(body).toHaveProperty(
      "instructions",
      expect.stringContaining("per-item gram estimate"),
    );
    expect(body).toHaveProperty(
      "instructions",
      expect.stringContaining("USDA-friendly"),
    );
    expect(body).toHaveProperty(
      "instructions",
      expect.stringContaining("ground truth"),
    );
  });
  it("supports photo-only input and keeps fake available", async () => {
    const fetchMock = setup();
    expect(await openai.analyze({ imageUrl })).toEqual(result);
    const options = fetchMock.mock.calls[1][1];
    expect(options?.body).toContain("Estimate the foods and portions");
    vi.stubEnv("MEAL_VISION_PROVIDER", "fake");
    expect(
      (await mealVisionProvider().analyze({ imageUrl, description: "Rice" }))
        .items,
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("fails without credentials or a model before any fetch", async () => {
    const fetchMock = setup();
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(openai.analyze({ imageUrl })).rejects.toThrow(
      "OPENAI_API_KEY",
    );
    vi.stubEnv("OPENAI_API_KEY", "test-placeholder");
    vi.stubEnv("OPENAI_VISION_MODEL", "  ");
    await expect(openai.analyze({ imageUrl })).rejects.toThrow(
      "OPENAI_VISION_MODEL",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [401, "rejected the API key"],
    [429, "rate limit or quota"],
    [400, "OPENAI_VISION_MODEL"],
    [404, "OPENAI_VISION_MODEL"],
    [503, "unavailable"],
  ])(
    "maps HTTP %s without echoing the response body",
    async (status, message) => {
      setup(() => new Response("upstream sensitive text", { status }));
      await expect(openai.analyze({ imageUrl })).rejects.toThrow(
        String(message),
      );
      await expect(openai.analyze({ imageUrl })).rejects.not.toThrow(
        "upstream sensitive text",
      );
    },
  );
  it("rejects malformed, invalid, incomplete, missing, and refused output", async () => {
    for (const makeResponse of [
      () => new Response("not JSON"),
      () =>
        response({
          ...result,
          items: [{ ...result.items[0], estimatedGrams: -1 }],
        }),
      () => response(result, "incomplete"),
      () => new Response(JSON.stringify({ status: "completed", output: [] })),
      () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "refused" }],
              },
            ],
          }),
        ),
    ]) {
      setup(makeResponse);
      await expect(openai.analyze({ imageUrl })).rejects.toThrow(
        /invalid|did not complete|could not analyze/,
      );
    }
  });
  it("rejects unavailable, non-image, empty, and oversized photos without API calls", async () => {
    const fetchMock = setup();
    for (const photo of [
      new Response("missing", { status: 404 }),
      new Response("text", { headers: { "content-type": "text/plain" } }),
      new Response("", { headers: { "content-type": "image/jpeg" } }),
      new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
        headers: { "content-type": "image/jpeg" },
      }),
    ]) {
      fetchMock.mockResolvedValueOnce(photo);
      await expect(openai.analyze({ imageUrl })).rejects.toThrow(
        /meal photo|Meal photo/,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("maps network errors", async () => {
    const fetchMock = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    await expect(openai.analyze({ imageUrl })).rejects.toThrow(
      "Could not fetch",
    );
    setup();
    const broken = vi.fn<typeof fetch>(async (url) => {
      if (url === imageUrl)
        return new Response("photo", {
          headers: { "content-type": "image/jpeg" },
        });
      throw new TypeError("network");
    });
    vi.stubGlobal("fetch", broken);
    await expect(openai.analyze({ imageUrl })).rejects.toThrow(
      "Could not reach OpenAI",
    );
  });
  it.each(["photo", "api"])(
    "aborts after 45 seconds during %s fetch and clears the timer",
    async (phase) => {
      vi.useFakeTimers();
      setup();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (url, options) => {
          if (phase === "api" && url === imageUrl)
            return new Response("photo", {
              headers: { "content-type": "image/jpeg" },
            });
          return new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        }),
      );
      const check = expect(openai.analyze({ imageUrl })).rejects.toThrow(
        "timed out after 45 seconds",
      );
      await vi.advanceTimersByTimeAsync(45_000);
      await check;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
