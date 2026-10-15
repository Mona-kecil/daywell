import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const probes = [
  {
    name: "remaining 4000 → 4001",
    file: "lib/coach.ts",
    before: "input.steps.goal - input.steps.today <= 4000",
    after: "input.steps.goal - input.steps.today <= 4001",
    test: "checks today's",
  },
  {
    name: "17:00 inclusive → exclusive",
    file: "lib/coach.ts",
    before: "localMinutes >= 17 * 60 &&\n    localMinutes < 22 * 60",
    after: "localMinutes > 17 * 60 &&\n    localMinutes < 22 * 60",
    test: "checks local minute",
  },
  {
    name: "streak loop skips its first day",
    file: "lib/steps.ts",
    before: "for (let i = 0; i < 366; i++)",
    after: "for (let i = 1; i < 366; i++)",
    test: "bounds a complete streak",
  },
];

const scratch = mkdtempSync(join(root, ".steps-mutations-"));
try {
  for (const [index, probe] of probes.entries()) {
    const target = join(root, probe.file);
    const original = readFileSync(target);
    const source = original.toString();
    if (source.split(probe.before).length !== 2)
      throw new Error(`Expected one mutation site: ${probe.name}`);
    const backup = join(scratch, `original-${index}`);
    writeFileSync(backup, original);
    try {
      writeFileSync(target, source.replace(probe.before, probe.after));
      const args = [
        "exec",
        "vitest",
        "run",
        "tests/steps.test.ts",
        "-t",
        probe.test,
      ];
      console.log(`\nMutation: ${probe.name}`);
      console.log(`pnpm ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
      const result = spawnSync("pnpm", args, {
        cwd: root,
        encoding: "utf8",
      });
      console.log(result.stdout + result.stderr);
      console.log(`Test exit: ${result.status}`);
      if (
        result.error ||
        result.status !== 1 ||
        !result.stdout.includes("failed")
      )
        throw new Error(
          `Mutation did not produce a test failure: ${probe.name}`,
        );
    } finally {
      writeFileSync(target, original);
      const compared = spawnSync("cmp", ["-s", target, backup], { cwd: root });
      console.log(
        `cmp -s ${probe.file} <original-${index}>: ${compared.status}`,
      );
      if (compared.error || compared.status !== 0)
        throw new Error(`Restore differs from original: ${probe.file}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
