# Coach API

Initialize the user with `api.tracker.initialize({})` before changing settings. All public Convex functions require authentication and use the JWT subject as the user ID. Existing `tracker.overview` callers keep the same return shape.

## Settings and suggestions

- `api.coach.settings({})` returns `{ waterGoal: number, kcalTarget: number | null, proteinTarget: number | null, timeZone: string | null, checkIns: string[], remindersEnabled: boolean }`. Defaults: water goal 2500 ml, no nutrition targets or time zone, check-ins `["10:00", "13:00", "16:00", "19:30"]`, reminders off.
- `api.coach.setTargets({ kcalTarget?: number, proteinTarget?: number })` replaces both targets. Omitted fields clear that target. Calories must be above 0 and at most 20,000; protein grams must be above 0 and at most 1000.
- `api.coach.setCheckIns({ checkIns: string[] })` accepts up to 24 distinct `HH:MM` times, including an empty array, and stores them sorted.
- `api.coach.setTimeZone({ timeZone: string })` validates and canonicalizes an IANA zone through `Intl`. Numeric offsets are rejected.
- `api.coach.setRemindersEnabled({ enabled: boolean })` requires a saved time zone when enabling. These mutations return `null` over RPC.
- `api.coach.suggestions({ now: number, timeZone?: string })` returns up to three `Suggestion` objects. Refresh `now` as the device clock advances. The device zone argument takes precedence, followed by the saved zone, then UTC. Invalid zones throw "Unknown time zone.". Water and meals come from that user's local day through `now`; only ready meals contribute macros. All logged meal statuses count toward the lunch logging prompt. Future workouts do not affect recovery at `now`.

`coachSuggestions(input)` in `lib/coach.ts` is pure. `CoachInput` has `now` (epoch ms), `localMinutes` (0–1439), optional `timeZone`, `waterMl`, `waterGoal`, `macros: { kcal, protein, carbs, fat }`, `targets: { kcalTarget?, proteinTarget? }`, `mealCount`, and `muscles: { name, cooldownHours, lastTrainedAt: number | null }[]`. It returns `{ id, kind: "water" | "food" | "train" | "rest", priority: 1 | 2 | 3, title, body }[]`. Lower priority numbers come first; IDs break ties. Titles fit 60 characters and bodies fit 140. IDs remain stable as amounts change.

Water pacing uses 07:00–22:00 and triggers above a 15% goal deficit. The amount rounds to 50 ml. At 13:00 the meal target fraction is 45%; at 19:00 it is 80%. A deficit above 20% of the daily target triggers a food prompt. Training chooses never-trained groups first, then the earliest recovery completion, with names breaking ties. Food portions are approximate suggestions, not nutrition entries.

## Push client integration

- `pushSupport()` from `lib/push-client.ts` returns `"unsupported" | "needs-install" | "denied" | "default" | "granted"`. iOS outside standalone mode needs Home Screen installation.
- Call `enablePush(subscribeMutation)` from a user click. Pass the function returned by `useMutation(api.push.subscribe)`. It requests permission, registers `/sw.js`, reuses or creates a browser subscription, saves it, and returns `{ endpoint, keys: { p256dh, auth } }`. A failed save rolls back a newly created browser subscription. Errors carry displayable messages.
- `disablePush(unsubscribeMutation)` takes the function from `useMutation(api.push.unsubscribe)` and returns `Promise<void>`. It removes the server subscription before unsubscribing the browser.
- `api.push.subscribe({ endpoint, keys: { p256dh, auth } })` returns an `Id<"pushSubscriptions">`. It updates keys for the same endpoint and user. Cross-user reuse is rejected; unsubscribe with the original user before switching the device account. Supported services: Google FCM, Mozilla Push, Apple Push, and Windows Notify. Credentials and non-HTTPS endpoints are rejected.
- `api.push.unsubscribe({ endpoint })` returns `null` and removes only the caller's subscription. Repeating it is safe.

Enabling UI flow: save time zone, call `enablePush`, then enable reminders. Disabling flow: disable reminders, then call `disablePush`. Signing out should unsubscribe while the user is still authenticated. Permission alone does not imply the server has a subscription or reminders are enabled. Changes to `NEXT_PUBLIC_VAPID_PUBLIC_KEY` require a Next restart/rebuild and replacement browser subscriptions.

The worker routes notification clicks to `/?tab=water`, `/?tab=meals`, or `/?tab=train`. The UI owner must consume the `tab` search parameter. It handles notifications only; it does not cache pages or add offline support.

## Scheduler and providers

The Convex cron runs every 15 minutes. `coachRuns` stores its UTC cursor; the first run covers the preceding 15 minutes. Each later run processes `(lastRunAt, now]`, in batches of at most 24 hours after an outage. Slots use real UTC minutes converted to local time. Spring DST gaps skip nonexistent slots. Fall repeated slots share a day/slot key and send once. The same key applies when a user changes time zones. Catch-up slots use data as of the slot timestamp.

A mutation inserts `coachSent` and schedules delivery in one transaction. Delivery claims the record before external I/O. Duplicate cron runs and action retries cannot send the same slot twice. A crash or transient provider failure after that claim can lose the notification; delivery is not retried because a network timeout cannot prove the service rejected it. Each registered device receives the top suggestion. HTTP 404/410 removes the expired subscription; other failures remain in server logs. Disabling reminders before the delivery claim cancels sending. Subscription changes after the claim can race with sending.

`PUSH_PROVIDER` defaults to `fake`; the fake records calls in `pushDeliveries`. Tests can set `PUSH_FAKE_STATUS` (default 201) to simulate expired subscriptions. `webpush` uses `web-push` inside a Node action, with a 15-second request timeout and one-hour TTL. No live push service was used in the tests.

For production, set `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` on Convex. Subject must be a contact `mailto:` address or HTTPS URL. Set matching `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Next. Keep the private key on the server. Generate a pair with `web-push` or a trusted VAPID generator; keep it stable across deployments.

`pnpm dev:setup` creates or reuses a VAPID pair in ignored `.env.local` (mode 600), installs missing values on the anonymous local Convex deployment, and exposes only the public key to Next. It rejects mismatched pairs. Existing Convex values are retained. Local push defaults to fake.
