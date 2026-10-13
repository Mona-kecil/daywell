# Daywell

Daywell tracks muscle recovery, water, and meals for one signed-in user. It has a Today overview and a bottom tab bar. Data lives in Convex. WorkOS AuthKit owns login.

The app uses Next.js 16.4.0, the stable version returned by the registry during setup, React 19, strict TypeScript, Tailwind 4, and pnpm. The vision provider is `fake`. It returns sample foods and reads edited descriptions. It does not inspect image pixels.

## Run the app

Use Node 22.11 or newer and pnpm 10.

```sh
pnpm install
cp .env.example .env.local
```

Convex writes its deployment name and public URL into the ignored `.env.local` file. Keep that file out of Git.

To work without account credentials, run these commands in order. The first command can stop with the missing WorkOS client ID error shown in [the check report](docs/checks.md).

```sh
CONVEX_AGENT_MODE=anonymous npx convex dev --once
CONVEX_AGENT_MODE=anonymous npx convex env set WORKOS_CLIENT_ID ""
CONVEX_AGENT_MODE=anonymous npx convex dev
```

A blank client ID gives the local deployment no accepted JWT issuers. Every data function still requires an authenticated identity. The browser shows setup instructions until you supply credentials. This flow creates a local anonymous deployment, without a cloud project.

In a second terminal, start Next.js.

```sh
pnpm dev
```

Open `http://localhost:3000`.

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

## Plugging in a real vision provider

Add one file: `convex/mealVision/real.ts`.

Export a provider that implements `MealVisionProvider` from `convex/mealVision/types.ts`. Its only method is:

```ts
analyze(input: { imageUrl: string; description?: string }): Promise<VisionResult>
```

Return this shape:

```ts
{
  description: string;
  items: {
    name: string;
    estimatedGrams: number;
    searchQuery: string;
  }
  [];
}
```

When `description` is supplied, treat that text as ground truth. Derive foods from the edited text. Keep the photo as context. The boundary validates the result with `visionResultSchema`.

Import the provider in `convex/mealVision/index.ts` and add a `real` selection branch. Keep `fake` as an option. Set the deployment environment variable:

```sh
npx convex env set MEAL_VISION_PROVIDER real
```

Set any provider credentials on Convex. No OpenAI, Anthropic, or other LLM SDK is installed. No real vision provider is implemented in this version.

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
