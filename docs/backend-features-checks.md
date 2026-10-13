# Coach, push, and OpenAI backend checks

Run on October 14, 2026 in Asia/Jakarta from this tree, starting at `c939fa7`. No subagents were delegated. No UI files, `lib/insights.ts`, or app routes were edited. The existing development stack served Next on port 3000 and anonymous local Convex on 3210/3211.

## Verified checks

All required commands exited with code 0. Summary lines:

```text
pnpm typecheck
✓ Types generated successfully
(TypeScript reported no errors.)

pnpm lint
> eslint .
(Exited 0 with no lint errors or warnings.)

pnpm test
Test Files  14 passed (14)
Tests  88 passed (88)

pnpm build
✓ Compiled successfully in 2.9s
Finished TypeScript in 3.9s ...
✓ Generating static pages using 7 workers (10/10) in 181ms

pnpm e2e
Running 1 test using 1 worker
✓ 1 e2e/smoke.spec.ts:5:1 › water, back recovery, fixture-grounded photo meal, portion edits, and deletion (6.2s)
1 passed (6.8s)

pnpm dev:setup (first run)
VAPID keys configured; existing keys retained.
Dev auth configured. Start pnpm dev:all, then pnpm seed:demo.

pnpm dev:setup (second run)
VAPID keys configured; existing keys retained.
Dev auth configured. Start pnpm dev:all, then pnpm seed:demo.
Idempotence verified: .env.local unchanged; mode 600.
```

The first setup run generated missing VAPID values. A SHA-256 comparison across the second setup run proved that `.env.local` did not change; the digest and key values were not printed. A separate check compared the local public/private/subject values with Convex and compared the public key with the client setting. `.env.local` remains ignored. Convex code generation and upload passed after both feature additions. A local `coach.setTimeZone` call accepted `Asia/Jakarta`, verifying the runtime's `Intl` support.

The test suite covers settings defaults, target/time-zone/check-in validation, user isolation, each coach rule, water/meal boundary times, priority and text bounds, deterministic ordering, subscription deduplication and scoping, due-slot intervals, local dates, DST spring gaps and fall repeated hours, duplicate cron/delivery calls, disabling before delivery, fake 404/410 cleanup, local meal totals, browser helper flows, service-worker notifications/clicks, and OpenAI request/response/error/timeout contracts.

The existing smoke test still creates and deletes water, back training, and a grounded photo meal, including portion edits. Non-failing dependency/runtime notices remain: npm env-option warnings from the existing npx setup wrapper, a Three.js CommonJS deprecation notice during tests, and Playwright's NO_COLOR/FORCE_COLOR notice.

## Handoff and limits

[Coach API](coach-api.md) specifies function arguments, return shapes, defaults, UI sequencing, scheduling behavior, and production push configuration. [README](../README.md) documents OpenAI setup and its provider contract.

No live OpenAI, USDA, or browser push-service request was made for the new-provider tests. The OpenAI contract tests stub `fetch`; push tests use the fake sender. Real model availability, billing, and live notification delivery require the user's production configuration. Native iOS Home Screen delivery was not tested on a device. The push helper and worker have unit/source execution tests; the existing smoke test does not enable push. The UI owner must wire coach screens, settings, push controls, and notification `tab` deep links.

Delivery claims each slot before external I/O. This prevents duplicates but can lose a notification after a crash or uncertain network failure. The scheduler processes outage backlog in daily batches. These limits are documented in the API handoff. No requested implementation or required check remains incomplete.

## Commits and exact file sets

`727480e` — Add coach settings and deterministic daily suggestions

```text
convex/_generated/api.d.ts
convex/coach.ts
convex/schema.ts
lib/coach.ts
tests/coach-settings.test.ts
tests/coach.test.ts
```

`6531e7b` — Add timezone-aware coach push reminders and local VAPID setup

```text
README.md
convex/_generated/api.d.ts
convex/coach.ts
convex/coachCron.ts
convex/coachData.ts
convex/crons.ts
convex/push.ts
convex/pushActions.ts
convex/pushProviders/fake.ts
convex/pushProviders/types.ts
convex/pushProviders/webpush.ts
convex/schema.ts
convex/validators.ts
docs/coach-api.md
lib/coach-time.ts
lib/push-client.ts
package.json
pnpm-lock.yaml
public/sw.js
scripts/dev-setup.mjs
tests/coach-settings.test.ts
tests/push-client.test.ts
tests/push.test.ts
tests/sw.test.ts
```

The third commit is titled **Add OpenAI Responses meal vision with validated outputs**. Run `git log -1 --oneline` for its hash; this report is part of that commit.

```text
README.md
convex/_generated/api.d.ts
convex/mealVision/index.ts
convex/mealVision/openai.ts
docs/backend-features-checks.md
tests/openai-vision.test.ts
```

Each commit used explicit paths and a staged filename check. No secret values were staged or included in this report.
