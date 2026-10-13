import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/auth-configured";
export async function GET() {
  if (!authConfigured()) return redirect("/");
  return redirect(await getSignInUrl());
}
