Steps implementation on `feat/steps`, based on `e8961e6`.

The backend stores one cumulative count per user and local day. Both manual
and shortcut writes use the same count and calendar validation. No Convex
process was started or deployed. No agent was delegated work.

New public functions in `convex/steps.ts`:

- `set({ day, count, timeZone })` returns `{ day, steps }` with the stored integer.
- `remove({ day })` returns `null`, including when the owned day has no row.
- `setGoal({ goal })` accepts an integer from 1000 through 50000, or `null` to clear it.
- `week({ now, timeZone })` returns the following shape. `days` has seven entries in Monday-through-Sunday order.

```ts
{
  goal: number;
  today: { day: string; count: number | null };
  days: { day: string; count: number | null }[];
  weekTotal: number;
  daysAtGoal: number;
  streak: number;
  average28: number | null;
  best: { day: string; count: number } | null;
  lastSync: number | null;
}
```

Changed files and exports:

- `lib/steps.ts` adds `DEFAULT_STEP_GOAL`, `stepCount`, `stepGoal`, and `stepWeek`.
- `convex/steps.ts` adds `set`, `remove`, `setGoal`, and `week`.
- `convex/stepsModel.ts` adds `STEPS_LIMIT_MESSAGE`, `validStepDay`, `stepSettings`, `stepDays`, `allSteps`, `stepForDay`, and `upsertSteps`.
- `convex/schema.ts` adds the `steps` table, `by_user_day` and `by_user_source_updated` indexes, and optional `settings.stepGoal`.
- `convex/_generated/api.d.ts` adds the `steps` and `stepsModel` modules to the committed API type map.
- `convex/shortcuts.ts` extends `request` with kind `steps` and a success body `{ ok: true, day, steps }`.
- `convex/http.ts` adds `POST /shortcuts/steps` through the existing route handler.
- `lib/coach.ts` extends `Suggestion`, `CoachInput`, and `coachSuggestions` with steps.
- `convex/coachData.ts` extends `suggestionsFor` with the last seven local days of steps.
- `convex/validators.ts` adds `steps` to `pushPayload.kind`.
- `components/coach.tsx` adds one `KIND.steps` entry. Prettier expands the entry across seven lines. No other component changed.
- `lib/coach-chat.ts` extends `CoachSnapshotInput` and `buildCoachSnapshot` with `today.steps` when its count is known.
- `convex/coachChat.ts` extends `readReply` with today's step count and goal.
- `convex/exportData.ts` extends `all` with owned steps and a saved step goal.
- `convex/demo.ts` extends `replace` with step cleanup and deterministic seed counts over 60 local dates, with five missing dates.
- `tests/steps.test.ts` adds 40 tests, including comparison with the actual `e8961e6` coach over 1500 generated inputs.
- `tests/steps-backend.test.ts` adds 53 Convex tests for writes, HTTP, history, isolation, bounds, coach, chat, export, and demo reset.
- `tests/export.test.ts` adds `steps: []` to the existing empty-account export expectation. The expected category list grew by one. No other existing expectation changed.
- `scripts/verify-steps-mutations.mjs` adds three mutation probes and byte comparisons after each restore.
- `docs/steps-verification.md` records the contract, decisions, checks, and command results.

Read bounds and choices:

- Day and settings lookups accept one row and fetch two to detect overflow.
- The week history accepts 373 rows and fetches 374. This covers 366 prior dates, today, and up to six remaining week dates.
- Coach history accepts seven rows and fetches eight. Chat's day lookup accepts one and fetches two.
- Export and demo reset accept 10000 owned step rows and fetch 10001. Overflow throws `ConvexError("History exceeds steps limits.")`.
- The sync index selects one latest shortcut row across all owned dates. It orders by `updatedAt`, filters future creations, and excludes future update times in the index bounds. This selection needs one row and does not truncate a history aggregation.
- History excludes rows with `_creationTime > now` or `updatedAt > now`. Upserts replace rows, so a query before a later update omits that row rather than reconstructing its prior count.
- The best window includes today and its 364 prior dates. Equal counts choose the earlier day. Future local dates do not enter best or average28.
- The streak stops at 366 days. It starts today when today reaches the current goal, otherwise yesterday.
- Shortcut input requires a day or a time zone, like check-ins. An explicit day is preserved. Without a day, the supplied zone determines it. Day-bound validation uses the supplied zone, then the saved zone, then UTC. Removal uses the saved zone, then UTC, since its contract has no zone argument.
- Goal writes can create settings before tracker initialization, with the existing default water goal of 2500. Clearing a missing goal does not create settings.
- Demo steps use the caller's first explicit check-in day when supplied. Otherwise the saved zone and seed timestamp determine today. Seed updates use `args.now`, so counts, sources, and update times repeat across resets.
- Export and demo reset are the lifecycle lists in this tree. Searches for `cardioSessions`, `cardioHistory`, and deletion functions found no account-deletion function to extend.
- The generated API declaration is committed in prior feature changes. Its module map was edited to match that pattern. No codegen command ran.
- `node_modules` remains an untracked symlink. No environment file or `next-env.d.ts` was edited or staged.

Verification results before the final acceptance run:

- First focused run: `pnpm exec vitest run tests/steps.test.ts tests/steps-backend.test.ts`, exit 1. 86 passed, 3 failed. The failures exposed a deletion lookup that reused a history clock filter and a frozen test clock that preceded later writes.
- After the deletion lookup and test clock fixes, the same command exited 0. 89 tests passed in two files.
- After four more boundary and overflow tests, the same command exited 0. 93 tests passed in two files.
- The first full `pnpm exec vitest run` exited 0. 1495 tests passed in 121 files. No timeout or isolated rerun occurred.
- `pnpm exec tsc --noEmit -p .` exited 0 on all three runs before the final acceptance run.
- `pnpm exec eslint .` exited 0 before the final acceptance run.
- `git diff --check` exited 0 on both runs before the final acceptance run.

Mutation evidence from `node scripts/verify-steps-mutations.mjs`, exit 0:

- Change `remaining <= 4000` to `remaining <= 4001`. `pnpm exec vitest run tests/steps.test.ts -t "checks today's"` exited 1. One test failed, six passed, and 33 were skipped. The failure used a count of 3999 against a goal of 8000. Restore command `cmp -s lib/coach.ts <original-0>` exited 0.
- Change the steps window's `localMinutes >= 17 * 60` to `localMinutes > 17 * 60`. `pnpm exec vitest run tests/steps.test.ts -t "checks local minute"` exited 1. One test failed, three passed, and 36 were skipped. The failure used minute 1020. Restore command `cmp -s lib/coach.ts <original-1>` exited 0.
- Start the streak loop at 1 instead of 0. `pnpm exec vitest run tests/steps.test.ts -t "bounds a complete streak"` exited 1. One test failed and 39 were skipped. The result was 365 instead of 366. Restore command `cmp -s lib/steps.ts <original-2>` exited 0.

The script stores original bytes in a temporary directory inside this worktree,
restores them in `finally`, runs `/usr/bin/cmp`, and removes its temporary files.
The `<original-N>` names above stand for those temporary backup paths.

Final acceptance results after all three mutation restores:

- `pnpm exec tsc --noEmit -p .` exited 0.
- `pnpm exec eslint .` exited 0.
- `pnpm exec prettier --check components/coach.tsx convex/_generated/api.d.ts convex/coachChat.ts convex/coachData.ts convex/demo.ts convex/exportData.ts convex/http.ts convex/schema.ts convex/shortcuts.ts convex/steps.ts convex/stepsModel.ts convex/validators.ts lib/coach-chat.ts lib/coach.ts lib/steps.ts tests/export.test.ts tests/steps-backend.test.ts tests/steps.test.ts scripts/verify-steps-mutations.mjs docs/steps-verification.md` exited 0. All 20 touched files passed.
- `pnpm exec vitest run` exited 0. 1499 tests passed in 121 files in 58.45 seconds. No test timed out or required an isolated rerun.
- `git diff --check; git diff --numstat; git status --short; test -L node_modules; git diff -- next-env.d.ts` exited 0. The generated Next declaration has no diff.

Inspection and edit command record, in execution order. Commands that inspect
files or edit source have no test pass count. Each command below exited 0
unless its entry states another result. `python3 -` received a patch program on
standard input. File contents read by `cat` and `sed` are not repeated here.

1. `pwd && git status --short && git branch --show-current && command -v fff && command -v pnpm` exited 1. The branch was `feat/steps`; `fff` has MCP tools, not a CLI on PATH. Later searches used those MCP tools.
2. `cat /Users/monakecil/.codex/plugins/cache/pstack-claude/pstack/0.9.84/skills/typescript-best-practices/SKILL.md`.
3. `cat /Users/monakecil/.codex/plugins/cache/pstack-claude/pstack/0.9.84/skills/principle-type-system-discipline/SKILL.md`.
4. `command -v pnpm; git log -5 --oneline; git log -5 --oneline -- convex/_generated; cat convex/shortcuts.ts convex/http.ts convex/cardio.ts lib/cardio.ts convex/habits.ts`.
5. `cat convex/readiness.ts convex/historyClock.ts convex/coachData.ts lib/coach.ts` exited 1. The clock helper lives in `historyData.ts`; `historyClock.ts` does not exist.
6. `cat lib/coach-chat.ts convex/coachChat.ts convex/exportData.ts convex/demoSeed.ts convex/demo.ts convex/schema.ts convex/validators.ts`.
7. `cat convex/historyData.ts convex/exportData.ts convex/coachChat.ts lib/coach-chat.ts`.
8. `cat tests/readiness-coach.test.ts tests/readiness-backend.test.ts tests/shortcuts-backend.test.ts convex/_generated/api.d.ts convex/account.ts components/coach.tsx convex/demoSeed.ts package.json` exited 1. The shortcut tests live in `tests/shortcuts.test.ts`; there is no `convex/account.ts`.
9. `sed -n '190,345p' convex/coachChat.ts; cat lib/coach-chat.ts; cat tests/shortcuts-backend.test.ts` exited 1 for that missing test path.
10. `git ls-files tests convex; cat convex/cardioModel.ts; sed -n '1,100p' tests/cardio-backend.test.ts; cat vitest.config.ts; sed -n '155,195p' convex/coachChat.ts; sed -n '1,60p' convex/model.ts; cat lib/coach-time.ts`.
11. `cat tests/readiness-coach.test.ts; sed -n '1,240p' tests/shortcuts.test.ts; cat tests/export.test.ts; cat tests/demo-seed.test.ts`.
12. `command -v python3; sed -n '1,115p' convex/_generated/api.d.ts; sed -n '100,165p' tests/readiness-coach-backend.test.ts; cat convex/coach.ts`.
13. `python3 -` applied the schema and integration edits.
14. `sed -n '1,115p' tests/readiness-backend.test.ts; sed -n '1,95p' tests/readiness-coach-backend.test.ts; sed -n '1,30p' convex/demo.ts; cat convex/checkinModel.ts; git diff --stat`.
15. `pnpm exec prettier --write lib/steps.ts convex/steps.ts convex/stepsModel.ts convex/schema.ts convex/shortcuts.ts convex/http.ts lib/coach.ts convex/coachData.ts convex/validators.ts components/coach.tsx lib/coach-chat.ts convex/coachChat.ts convex/exportData.ts convex/demo.ts convex/_generated/api.d.ts tests/export.test.ts`.
16. `pnpm exec tsc --noEmit -p .`, exit 0.
17. `python3 -` fixed the baseline comparison module exports. `pnpm exec prettier --write tests/steps.test.ts tests/steps-backend.test.ts` exited 0.
18. First focused tests, recorded above, exit 1.
19. `pnpm exec tsc --noEmit -p .`, exit 0.
20. `python3 -` changed the deletion lookup and advanced the chat test clock. `pnpm exec prettier --write convex/stepsModel.ts convex/steps.ts tests/steps-backend.test.ts` exited 0.
21. Second focused tests, recorded above, exit 0 with 89 passes.
22. `python3 -` separated settings reads during writes from historical reads, narrowed the chat snapshot type, and made seed update times deterministic. `pnpm exec prettier --write lib/coach-chat.ts convex/stepsModel.ts convex/steps.ts convex/shortcuts.ts convex/demo.ts` exited 0.
23. `pnpm exec tsc --noEmit -p .`, `pnpm exec eslint .`, and the first full `pnpm exec vitest run` each exited 0. Test counts appear above.
24. `git diff --check; git diff -- convex/stepsModel.ts convex/steps.ts convex/coachData.ts convex/coachChat.ts lib/coach-chat.ts convex/demo.ts components/coach.tsx`.
25. `cat convex/steps.ts convex/stepsModel.ts; cat scripts/seed-demo.ts; git status --short`.
26. `cat /Users/monakecil/.codex/plugins/cache/pstack-claude/pstack/0.9.84/skills/technical-writing/SKILL.md`.
27. `cat /Users/monakecil/.codex/plugins/cache/pstack-claude/pstack/0.9.84/skills/unslop/SKILL.md`.
28. `python3 -` made the seed fallback use local today. An `apply_patch` call for tests then failed because its expected context had changed; no test edit from that call landed. A corrected patch added the tests.
29. `sed -n '550,700p' tests/steps-backend.test.ts; command -v node; command -v cmp`.
30. `pnpm exec prettier --write convex/demo.ts tests/steps-backend.test.ts scripts/verify-steps-mutations.mjs`.
31. Third focused tests, recorded above, exit 0 with 93 passes.
32. `git diff -- convex/shortcuts.ts convex/schema.ts convex/exportData.ts lib/coach.ts convex/_generated/api.d.ts tests/export.test.ts; git diff --check`.
33. `node scripts/verify-steps-mutations.mjs`, exit 0. Its three test commands exited 1, and its three `cmp -s` commands exited 0, as recorded above.
34. `pnpm exec prettier --write docs/steps-verification.md`, exit 0.
35. The final TypeScript, ESLint, Prettier, Vitest, and diff inspection commands appear in the final acceptance results above. Each exited 0.

The handoff also runs `git add` with the 20 paths listed above,
`git diff --staged --name-only`, `git diff --staged --check`, a staged-path
guard, and `git commit`. The final reply records the commit result.

The compatibility test runs `git show e8961e6:lib/coach.ts` through
`execFileSync` on each run. It exited 0 on each run that included that test.
The test transpiles that source with TypeScript and compares the serialized
suggestions for each generated input with no steps input.
