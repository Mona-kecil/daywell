# Wave D backend checks

Workspace: `/Users/monakecil/.t3/scratch/2026-10-13-i-kind-of-want-to-6349e50b`, branch `main`. Commands ran on 2026-10-14. No dependencies were added. No UI files or secrets were committed. `next-env.d.ts` remains uncommitted.

## Acceptance evidence

All five commands exited 0 against the completed backend.

`pnpm typecheck`:

```text
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
```

TypeScript emitted no diagnostics.

`pnpm lint`:

```text
> eslint .
```

ESLint emitted no diagnostics.

`pnpm exec vitest run`:

```text
 Test Files  18 passed (18)
      Tests  102 passed (102)
   Start at  00:38:02
   Duration  2.10s (tests 39%, environment 23%, import 23%, transform 13%, worker 2%)
```

The original 88 tests pass along with 14 new tests: three production/local guard tests, five strength tests, four check-in tests, and two export tests. The existing demo tests also check 108 sets, progressive bench weights, 81 check-ins, and preservation of another user's check-in.

`pnpm build`:

```text
▲ Next.js 16.4.0 (Turbopack)
✓ Compiled successfully in 2.7s
  Finished TypeScript in 3.4s ...
✓ Generating static pages using 7 workers (10/10) in 159ms
  Finalizing page optimization ...
```

`pnpm seed:demo`, against the running local backend:

```json
{
  "checkins": 81,
  "days": 14,
  "meals": 41,
  "muscles": 11,
  "water": 84,
  "workouts": 11
}
```

npm emitted existing pnpm environment-configuration warnings for `verify-deps-before-run` and `_jsr-registry`. The seed exited 0. An earlier seed attempt hit the old backend argument validator; pushing the completed functions with `convex run --push` resolved it. No schema rollback or data workaround was needed.

## Local backend verification

Temporary internal query/action probes each returned these exact values:

```json
{
  "cloud": "http://127.0.0.1:3210",
  "site": "http://127.0.0.1:3211"
}
```

A temporary top-level assertion in `convex/auth.config.ts` required both exact values. `convex run --push` exited 0 with that assertion active, proving the signal exists during auth configuration evaluation. The assertion and probes were removed, and the guarded config was pushed.

The local export query was parsed and its counts asserted, without printing record contents:

```text
Local export verified: {"checkins": 81, "meals": 41, "muscles": 11, "sets": 108, "version": 1, "water": 84, "workouts": 11}
```

It also checked that every demo meal has positive calorie totals and that the serialized export contains no storage ID. A temporary client check signed a dev JWT with the existing ignored local key and used `ConvexHttpClient`, without CLI identity impersonation:

```text
Local dev JWT verified: signed RS256 token accepted; 25 exercises, 11 workouts, 81 check-ins.
Local export auth verified: unauthenticated request rejected.
```

The check script was removed. No token, private key, or `.env.local` content was printed or committed.

During the direct HTTP check, neither port 3210 nor 3000 accepted connections. `pnpm dev:all` was restarted and left running. It reported Next Ready and Convex functions ready; `lsof` then confirmed both ports listening. No running stack was deliberately stopped. A final seed succeeded against that running stack.

## Scope and limits

Non-local fixture rejection and dev provider exclusion were tested with cloud URL values. No cloud deployment was probed or changed. The guard assumes administrators keep canonical deployment URLs accurate; Convex supports overriding them. Both system URLs must be HTTP(S) with exact loopback hosts, with no URL credentials. Missing/mixed/malformed URLs fail the guard. The README documents these assumptions and links the Convex sources.

Export uses a single query snapshot and follows Convex read/response limits; oversized accounts fail rather than truncate. History reads all sets for the selected exercise to compute all-time PRs. No chunked export, import, live USDA call, cloud auth test, or UI integration was performed. These are outside the requested backend implementation. API and UI sequencing details are in `docs/wave-d-api.md`.
