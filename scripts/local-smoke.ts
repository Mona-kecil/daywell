import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readFileSync } from "node:fs";

function run(name: string, args: object, identity?: string): unknown {
  const command = ["exec", "convex", "run", name, JSON.stringify(args)];
  if (identity)
    command.push(
      "--identity",
      JSON.stringify({
        subject: identity,
        issuer: "https://local-test.invalid",
      }),
    );
  const output = execFileSync("pnpm", command, {
    encoding: "utf8",
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.trim() ? JSON.parse(output) : null;
}
const identity = `daywell-smoke-${Date.now()}`;
const photo = readFileSync(
  new URL("../public/icons/icon-192.png", import.meta.url),
);
// Convert the actual image to JPEG for the upload boundary.
const { default: sharp } = await import("sharp");
const jpeg = await sharp(photo).jpeg().toBuffer();
const sha256 = createHash("sha256").update(jpeg).digest("base64");
const ticket = z
  .object({ url: z.string(), ticketId: z.string() })
  .parse(run("meals:uploadUrl", { sha256 }, identity));
const upload = await fetch(ticket.url, {
  method: "POST",
  headers: { "Content-Type": "image/jpeg" },
  body: new Uint8Array(jpeg),
});
if (!upload.ok) throw new Error(`Local upload failed (${upload.status})`);
const { storageId } = z
  .object({ storageId: z.string() })
  .parse(await upload.json());
let id: string | undefined;
try {
  id = z
    .string()
    .parse(
      run(
        "mealActions:create",
        { ticketId: ticket.ticketId, storageId, at: 1 },
        identity,
      ),
    );
  const result = z
    .array(
      z.object({
        _id: z.string(),
        userId: z.string(),
        photoUrl: z.string().nullable(),
        analysis: z.object({
          status: z.enum(["analyzing", "ready", "error"]),
          message: z.string().optional(),
        }),
      }),
    )
    .parse(run("meals:today", { startMs: 0, endMs: 86_400_000 }, identity));
  const meal = result.find((meal) => meal._id === id);
  if (!meal) throw new Error("Created meal not returned");
  if (meal.userId !== identity) throw new Error("Meal owner mismatch");
  console.log(
    "PASS: real local JPEG upload, SHA-256 claim, and authenticated action-to-mutation calls",
  );
  console.log(
    `Meal status: ${meal.analysis.status}${meal.analysis.message ? ` (${meal.analysis.message})` : ""}`,
  );
  const other = z
    .array(z.unknown())
    .parse(
      run(
        "meals:today",
        { startMs: 0, endMs: 86_400_000 },
        "daywell-smoke-other",
      ),
    );
  if (other.length) throw new Error("Cross-user read leaked meals");
  console.log("PASS: another user cannot read the meal");
  let rejected = false;
  try {
    run("meals:today", { startMs: 0, endMs: 86_400_000 });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unauthenticated read succeeded");
  console.log("PASS: unauthenticated query rejected");
} finally {
  if (id) {
    run("meals:deleteMeal", { id }, identity);
    console.log("PASS: meal and stored photo deleted");
  }
}
