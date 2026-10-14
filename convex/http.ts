import { httpRouter, ROUTABLE_HTTP_METHODS } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashToken } from "./shortcuts";

const http = httpRouter();

for (const route of [
  { path: "/shortcuts/water", method: "POST", kind: "water" },
  { path: "/shortcuts/checkin", method: "POST", kind: "checkin" },
  { path: "/shortcuts/today", method: "GET", kind: "today" },
] as const) {
  const handler = httpAction(async (ctx, request) => {
    if (request.method !== route.method)
      return Response.json(
        { error: "Method not allowed." },
        { status: 405, headers: { Allow: route.method } },
      );
    const authorization = request.headers.get("Authorization");
    const token = /^Bearer (dw_[A-Za-z0-9_-]{43})$/i.exec(
      authorization ?? "",
    )?.[1];
    if (!token)
      return Response.json(
        { error: "Invalid or missing token." },
        { status: 401 },
      );
    const result = await ctx.runMutation(internal.shortcuts.request, {
      hash: await hashToken(token),
      kind: route.kind,
      body: route.method === "POST" ? await request.text() : "",
      timeZone: new URL(request.url).searchParams.get("timeZone") ?? undefined,
    });
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  });
  for (const method of ROUTABLE_HTTP_METHODS)
    http.route({ path: route.path, method, handler });
}

export default http;
