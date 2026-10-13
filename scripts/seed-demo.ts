import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import sharp from "sharp";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

const env = parseEnv(readFileSync(".env.local", "utf8"));
if (
  !env.CONVEX_DEPLOYMENT?.startsWith("anonymous:") ||
  env.DEV_AUTH !== "1" ||
  !env.NEXT_PUBLIC_CONVEX_URL ||
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(env.NEXT_PUBLIC_CONVEX_URL).hostname,
  ) ||
  process.env.CONVEX_DEPLOY_KEY ||
  process.env.CONVEX_SELF_HOSTED_URL ||
  (process.env.CONVEX_DEPLOYMENT &&
    !process.env.CONVEX_DEPLOYMENT.startsWith("anonymous:"))
)
  throw new Error(
    "Demo seed requires pnpm dev:setup and an anonymous local deployment.",
  );
const now = Date.now();
const days = Array.from({ length: 14 }, (_, offset) => {
  const date = new Date(now);
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
});
const photos = await Promise.all(
  ["#cfac72", "#e5ad70", "#dd9077", "#9fb57d"].map(async (color) => {
    const svg = `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#e5e9df"/><ellipse cx="320" cy="240" rx="230" ry="190" fill="#fffdf7"/><ellipse cx="320" cy="240" rx="185" ry="150" fill="${color}"/><circle cx="245" cy="220" r="60" fill="#65945b"/><circle cx="385" cy="270" r="65" fill="#f0d999"/><text x="320" y="435" text-anchor="middle" font-size="22" fill="#354139">Daywell demo plate</text></svg>`;
    return (
      await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
    ).toString("base64");
  }),
);
let result: string;
try {
  result = execFileSync(
    "npx",
    [
      "convex",
      "run",
      "demoSeed:run",
      JSON.stringify({ now, days, photos }),
      "--identity",
      JSON.stringify({ subject: DEV_USER, issuer: DEV_ISSUER }),
    ],
    {
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
} catch {
  throw new Error(
    "Demo seed failed. Read the Convex error above; check that pnpm dev:all has finished pushing functions.",
  );
}
console.log(result.trim());
