import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const checks = [
  ["typecheck", "pnpm", ["typecheck"]],
  ["lint", "pnpm", ["lint"]],
  ["test", "pnpm", ["test"]],
  ["build", "pnpm", ["build"]],
  ["convex", "npx", ["convex", "dev", "--once"]],
];
mkdirSync("docs/check-output", { recursive: true });
let failed = false;
for (const [name, command, args] of checks) {
  const label = `${name === "convex" ? "CONVEX_AGENT_MODE=anonymous " : ""}${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", CONVEX_AGENT_MODE: "anonymous" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(
    `docs/check-output/${name}.txt`,
    `$ ${label}\n${output}\nExit code: ${result.status}\n`,
  );
  console.log(`${label}: exit ${result.status}`);
  console.log(output);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
