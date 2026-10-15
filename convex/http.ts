import { httpRouter, ROUTABLE_HTTP_METHODS } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashToken } from "./shortcuts";

const http = httpRouter();
const noStoreHeaders = { "Cache-Control": "no-store" };
const maxBodyBytes = 4096;

async function readBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > maxBodyBytes)
    return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

for (const route of [
  { path: "/shortcuts/water", method: "POST", kind: "water" },
  { path: "/shortcuts/steps", method: "POST", kind: "steps" },
  { path: "/shortcuts/checkin", method: "POST", kind: "checkin" },
  { path: "/shortcuts/today", method: "GET", kind: "today" },
] as const) {
  const handler = httpAction(async (ctx, request) => {
    if (request.method !== route.method)
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { ...noStoreHeaders, Allow: route.method } },
      );
    const authorization = request.headers.get("Authorization");
    const token = /^Bearer\s+(dw_[A-Za-z0-9_-]{43})$/i.exec(
      authorization?.trim() ?? "",
    )?.[1];
    if (!token)
      return Response.json(
        { error: "Invalid or missing token." },
        { status: 401, headers: noStoreHeaders },
      );
    try {
      const body = route.method === "POST" ? await readBody(request) : "";
      if (body === null)
        return Response.json(
          { error: "Request body is too large." },
          { status: 413, headers: noStoreHeaders },
        );
      const result = await ctx.runMutation(internal.shortcuts.request, {
        hash: await hashToken(token),
        kind: route.kind,
        body,
        timeZone:
          new URL(request.url).searchParams.get("timeZone") ?? undefined,
      });
      return Response.json(result.body, {
        status: result.status,
        headers: noStoreHeaders,
      });
    } catch (error) {
      console.error("Shortcuts request failed", error);
      return Response.json(
        { error: "Something went wrong. Try again." },
        { status: 500, headers: noStoreHeaders },
      );
    }
  });
  for (const method of ROUTABLE_HTTP_METHODS)
    http.route({ path: route.path, method, handler });
}

export default http;
