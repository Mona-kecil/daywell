import { NextRequest, NextResponse } from "next/server";
import { DEV_COOKIE, devAuthConfigured } from "@/lib/dev-auth-config";
import { signDevToken, validDevSession } from "@/lib/dev-auth";

export async function GET(request: NextRequest) {
  if (!devAuthConfigured()) return new NextResponse(null, { status: 404 });
  const session = request.cookies.get(DEV_COOKIE)?.value;
  if (!session || !(await validDevSession(session)))
    return NextResponse.json(
      { token: null },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  return NextResponse.json(
    { token: await signDevToken() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function DELETE() {
  if (!devAuthConfigured()) return new NextResponse(null, { status: 404 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(DEV_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
