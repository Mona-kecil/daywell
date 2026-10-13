# Wave E API

All public functions require a signed-in caller through `requireUser`. An unauthenticated call throws `Sign in to continue.` Convex rejects malformed argument types before the handler runs. IDs below are Convex IDs, not display names.

Timestamps are milliseconds since Unix epoch. `now`, `at`, and existing timestamp inputs accept finite numbers from 0 through 8,640,000,000,000,000. An invalid value throws `Invalid timestamp.` Fractions are accepted, as in the existing backend. A timezone must pass the existing IANA timezone normalizer. An invalid timezone throws `Choose a valid IANA time zone.`

The achievement and weekly queries also require a four-digit local year for their civil-date calculations. A later local year throws `Invalid timestamp.`

```ts
type Macros = { kcal: number; protein: number; carbs: number; fat: number };
```

## `api.achievements.list` query

Args and return value:

```ts
{
  now: number;
  timeZone: string;
}

{
  id: string;
  title: string;
  detail: string;
  earnedAt: number | null;
  progress: {
    value: number;
    target: number;
  }
}
[];
```

The query uses the requested timezone, rather than the saved coach timezone. It ignores events after `now` and check-in dates after the local date of `now`. It computes awards from retained records on each call. Deletion, edits, a changed goal, or a changed timezone can change an award.

The array has this order and these thresholds:

1. `first-workout`: 1 workout.
2. `workouts-10`: 10 workouts.
3. `workouts-50`: 50 workouts.
4. `sets-100`: 100 strength sets.
5. `sets-1000`: 1,000 strength sets.
6. `first-pr`: 1 exercise PR.
7. `water-streak-3`: 3 consecutive local dates at the water goal.
8. `water-streak-7`: 7 consecutive local dates at the water goal.
9. `water-streak-30`: 30 consecutive local dates at the water goal.
10. `checkin-streak-7`: 7 consecutive stored check-in dates.
11. `all-muscles-7`: all current muscle IDs trained within one window of 7 local dates.
12. `meals-10`: 10 meals with `analysis.status === "ready"`.

Progress uses the highest count or longest streak found in the retained history, capped at the target. A broken past streak still earns its award. An empty muscle library has target 0, value 0, and `earnedAt: null`.

An exercise PR beats that exercise's best e1RM from a preceding session. The first session establishes a baseline. Each session contributes its highest e1RM, so multiple improving sets in one session count as one PR. The calculation uses the existing Epley helper, with exact singles. Ties do not count. Sessions at the same timestamp sort by workout ID.

Water uses the current saved goal, or 2,500 ml without settings. Each drink contributes to its local date. A check-in needs a weight, sleep, mood, energy, or nonblank note. Zero hours of sleep counts. A row with no values does not count. Ready manual and repeated meals count toward the meal award.

### Earned timestamps

`earnedAt` never uses the query's `now` as a fallback. Its rules are:

- Workout and set awards use the timestamp of the threshold event, sorted by event time.
- PR awards use the timestamp of the first session that beats a preceding session.
- Water streaks use the drink timestamp when the final day's accumulated amount first reaches the goal.
- Check-in streaks use 00:00 UTC on the final stored day. This is an estimate because check-ins store a civil date without a timezone or event timestamp.
- The muscle award uses the workout timestamp that first completes a qualifying window.
- Meal awards use the tenth ready meal's `at`. This estimates the logged meal time because meals do not store the time analysis completed.

Backdated entries sort by their logged time. These rules describe first satisfaction in the current records, not when the user first received an award.

### Read bounds

Every history read uses a user index. The query allows at most 1,000 workouts, 5,000 strength sets, 10,000 drinks, 1,000 check-ins, and 11 muscles through `now`. It reads one extra row per table to detect overflow and throws `History exceeds review limits.` It reads at most 10 ready meals through the new `by_user_status_time` index and one settings row. It does not scan meals with another analysis status. The maximum is 17,027 returned database rows before the overflow check, including settings and meals.

## `api.coach.weeklyReview` query

Args and return value:

```ts
{
  now: number;
  timeZone: string;
}

{
  fromDay: string; // YYYY-MM-DD, inclusive
  toDay: string; // YYYY-MM-DD, inclusive
  isoWeek: string; // ISO week year and week, such as "2026-W42"
  workouts: number;
  totalSets: number;
  newPRs: number;
  avgSleepHours: number | null;
  sleepDays: number;
  avgWaterMl: number;
  waterGoalMl: number;
  waterGoalPercent: number;
  daysLogged: number;
}
```

The window covers today and the preceding six local dates. Today's events stop at `now`. `timeZone` is required and overrides saved settings for this query. The query works when reminders are disabled and when no push subscription exists.

`workouts` counts sessions. `totalSets` counts individual strength sets. `newPRs` counts exercise/session improvements against preceding retained sessions, including history before the window. A session that improves two exercises counts as two PRs. The first session for an exercise does not count.

Sleep averages divide by `sleepDays`, which counts check-ins with a sleep value, including zero. Without sleep entries, the average is `null`. Water averages divide by 7, including dates with no drinks. The current water goal applies throughout the window. `waterGoalPercent` is the unrounded average divided by that goal, multiplied by 100. It can exceed 100.

`daysLogged` counts distinct local dates with a workout, drink, ready meal, or nonempty check-in. It ranges from 0 through 7. Meals in an error or analyzing state do not count.

The reader fetches workouts and water in the preceding eight elapsed days, then filters to the seven civil dates. Eight days cover the DST offset change. Limits are 1,000 workouts, 10,000 drinks, and 500 ready meals in that candidate range. The check-in reader covers the seven civil dates and allows 1,000 rows. PR comparison reads up to 5,000 lifetime strength sets through `now`. The shared reader also allows 11 muscles and reads one settings row. Each capped table reads one extra row. Overflow throws `History exceeds review limits.` The maximum is 17,518 returned rows before the overflow check.

### Weekly push schedule

`internal.weeklyReviewCron.run({})` runs every 15 minutes and looks for Sunday 19:00 in each enabled user's saved timezone. It uses the same `dueSlots` scanner as the check-in cron. It requires `remindersEnabled: true`, a saved timezone, and at least one push subscription. A separate `coachRuns` cursor uses key `weekly-review`. On the first run it checks the preceding 15 minutes. Outages drain in batches of at most 24 elapsed hours.

The scheduled push and query use the same `weeklySummary` result at the Sunday slot's timestamp. `weeklyReviewText` creates the title `Your weekly review` and a body with workouts, sets, new PRs, average sleep, average water against goal, and days logged. Counts and water values round for display. Sleep uses one decimal place. Missing sleep produces `Sleep not logged`.

The dedupe record uses `coachSent.localDay = isoWeek`, `slot = "weekly-review"`, and the existing `by_user_day_slot` index. A timezone change within the same ISO week does not create a second review. The push payload has `kind: "weekly-review"` and `slot: "<ISO-week>/weekly-review"`.

The existing `pushActions.deliver` and `push.claimDelivery` handle delivery. Claiming happens before external I/O. Duplicate runs send nothing after the claim. Reminders are checked again at delivery. Each browser subscription receives one attempt per user/week. A failed attempt can lose a notification, as with existing coach reminders. The fake provider records the same payload in `pushDeliveries`.

A user above the history caps receives no review for that slot. The cron logs `Weekly review skipped` with the user ID and `reason: "history-limit"`, then continues to other users. It advances its cursor and does not retry that slot. The settings enumeration follows the existing coach cron and scales with enabled accounts. The deployment's mutation read and runtime limits still apply across accounts.

## `api.meals.repeat` mutation

```ts
{ mealId: Id<"meals">; at: number } -> Id<"meals">
```

The mutation copies an owned ready meal into a new ready meal at `at`. It copies the description and every item, including grams, match status, optional FDC ID, and per-100 g nutrients. Totals use `mealTotals`, as with existing meals, and match the source's totals at copy time. The new meal starts at revision 0. Later edits affect each meal on its own.

The copy has no `storageId` and no photo. No vision request, storage upload, or FDC request runs. Each original photo keeps its existing single owner. Deleting the source deletes its photo and leaves the copy. Deleting the copy leaves the source photo.

Errors are `Meal not found.` for a missing or foreign meal and `Only analysed meals can be repeated.` for a non-ready meal. Invalid timestamps use the shared timestamp error.

## `api.meals.recent` query

```ts
{ limit?: number } -> {
  id: Id<"meals">;
  description: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  at: number;
  hasPhoto: boolean;
}[]
```

The default limit is 20. The accepted range is integer 1 through 20. Invalid values throw `Limit must be an integer from 1–20.`

The query reads at most the newest 200 owned ready meals through `by_user_status_time`. It dedupes descriptions with Unicode NFKC normalization, outer whitespace removal, whitespace collapse, and lowercase conversion. It keeps the newest row for each normalized description. Results sort by `at` descending, with the Convex index order resolving ties. It can return fewer than `limit` when the 200 candidates contain duplicates. Future-dated meals are included, as in the existing meal history. `hasPhoto` indicates a stored photo reference, without fetching the file.

## `api.food.lookupBarcode` action

The public module is `convex/food.ts`.

```ts
{ code: string } -> null | {
  fdcId: number;
  description: string;
  brand: string;
  servingGrams: number | null;
  per100g: Macros;
}
```

`code` must contain exactly 8, 12, or 13 ASCII digits and a valid EAN/UPC check digit. Whitespace, punctuation, and non-ASCII digits fail. Leading zeroes remain part of the string. Invalid input throws `Use a valid EAN-8, EAN-13 or UPC-A barcode with its check digit.`

Live mode uses the existing FDC HTTP client, `USDA_FDC_API_KEY`, and the `DEMO_KEY` fallback for an absent or empty key. It sends one search request with `query=code`, `dataType=Branded`, `pageSize=25`, and a 20-second timeout. It examines at most 25 results. It requires an exact `gtinUpc` match after left padding to 14 digits, so UPC-A and its leading-zero EAN-13 representation match. The first matching branded food with complete per-100 g energy, protein, carbohydrate, and fat wins. Search and branded fields follow the [USDA API specification](https://api.nal.usda.gov/fdc/v1/yaml-spec?api_key=DEMO_KEY).

The action returns `null` when no complete matching record exists. `brand` uses a nonblank `brandName`, then `brandOwner`, then an empty string. `servingGrams` requires a positive finite serving size and unit `g`, `grm`, `gram`, or `grams`, ignoring case. A missing serving or a volume unit returns `null`. The action does not infer grams from volume or label text. Nutrients follow the existing `extractPer100g` units and energy fallback order.

`FDC_MODE=fixture` uses `lib/fixtures/fdc-barcodes.json`. Its two products and FDC IDs are synthetic contract fixtures, not live USDA records. The hit codes are `012345678905` and `4006381333931`; `96385074` is an explicit miss. Unknown valid codes also return `null`. Fixture mode performs no HTTP request.

The action calls the existing `fdcMode` gate before lookup. Fixture mode outside a deployment with both verified loopback URLs throws `FDC_MODE=fixture requires a local Convex deployment. Set FDC_MODE=live for production.` It returns neither fixture nutrition nor a live fallback in that state.

HTTP failures throw `USDA search failed (<status>). Please retry later.`, including status 429. Native fetch timeout/network errors and Zod response-validation errors propagate. The backend has no existing per-user FDC rate limiter, so this action adds none. Each call has one bounded request; USDA's shared key/IP quotas still apply.

## `api.meals.addManual` mutation

```ts
{
  at: number;
  description: string;
  items: { name: string; grams: number; fdcId?: number; per100g: Macros }[];
} -> Id<"meals">
```

The mutation creates an owned ready meal at revision 0, without a photo or external request. It trims the description and item names. It accepts 1 through 30 items. The original description length must be at most 4,000 characters and each original name length at most 200. The trimmed strings must be nonempty.

Grams must be finite, greater than zero, and at most 10,000 per item. A supplied FDC ID must be a positive integer. Per-100 g kcal must be finite from 0 through 1,000. Each macro must be finite from 0 through 100 g. Zero nutrients are accepted.

Invalid descriptions or items throw exactly:

```text
Use a description of 1–4,000 characters and 1–30 items; names 1–200 characters, grams >0–10,000, FDC IDs positive integers, kcal 0–1,000 and macros 0–100 per 100 g.
```

Each stored item has `status: "matched"`, `id: "manual:<index>"`, and its name as `searchQuery` and `foodDescription`. `fdcId` remains absent when omitted. Matched means nutrient values are present; it no longer guarantees USDA provenance. Totals scale each item's nutrients by grams divided by 100. The mutation does not store duplicate totals.

## Existing meal contract changes

`meals.storageId` is optional. `api.meals.today` and internal meal reads return `photoUrl: null` for manual and repeated meals. Deletion and demo reset delete storage only when the meal has a photo reference.

The matched `MealItem` variant now has `fdcId?: number`. Existing photo/FDC matches still have an FDC ID. Manual items can omit it. The UI must check that field before showing a USDA link. The export shape otherwise stays at version 1.

`api.mealActions.reanalyze({ id })` rejects a meal without a photo with `This meal has no photo to re-analyse.` The rejection leaves its ready nutrition intact. Existing gram, description, remove-item, and food re-search functions work on meals without photos. Re-search can attach an FDC match to a manual item.

The generated API declaration was updated by hand for the new modules. No Convex codegen, deployment, live push, or shared demo seed run occurred. Tests exercise the existing demo seed through `convex-test` and assert nonempty achievements and weekly review data.
