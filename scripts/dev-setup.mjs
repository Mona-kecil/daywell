import { execFileSync } from "node:child_process";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createECDH,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { parseEnv } from "node:util";

const filename = ".env.local";
const cliEnv = { ...process.env, CONVEX_AGENT_MODE: "anonymous" };
function readEnv() {
  return existsSync(filename) ? parseEnv(readFileSync(filename, "utf8")) : {};
}
function assertLocal(env) {
  if (env.CONVEX_DEPLOYMENT && !env.CONVEX_DEPLOYMENT.startsWith("anonymous:"))
    throw new Error("dev:setup requires an anonymous local Convex deployment.");
  if (
    env.NEXT_PUBLIC_CONVEX_URL &&
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(env.NEXT_PUBLIC_CONVEX_URL).hostname,
    )
  )
    throw new Error("dev:setup refuses a remote Convex URL.");
  if (process.env.CONVEX_DEPLOY_KEY || process.env.CONVEX_SELF_HOSTED_URL)
    throw new Error("Remove deployment overrides before local setup.");
}
function convex(args, capture = false) {
  return execFileSync("npx", ["convex", ...args], {
    env: cliEnv,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}
assertLocal(readEnv());
assertLocal(process.env);
let running = false;
const url = readEnv().NEXT_PUBLIC_CONVEX_URL;
if (url) {
  try {
    running = (
      await fetch(`${url}/version`, { signal: AbortSignal.timeout(2000) })
    ).ok;
  } catch {}
}
if (!running) {
  try {
    convex(["dev", "--once", "--typecheck", "disable"], true);
  } catch (error) {
    if (!String(error.stderr).includes("Environment variable")) throw error;
    console.log(
      "Local deployment created; installing auth environment before the next push.",
    );
  }
}
const env = readEnv();
assertLocal(env);
if (!env.CONVEX_DEPLOYMENT?.startsWith("anonymous:"))
  throw new Error("No anonymous deployment configured.");
const privateKey = env.DEV_AUTH_PRIVATE_JWK
  ? createPrivateKey({
      key: JSON.parse(env.DEV_AUTH_PRIVATE_JWK),
      format: "jwk",
    })
  : generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const privateJwk = {
  ...privateKey.export({ format: "jwk" }),
  kid: "daywell-dev",
  alg: "RS256",
  use: "sig",
};
const publicJwk = {
  ...createPublicKey(privateKey).export({ format: "jwk" }),
  kid: "daywell-dev",
  alg: "RS256",
  use: "sig",
};
function deploymentEnv(name) {
  try {
    return convex(["env", "get", name], true).trim() || undefined;
  } catch {
    return undefined;
  }
}
const deployedPrivate = deploymentEnv("VAPID_PRIVATE_KEY");
const vapid = createECDH("prime256v1");
const savedPrivate = env.VAPID_PRIVATE_KEY || deployedPrivate;
if (savedPrivate) vapid.setPrivateKey(Buffer.from(savedPrivate, "base64url"));
else vapid.generateKeys();
const vapidPrivate = vapid.getPrivateKey().toString("base64url");
const vapidPublic = vapid.getPublicKey().toString("base64url");
if (
  (deployedPrivate && deployedPrivate !== vapidPrivate) ||
  (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY !== vapidPublic) ||
  (env.VAPID_PUBLIC_KEY && env.VAPID_PUBLIC_KEY !== vapidPublic)
)
  throw new Error(
    "Local and Convex VAPID keys disagree. Align the existing keys before setup.",
  );
const deployedPublic = deploymentEnv("VAPID_PUBLIC_KEY");
if (deployedPublic && deployedPublic !== vapidPublic)
  throw new Error("Convex VAPID public and private keys disagree.");
const vapidSubject =
  env.VAPID_SUBJECT ||
  deploymentEnv("VAPID_SUBJECT") ||
  "mailto:dev@daywell.local";
let text = readFileSync(filename, "utf8");
for (const [name, value] of Object.entries({
  DEV_AUTH: "1",
  VAPID_PRIVATE_KEY: vapidPrivate,
  VAPID_PUBLIC_KEY: vapidPublic,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublic,
  VAPID_SUBJECT: vapidSubject,
  DEV_AUTH_PRIVATE_JWK: JSON.stringify(privateJwk),
})) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  text = pattern.test(text)
    ? text.replace(pattern, () => line)
    : `${text.trimEnd()}\n${line}\n`;
}
writeFileSync(filename, text, { mode: 0o600 });
chmodSync(filename, 0o600);
convex(["env", "set", "DEV_AUTH_JWKS", JSON.stringify({ keys: [publicJwk] })]);
convex(["env", "set", "WORKOS_CLIENT_ID", env.WORKOS_CLIENT_ID || ""]);
convex(["env", "set", "FDC_MODE", "fixture"]);
convex(["env", "set", "MEAL_VISION_PROVIDER", "fake"]);
for (const [name, value, present] of [
  ["VAPID_PRIVATE_KEY", vapidPrivate, deployedPrivate],
  ["VAPID_PUBLIC_KEY", vapidPublic, deployedPublic],
  ["VAPID_SUBJECT", vapidSubject, deploymentEnv("VAPID_SUBJECT")],
  ["PUSH_PROVIDER", "fake", deploymentEnv("PUSH_PROVIDER")],
]) {
  if (present) continue;
  try {
    convex(["env", "set", name, value], true);
  } catch {
    throw new Error(`Could not set ${name} on local Convex.`);
  }
  console.log(`Configured ${name} on local Convex.`);
}
console.log("VAPID keys configured; existing keys retained.");
if (!running) convex(["dev", "--once"]);
console.log("Dev auth configured. Start pnpm dev:all, then pnpm seed:demo.");
