import { NextRequest, NextResponse } from "next/server";
import { DEV_COOKIE, devAuthConfigured } from "@/lib/dev-auth-config";
import { signDevToken } from "@/lib/dev-auth";

export async function GET(request: NextRequest) {
  if (!devAuthConfigured()) return new NextResponse(null, { status: 404 });
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(DEV_COOKIE, await signDevToken(true), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 8 * 3600,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
