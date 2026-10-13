# Daywell

Daywell tracks muscle recovery, water, and meals for one signed-in user. It has a Today overview and a bottom tab bar. Data lives in Convex. WorkOS AuthKit owns login.

The app uses Next.js 16.4.0, the stable version returned by the registry during setup, React 19, strict TypeScript, Tailwind 4, and pnpm. The vision provider defaults to `fake`, which returns sample foods and reads edited descriptions. The optional `openai` provider analyzes meal photos through the Responses API.

## Run the app

Use Node 22.11 or newer and pnpm 10.

```sh
pnpm install
cp .env.example .env.local
```

Convex writes its deployment name and public URL into the ignored `.env.local` file. Keep that file out of Git.

For WorkOS login, fill the credentials below, run `CONVEX_AGENT_MODE=anonymous npx convex dev` in one terminal and `pnpm dev` in another. Open `http://localhost:3000`.

## Local development without WorkOS

Use an anonymous local Convex deployment. No WorkOS keys or USDA key are needed.

```sh
pnpm install
pnpm exec playwright install chromium
pnpm dev:setup
pnpm dev:all
```

Keep `dev:all` running. It starts Convex at `http://127.0.0.1:3210` and Next.js at `http://localhost:3000`. Wait for **Convex functions ready** and **Ready**, then run these in a second terminal:

```sh
pnpm seed:demo
pnpm shots
pnpm e2e
```

Open `http://localhost:3000/dev-login` to sign in as `dev-user`. The normal sign-in screen also links there in dev-auth mode. Sign out clears the dev cookie. Tokens expire after five minutes; Convex requests a fresh token through `/api/dev-token`. The signed, HttpOnly session cookie lasts eight hours.

`dev:setup` bootstraps Convex if needed, generates an RSA keypair, and writes `DEV_AUTH=1` and `DEV_AUTH_PRIVATE_JWK` to the ignored `.env.local` with owner-only permissions. A second run reuses the key. It also creates or reuses VAPID keys, writes the public key for Next, and installs missing push configuration on local Convex. It sets `DEV_AUTH_JWKS`, `FDC_MODE=fixture`, and `MEAL_VISION_PROVIDER=fake` on Convex. It refuses cloud deployments and deployment-key overrides. These commands target local data; `seed:demo` replaces only the dev user's data and photos.

The seed writes 14 calendar days relative to the machine's date: a push/pull/legs rotation with rest days, six drinks per day, and two to four ready meals per day. Each meal has a generated JPEG in Convex storage and grounded foods. Totals use the app's nutrient helpers. Repeating the seed preserves the record counts: 11 workouts with 108 strength sets, 25 exercises, 84 drinks, 41 meals, and 11 muscles. Strength weights rise across the two-week history. The seed also writes 81 body check-ins across 90 local calendar days, with gaps, a gentle weight trend, sleep, mood, and energy.

`shots` and `e2e` require both dev servers to be running. Screenshots cover each navigation tab at 375×812 in light and dark mode, under `artifacts/shots/<tab>-<theme>.png`. There are four tabs and no separate Settings screen. The screenshot script discovers tabs from the navigation. The smoke test adds and deletes water, a back workout, and a photo meal; it checks recovery, grounded calories, and portion edits. Failure screenshots and traces live under `artifacts/e2e/`. All `artifacts/` files are ignored. Set `DAYWELL_URL` to use another local Next port. Browser checks use the `Asia/Jakarta` timezone; seed data uses the machine's timezone.

Both dev routes return 404 in a production build, even when dev environment variables remain set. To check the built server on port 3100:

```sh
pnpm build
pnpm test:production
```

If port 3100 is in use, set `DAYWELL_PRODUCTION_PORT=3101` for `test:production`.

The unit test also checks the production guard, unsigned-cookie rejection, token lifetime, and logout. When neither auth path is configured, the setup screen remains. WorkOS behavior uses the original AuthKit bridge when dev auth is off.

Convex's installed `src/server/authentication.ts` declares `customJwt.jwks` as a string, and `src/cli/lib/deployApi/types.ts` validates it with `z.string()`. The backend accepts the base64 data URI used here, as documented in the [Convex custom JWT guide](https://docs.convex.dev/auth/advanced/custom-jwt). Dev token signing is gated by Next's production `NODE_ENV`. The Convex dev JWT provider and demo seed require both `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL` to be HTTP(S) URLs with an exact loopback hostname (`localhost`, `127.0.0.1`, or `[::1]`). Missing, malformed, or mixed cloud/local URLs disable the dev provider. WorkOS providers keep their existing behavior. Keep `DEV_AUTH_JWKS` on the anonymous local deployment.

Fixture mode reads `lib/fixtures/fdc-search.json` through the same FDC parser as live mode. These are **hand-built search fixtures**, not captured live responses. Per-100 g nutrient values and FDC IDs come from the [USDA SR Legacy April 2018 CSV archive](https://fdc.nal.usda.gov/download-datasets/). Word matching handles query order and aliases; unknown foods remain unmatched. The fixture set covers rice, grilled chicken breast, broccoli, egg, oatmeal, banana, salmon, Greek yogurt, avocado, olive oil, whole-wheat bread, and cooked pasta. Rebuild it with `python3 scripts/build-fdc-fixtures.py`.

Live FDC search stays the default. `FDC_MODE=fixture` fails closed outside the same local deployment guard. Meal actions store the error "FDC_MODE=fixture requires a local Convex deployment. Set FDC_MODE=live for production." They do not return canned nutrition or call USDA in that state. Set `FDC_MODE=live` (or remove it) on production. To switch the running local deployment:

```sh
CONVEX_AGENT_MODE=anonymous npx convex env set FDC_MODE live
```

The seed uses fixture nutrients so it stays repeatable even if live mode is enabled. Its entry action checks the local deployment URLs, `DEV_AUTH_JWKS`, subject `dev-user`, and issuer `https://daywell.dev.local`; the reset mutation repeats those checks and is internal. The CLI's impersonated identity cannot invoke an internal action, so the script calls the guarded action with `--identity`.

### Verified local deployment signal

On the running local Convex 1.46 backend, temporary internal query and action probes each returned `CONVEX_CLOUD_URL=http://127.0.0.1:3210` and `CONVEX_SITE_URL=http://127.0.0.1:3211`. A temporary top-level assertion in `auth.config.ts` required these exact values; `convex run --push` succeeded with the assertion active, proving both values were present during auth configuration evaluation. The probes and assertion were removed. A subsequent push and demo seed verified the guarded config. A signed RS256 dev token (without CLI impersonation) also read 25 exercises, 11 workouts, and 81 check-ins from the local backend after the guard was installed; an unauthenticated export request was rejected. No cloud deployment was changed or probed; non-local behavior is covered by tests.

Convex documents these [system environment variables](https://docs.convex.dev/production/environment-variables) and supports [canonical URL overrides](https://docs.convex.dev/production/custom-domains). The guard assumes deployment administrators keep those URLs accurate; it does not protect against an administrator deliberately setting both production URLs to loopback.

## Connect WorkOS AuthKit

Create or use your own WorkOS application. Enable the login methods you want. Register `http://localhost:3000/callback` as a redirect URI. Set the application homepage to `http://localhost:3000`.

Fill these values in `.env.local`.

- `WORKOS_CLIENT_ID`: your WorkOS application client ID.
- `WORKOS_API_KEY`: your WorkOS API key. Keep it on the server.
- `WORKOS_COOKIE_PASSWORD`: a random password of at least 32 characters. Generate one with `openssl rand -base64 32`.
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`: `http://localhost:3000/callback` for local development.
- `NEXT_PUBLIC_CONVEX_URL`: the URL written by the Convex CLI.
- `CONVEX_DEPLOYMENT`: the deployment name written by the Convex CLI.

Set the same WorkOS client ID on the Convex deployment. Read the value from your environment or enter it through your shell. Replace the placeholder before running the command.

```sh
npx convex env set WORKOS_CLIENT_ID '<your WorkOS client ID>'
```

Restart both development processes. Sign in through **Sign in or create an account**. WorkOS can create an account through its hosted login flow.

`convex/auth.config.ts` validates WorkOS JWTs against the client-specific JWKS endpoint. It accepts the two issuers in [Convex's AuthKit guide](https://docs.convex.dev/auth/authkit/). `proxy.ts` uses the installed `authkitProxy` API, which replaces middleware in Next.js 16. The callback uses `handleAuth`.

The installed `@convex-dev/workos` 0.0.3 helper targets `authkit-react`. This app uses the [official Next.js bridge](https://docs.convex.dev/auth/authkit/add-to-app): `AuthKitProvider`, `useAuth`, `useAccessToken`, and `ConvexProviderWithAuth`. The bridge passes fresh tokens and honors Convex's forced refresh requests. The installed package source and declarations were checked before wiring the APIs.

`WORKOS_API_KEY` is required by the Next.js server. A Convex WorkOS user-sync component would also need it in the deployment environment. This app uses the JWT subject as its user ID and does not install that component.

For a later Vercel deployment, set the Next.js variables in Vercel, update the WorkOS redirect URI to your HTTPS origin, and point the app at the intended Convex deployment. No hosted deployment was made during this task.

## Configure meal analysis

Set these variables on Convex, where the actions run.

```sh
npx convex env set MEAL_VISION_PROVIDER fake
npx convex env set USDA_FDC_API_KEY '<your USDA API key>'
```

An unset or blank USDA key falls back to `DEMO_KEY`. USDA documents smaller quotas for that key. The live check in this environment exhausted its quota and returned HTTP 429. Use your own key for daily use.

Meal photos resize to a maximum edge of 1280 pixels and convert to JPEG before upload. Upload tickets bind the user to the photo's base64 SHA-256 digest. The server checks the digest, content type, size, ticket expiry, and whether the file is already attached to a meal.

The create action stores an `analyzing` meal, calls the vision provider, and searches USDA for each item. It stores the FDC ID, food description, and per-100g nutrients. The search includes Foundation, SR Legacy, and Survey (FNDDS) foods. It selects the first relevance-ranked food with complete energy, protein, carbohydrate, and fat values.

Energy uses nutrient ID 1008, then 2047, then 2048. Energy must be in kcal and the macros must be in grams. Missing values leave the item unmatched. The app excludes unmatched foods from totals and labels them in the meal.

Changing grams scales the stored nutrients without an API call. Re-searching an item calls USDA. Re-analysis sends the stored photo and edited description to the provider. Revision numbers prevent old analysis results from overwriting newer edits. If an action stops before completion, **Restart analysis** appears after 90 seconds.

## OpenAI meal vision

Set these variables on Convex, where meal actions run:

```sh
npx convex env set MEAL_VISION_PROVIDER openai
npx convex env set OPENAI_API_KEY '<your OpenAI API key>'
npx convex env set OPENAI_VISION_MODEL '<your chosen vision-capable model>'
```

`OPENAI_VISION_MODEL` is required. Choose an available model that supports image input and structured outputs. No model name is hardcoded. Keep `OPENAI_API_KEY` on Convex; do not expose it through a `NEXT_PUBLIC_` variable. Switching back to `MEAL_VISION_PROVIDER=fake` requires neither OpenAI setting. `dev:setup` restores fake mode for local smoke tests.

The provider fetches the stored photo and sends a base64 data URL to the [Responses API image input](https://developers.openai.com/api/docs/guides/images-vision). This also supports local Convex storage URLs that OpenAI cannot fetch. It sends the optional edited description as text and treats it as ground truth. The prompt asks for each food's estimated grams and generic USDA-friendly search terms. The request uses `store: false` and [strict structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), with JSON Schema derived from `visionResultSchema`. Zod validates the returned meal data before USDA grounding.

Missing credentials or model, HTTP 401/429, model/request errors, incomplete or refused responses, invalid data, and a 45-second timeout produce messages in the existing meal error state. The timeout covers both the photo download and API request. The implementation uses raw `fetch`; no OpenAI SDK is installed. Contract tests stub every fetch. No live OpenAI call was made during implementation. Photo-based gram estimates remain estimates; users can edit portions through the existing meal workflow.

To add another provider, implement `MealVisionProvider` from `convex/mealVision/types.ts` and select it in `convex/mealVision/index.ts`. Its method is `analyze({ imageUrl: string, description?: string }): Promise<VisionResult>`, returning `{ description: string, items: { name: string, estimatedGrams: number, searchQuery: string }[] }`. The provider boundary validates the result. Keep fake as a local test option.

## Coach and push reminders

Coach settings, deterministic suggestions, and push reminders are available through Convex APIs. The UI integration contract is in [Coach API](docs/coach-api.md). Save an IANA time zone, register the browser subscription from a user click, then enable reminders. The check-in cron runs every 15 minutes. Each local day/slot sends at most once; DST gaps skip nonexistent times and repeated hours share one slot.

Push defaults to a fake sender that records calls. For delivery, set `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` on Convex; set matching `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Next. Keep the private key off the client. `pnpm dev:setup` generates and retains local keys. `/sw.js` handles notifications and clicks; it does not cache the app.

## Strength and body check-in APIs

The backend supports an exercise library, custom exercises, ordered sets, session history, estimated strength PRs, weekly muscle set counts, and daily weight/sleep/mood/energy check-ins. The UI contract is in [Wave D API](docs/wave-d-api.md). Strength sessions create the same workout and recovery links as muscle-only tracking. Deleting a workout also removes its strength sets.

## Data export

`api.exportData.all({})` returns a versioned JSON snapshot of the signed-in user's settings, muscles, workouts and sets, custom exercises, drinks, meals with nutrition totals, and body check-ins. Photos, push subscriptions, and internal bookkeeping are excluded. The exact shape and download flow are in [Wave D API](docs/wave-d-api.md).

## Use the tracker

- Today shows muscle readiness, water progress, and ready-meal totals.
- Train accepts multiple muscle groups, a local timestamp, and an optional note. Cooldowns can be edited. Deleting a workout restores the preceding training time. History loads in pages of ten.
- Water accepts 250 ml, 500 ml, or a custom amount. The daily goal starts at 2500 ml. Each entry can be deleted.
- Meals accepts a camera or library image. You can edit the description, re-analyze, change grams, remove foods, change a food match, retry an error, or delete the meal and photo.

The client passes `[startMs, endMs)` for its local calendar day. The clock refreshes every 15 seconds and on focus. Day ranges use calendar arithmetic, including daylight saving changes. Cooldowns use elapsed hours.

The app follows the device's light or dark mode and has a theme toggle. The layout reserves space for safe-area insets. The manifest includes 192px, 512px, and maskable PNG icons, plus an Apple touch icon. Install from the browser on localhost or an HTTPS origin. Offline support is outside this version.

## Check the app

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
CONVEX_AGENT_MODE=anonymous npx convex dev --once
pnpm test:fdc
```

To test actual local uploads, keep `CONVEX_AGENT_MODE=anonymous npx convex dev` running in another terminal, then run:

```sh
pnpm test:local
```

The local smoke script uses Convex's administrator CLI identity option for test users. It does not create login credentials. It uploads a generated JPEG, creates a meal through the public action, checks user isolation and unauthenticated rejection, then deletes the meal and photo. USDA failures remain visible as meal errors.

Unit tests use `convex-test` for database behavior and mock HTTP responses for deterministic USDA cases. `convex-test` omits file content type metadata, so actual upload claims are checked against the local backend. UI tests mock RPC hooks, use rendered forms, and check the description-save order before re-analysis. They also write static screen fixtures to `/tmp/daywell-ui-*.html` for layout QA. Those fixtures are not shipped routes.

`pnpm icons` regenerates the PNG icons from `public/icons/mark.svg`.

[Check results and limits](docs/checks.md) records commands, outputs, browser QA, deviations, and incomplete checks. [Created files](docs/files.txt) lists the tracked artifacts.
