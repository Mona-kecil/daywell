# Local development checks

The app runs at `http://localhost:3000/dev-login` without WorkOS keys. Convex runs at `http://127.0.0.1:3210` as the anonymous local deployment. The check run used Node 24.13.0 and pnpm 10.18.3 on October 13, 2026, in Asia/Jakarta.

## Commands and evidence

All required checks exited with code 0:

- `pnpm typecheck`: `✓ Types generated successfully`; TypeScript reported no errors.
- `pnpm lint`: ESLint reported no errors or warnings.
- `pnpm test`: `Test Files 7 passed (7)` and `Tests 43 passed (43)`.
- `pnpm build`: `✓ Compiled successfully in 2.8s`; TypeScript and page generation passed. The route list includes `/dev-login` and `/api/dev-token`.
- `pnpm dev:setup`: set `DEV_AUTH_JWKS`, `WORKOS_CLIENT_ID`, `FDC_MODE=fixture`, and `MEAL_VISION_PROVIDER=fake` on the anonymous deployment. A second run retained the RSA key. `.env.local` has mode `600` and remains ignored.
- `pnpm dev:all`: Next reported `✓ Ready in 338ms`; Convex reported `Convex functions ready!`. Both processes remain running for local use.
- `pnpm seed:demo`: returned `{"days":14,"meals":41,"muscles":11,"water":84,"workouts":11}`. Two runs returned the same counts. Unit tests also check old-photo deletion and other-user isolation.
- `pnpm shots`: wrote the eight seeded screenshots listed below.
- `pnpm e2e`: passed against the running app and local backend.

The final smoke-test summary was:

```text
Running 1 test using 1 worker
✓ 1 e2e/smoke.spec.ts:5:1 › water, back recovery, fixture-grounded photo meal, portion edits, and deletion (1.4s)
1 passed (1.8s)
```

The test adds 500 ml and checks the exact increase, logs back training and checks 0% recovery plus a countdown, then uploads a generated JPEG. The fake vision provider returns three foods. Fixture FDC grounding supplies nutrients and produces a ready meal with nonzero calories. Doubling the chicken portion changes the total by the fixture's nutrient amount. The test deletes each new drink, workout, and meal, then checks that the total or entry count returns to its baseline. No browser page errors occurred.

Raw output remains in the ignored `artifacts/checks/` directory: `typecheck.txt`, `lint.txt`, `test.txt`, `build.txt`, `dev-setup-repeat.txt`, `seed-demo.txt`, `shots.txt`, `e2e.txt`, `production.txt`, and `production-unit.txt`. These logs and screenshots are local artifacts, not committed files.

## Production route proof

The production browser test starts the built server with `NODE_ENV=production` and `DEV_AUTH=1`. The private RSA JWK remains in `.env.local`. Port 3100 was occupied, so the check used this command:

```sh
DAYWELL_PRODUCTION_PORT=3101 pnpm test:production
```

The output was:

```text
✓ 1 e2e/production.spec.ts:3:1 › production build returns 404 for dev routes even with DEV_AUTH=1 and a private key (59ms)
1 passed (1.3s)
```

The test checks GET `/dev-login`, GET `/api/dev-token`, and DELETE `/api/dev-token`. All return 404. Neither GET response sets a cookie.

The unit proof used this command:

```sh
pnpm exec vitest run tests/dev-auth.test.ts --reporter=verbose
```

The output includes:

```text
✓ tests/dev-auth.test.ts > development auth routes > production returns 404 for dev login and token routes even with DEV_AUTH=1 and a key 3ms
Test Files 1 passed (1)
Tests 3 passed (3)
```

## Screenshots

Each screenshot uses a 375×812 viewport and captures the full page. Sizes are bytes from the final seeded run:

```text
artifacts/shots/today-light.png    77064
artifacts/shots/train-light.png   204123
artifacts/shots/water-light.png   69326
artifacts/shots/meals-light.png   285788
artifacts/shots/today-dark.png    77373
artifacts/shots/train-dark.png    206756
artifacts/shots/water-dark.png    69577
artifacts/shots/meals-dark.png    289603
```

## Implementation details and limits

Convex's installed authentication type declares `jwks: string`; its CLI response schema uses `z.string()`. The [Convex custom JWT guide](https://docs.convex.dev/auth/advanced/custom-jwt) supports data URIs. The local backend accepted the base64 JWKS URI and authenticated the browser's RS256 tokens. No alternate JWKS server was needed.

The fixture responses are hand-built. The generation script copies their FDC IDs, descriptions, and per-100 g nutrients from the [USDA SR Legacy April 2018 archive](https://fdc.nal.usda.gov/download-datasets/). They are not presented as captured live search responses. Twelve foods pass through the existing FDC parser without HTTP. Unknown foods remain unmatched. Live search remains the default when `FDC_MODE` is absent.

The reset runs in `internal.demo.replace`. A public entry action calls that mutation because the installed CLI's `--identity` cannot invoke an internal action. Both functions require `DEV_AUTH_JWKS`, subject `dev-user`, and issuer `https://daywell.dev.local`. This is the only change to the seed's entry mechanism from the brief.

The app has four tabs and no separate Settings screen, so the run produces eight PNGs. The production check used port 3101 to avoid another process on 3100. No required check remains incomplete. Real WorkOS login and live USDA search were not part of this fixture-mode check run. The original WorkOS path remains in place.

No files under `components/body3d/` or `app/lab/` were created or edited. No subagents were created. `.env.local`, Convex local state, screenshots, and traces remain ignored.

## Commits and changed files

- `db2bc69` — Add local dev auth, USDA fixtures, and repeatable demo seed.
- `5e50255` — Add Chromium screenshots and app behavior smoke tests.
- The documentation commit adds this report and updates the README and original check report. Run `git log -1 --oneline` for its hash.

The changed files are:

```text
.env.example
.gitignore
README.md
app/api/dev-token/route.ts
app/dev-login/route.ts
app/page.tsx
components/providers.tsx
components/tracker.tsx
convex/_generated/api.d.ts
convex/auth.config.ts
convex/demo.ts
convex/demoSeed.ts
convex/mealActions.ts
docs/checks.md
docs/local-development-checks.md
e2e/helpers.ts
e2e/production.spec.ts
e2e/smoke.spec.ts
lib/dev-auth-config.ts
lib/dev-auth.ts
lib/fdc-fixtures.ts
lib/fdc.ts
lib/fixtures/fdc-search.json
package.json
playwright.config.ts
playwright.production.config.ts
pnpm-lock.yaml
proxy.ts
scripts/build-fdc-fixtures.py
scripts/dev-setup.mjs
scripts/seed-demo.ts
scripts/shots.ts
tests/demo-seed.test.ts
tests/dev-auth.test.ts
tests/fdc-fixtures.test.ts
```

Each commit used explicit staged paths and a staged filename check.
