# Acceptance checks

The app source, unit tests, and mobile screens are implemented. Local checks pass except the live USDA grounding check. That check returns HTTP 429. WorkOS login needs the owner's credentials before it can be exercised.

## Commands and results

Run `node scripts/checks.mjs` to record the first five checks. Stop a running Convex development process before using that script, because the anonymous CLI cannot start a second backend on port 3210. Full command outputs are linked below.

1. `pnpm typecheck` runs `next typegen && tsc --noEmit`. Exit code 0. Output includes `✓ Types generated successfully`. [Full output](check-output/typecheck.txt).
2. `pnpm lint` runs `eslint .`. Exit code 0, with no errors or warnings. [Full output](check-output/lint.txt).
3. `pnpm test` runs `vitest run`. Exit code 0. Output includes `Test Files 4 passed (4)` and `Tests 36 passed (36)`. [Full output](check-output/test.txt).
4. `pnpm build` runs `next build`. Exit code 0. Output includes `✓ Compiled successfully`, the TypeScript step, and five generated pages. [Full output](check-output/build.txt).
5. `CONVEX_AGENT_MODE=anonymous npx convex dev --once` typechecks and deploys to the local backend at `http://127.0.0.1:3210`. Exit code 0 after setting a blank WorkOS client ID. [Full output](check-output/convex.txt).
6. `pnpm test:fdc` calls `groundFood` with `DEMO_KEY`, then scales the match to 150 g. Exit code 1. The required successful live result remains incomplete. [Full output](fdc-live.txt).
7. The README contains **Plugging in a real vision provider**, with `convex/mealVision/real.ts`, the provider interface, the selection branch, and `MEAL_VISION_PROVIDER=real`.

The final live-grounding output contains:

```text
Error: USDA search failed (429). Please retry later.
    at groundFood (.../lib/fdc.ts:22:11)
    at async <anonymous> (.../scripts/fdc-live.ts:3:14)

Node.js v24.13.0
ELIFECYCLE Command failed with exit code 1.
```

A diagnostic response included these quota headers:

```text
HTTP 429
x-ratelimit-limit: 10
x-ratelimit-remaining: 0
retry-after: 33882
```

Earlier requests returned HTTP 400 from nginx. Some diagnostic requests succeeded after encoding spaces as `%20` and sending JSON request headers. The grounding code includes those changes. A subsequent browser call through a bundled copy of `groundFood` also returned HTTP 429.

Before the quota reached zero, a diagnostic GET returned a real match for cooked white rice. That diagnostic request bypassed `groundFood`, so it does not satisfy check 6. The retained response had FDC ID 2708422, description `Rice, white, cooked, glutinous`, and these per-100g nutrients: 96 kcal, 2.01 g protein, 20.97 g carbohydrate, and 0.19 g fat. [The retained match and values scaled by the actual nutrient helper](fdc-diagnostic-match.json) records the arithmetic for 150 g. No replacement nutrition values were invented to pass the live check.

Rerun `pnpm test:fdc` when the DEMO_KEY quota resets. The production action can use the owner's USDA API key through `USDA_FDC_API_KEY`.

## Local Convex setup

The first anonymous deployment attempt reported this error:

```text
Environment variable WORKOS_CLIENT_ID is used in auth config file but its value was not set.
```

[The full first-attempt output](initial-convex-error.txt) includes the local configuration and error. The CLI configured an anonymous local deployment. It did not create a cloud project.

This command allows a deployment without fabricated WorkOS credentials:

```sh
CONVEX_AGENT_MODE=anonymous npx convex env set WORKOS_CLIENT_ID ''
```

The auth config returns no JWT issuers for that blank value. Queries, mutations, and actions still reject unauthenticated calls. The real client ID must be supplied before normal app login can work.

An acceptance rerun found the running smoke-test backend on port 3210. [That error](convex-port-error.txt) was resolved by stopping the process before the final deployment.

A process inventory printed an ephemeral local backend credential in tool output. The local test deployment and its data were discarded. The CLI then generated a fresh local deployment before the final acceptance run. The credential was never placed in source files or committed. The discarded data included failed upload test artifacts.

## Tests and browser checks

The 36 tests cover recovery at zero, half, full, beyond full, future timestamps, and never trained. They cover nutrient scaling, the 1008 to 2047 to 2048 energy fallback, missing nutrients, units, and unmatched results. Day tests cover local midnight in Jakarta and 23-hour and 25-hour days in New York.

Convex tests cover authentication, record isolation, idempotent per-user defaults, invalid quantities, half-open day queries, deletion, previous workout restoration, meal status transitions, edited descriptions, portion changes without an API call, re-search, errors, retries, item removal, and stale analysis results. UI tests exercise quick water, custom water, Today navigation, and saving the edited description before re-analysis.

`pnpm exec tsx scripts/local-smoke.ts` ran against the actual local backend while `CONVEX_AGENT_MODE=anonymous npx convex dev` was running. [Full output](local-smoke.txt):

```text
PASS: real local JPEG upload, SHA-256 claim, and authenticated action-to-mutation calls
Meal status: error (USDA search failed (429). Please retry later.)
PASS: another user cannot read the meal
PASS: unauthenticated query rejected
PASS: meal and stored photo deleted
```

The real upload check caught a hex-versus-base64 checksum mismatch. The client, ticket validator, and smoke script now use the base64 digest that Convex exposes in `_storage`. The local check passed after that fix.

The T3 browser checked the actual setup page at 375 px, including the theme toggle. Static fixtures rendered from the shipped Today, Train, Water, and Meals components also had a 375 px document width at a 375 px viewport. Train, Water, and Meals had no buttons below 44 px in height or 40 px in width. Meals was inspected in dark mode. These are fixture layout checks, not an authenticated browser session.

The browser ran the actual photo helper on a generated 3000 by 1500 image. Output:

```json
{
  "width": 1280,
  "height": 640,
  "type": "image/jpeg",
  "size": 5561,
  "sha256": "2wSDZwQRmQt855n/mU5tNXHKce+JnfP7c4cUOPQmA7w="
}
```

The manifest endpoint returned HTTP 200. PNG metadata showed 192 by 192, 512 by 512, maskable 512 by 512, and Apple 180 by 180. Installing on a physical phone was not tested. Safe-area support was checked in the CSS. No offline service worker was added.

## Deviations and limits

- Check 6 did not produce a successful result through `groundFood`. USDA returned HTTP 400 during diagnosis, then HTTP 429 with no quota remaining. The retained diagnostic match is labeled as separate evidence.
- WorkOS credentials were not supplied. Login, account creation, token refresh, logout, and a complete signed-in browser session remain untested against WorkOS.
- The app uses the official current Next.js auth bridge, with `ConvexProviderWithAuth`. The installed `@convex-dev/workos` helper targets `authkit-react`, so its wrapper is not used. Both requested packages are installed. The package types and source were checked.
- A blank WorkOS client ID was stored on the anonymous local backend to allow deployment with authentication disabled. This does not enable unauthenticated data access. The owner must replace the blank value for login.
- The timestamp, amount, and text boundaries have limits: cooldowns at most 720 hours, water entries at most 10,000 ml, goals at most 20,000 ml, portions at most 10,000 g, workout notes at most 2,000 characters, and descriptions at most 4,000 characters. Photos have a 30 MB input limit and 3 MB uploaded JPEG limit. These limits reject invalid or oversized input.
- UI browser checks used static fixtures because a real WorkOS session was unavailable. The unit UI tests use mocked RPC hooks. The upload smoke test uses the local administrator CLI identity mechanism.

No cloud project, Vercel deployment, real vision provider, LLM SDK, or offline support was added. Only `.env.example` is tracked. The generated `.env.local` and `.convex` state remain ignored. No subagents were created.

## Commits and files

The implementation commits are:

- `5b9a8e4` — Initialize Next.js stack and tested daily tracking logic.
- `60dab4e` — Add user-scoped Convex tracking and meal analysis lifecycle.
- `344d355` — Build mobile tracker screens, AuthKit login, and PWA assets.
- `4a530ce` — Expand USDA source links to a 44px tap target.
- `bf7ae9a` — Correct recovery countdowns for future workout timestamps.

The final documentation commit records this report and raw check outputs. Run `git log --oneline` for its hash. Every commit used explicit staged paths and a staged filename check.

[Created files](files.txt) lists every tracked file. The directory was empty before implementation. Runtime dependency folders, generated Next.js build output, and local Convex data are ignored.
