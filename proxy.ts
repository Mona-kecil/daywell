import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { authConfigured } from "./lib/auth-configured";
const workos = authkitProxy();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!authConfigured()) return NextResponse.next();
  return workos(request, event);
}
export const config = { matcher: ["/", "/callback", "/login"] };
