# Wave D API

All functions below require authentication. Records belong to the JWT subject. IDs are Convex `Id<"table">` strings. Timestamps use epoch milliseconds. Errors are displayable `ConvexError` messages. Call and await `api.tracker.initialize({})` on login before rendering the exercise picker or changing settings. Initialize now seeds 25 built-in exercises for each user, including existing accounts; repeating it retains IDs and custom exercises. Existing tracker, coach, push, meal, and insights contracts keep their shapes.

## Strength

```ts
api.strength.exercises({}) // query
// Array<{ _id: Id<"exercises">; name: string; muscles: string[]; custom: boolean }>

api.strength.addExercise({ name: string, muscleIds: Id<"muscles">[] }) // mutation
// Id<"exercises">

api.strength.deleteExercise({ id: Id<"exercises"> }) // mutation
// null

api.strength.logSession({ // mutation
  trainedAt: number,
  note: string,
  entries: Array<{
    exerciseId: Id<"exercises">,
    sets: Array<{ reps: number; weightKg: number }>
  }>,
  extraMuscleIds?: Id<"muscles">[]
}) // Id<"workouts">

api.strength.session({ workoutId: Id<"workouts"> }) // query
// null | {
//   workoutId: Id<"workouts">; trainedAt: number; note: string;
//   entries: Array<{
//     exerciseId: Id<"exercises">; name: string;
//     sets: Array<{ _id: Id<"strengthSets">; reps: number; weightKg: number; order: number }>
//   }>
// }

api.strength.exerciseHistory({ exerciseId: Id<"exercises">, limit?: number }) // query
// {
//   sessions: Array<{
//     workoutId: Id<"workouts">; trainedAt: number;
//     sets: Array<{ reps: number; weightKg: number }>;
//     topSetKg: number; volumeKg: number; bestE1rm: number
//   }>;
//   prE1rm: number; prWeightKg: number; prAt: number | null
// }

api.strength.weeklyMuscleSets({ now: number }) // query
// Array<{ muscleId: Id<"muscles">; name: string; sets: number }>
```

The library sorts by name. Built-ins reference the user's default muscles; custom exercises need a trimmed nonempty name, at most 100 input characters, and 1–11 distinct owned muscle IDs. Duplicate muscle IDs collapse. Names need not be unique. Only custom exercises can be deleted. Deletion rejects exercises referenced by sets; delete those workouts first. No soft hiding occurs.

Sessions require 1–50 distinct owned exercises, 1–20 sets per exercise, and at most 500 total sets. Reps must be integers from 1–100. Weight must be finite and from 0–1000 kg, including decimals; zero means bodyweight. Every set is a working set; there is no warm-up flag. `trainedAt` must be finite, nonnegative, and at most 8,640,000,000,000,000. Future timestamps are allowed. Notes allow 2,000 input characters and are trimmed. The union of exercise muscles and extra muscle IDs must have 1–11 owned IDs. Extra muscles affect recovery, but have no set count unless an exercise targets them.

Call `logSession` once per completed form. It creates one workout through the same helper as `tracker.addWorkout`, inserts recovery links, and stores all sets in one transaction. Do not also call `tracker.addWorkout`. Entry order and set order define a global zero-based `order`. Sets snapshot muscle IDs when logged. `session` preserves that order, returns an empty `entries` array for a muscle-only workout, and returns null for missing or foreign workouts. `tracker.deleteWorkout({ id })` now removes sets and recovery links in its transaction. Its public shape is unchanged. In-flight duplicate submissions create separate sessions; disable submit until the mutation settles.

History defaults to 20 sessions and accepts an integer limit from 1–100. Sessions sort newest first; ties use stored order. PRs include all recorded sessions even when the list is limited, including future-dated sessions. `prAt` is the earliest session achieving the highest positive e1RM. Empty or bodyweight-only history reports zero PR values and `prAt: null`. Equal PRs retain the first achievement. `prWeightKg` is the maximum logged weight and can come from a different session than `prAt`. History rejects missing or foreign exercises.

Epley e1RM is `weightKg * (1 + reps / 30)`; a single uses its exact weight. Volume is the sum of `reps * weightKg`. Values are unrounded kilograms; format them in the UI. No bodyweight mass is inferred. Weekly counts include timestamps in the closed interval `[max(0, now - 7 * 86_400_000), now]`, exclude future sets, and count a set once for each mapped muscle. Every owned muscle appears, including zero counts. `now` has the same timestamp validation.

The demo seed now gives all 11 existing workouts three sets per exercise, with lower weights on older sessions. It recreates the exercise library and sets on each run and preserves other users.

## Daily body check-ins

```ts
api.checkins.upsert({ // mutation
  day: string,
  weightKg?: number | null,
  sleepHours?: number | null,
  mood?: number | null,
  energy?: number | null,
  note?: string | null
}) // Id<"bodyCheckins">

// A saved row has this shape; cleared/missing fields are absent, not null:
type BodyCheckin = {
  _id: Id<"bodyCheckins">;
  _creationTime: number;
  userId: string;
  day: string;
  weightKg?: number;
  sleepHours?: number;
  mood?: number;
  energy?: number;
  note?: string;
};

api.checkins.get({ day: string }) // query → BodyCheckin | null
api.checkins.range({ fromDay: string, toDay: string }) // query → BodyCheckin[]
```

Supply the user's local calendar date as an exact `YYYY-MM-DD` string. Dates must exist on the calendar (including leap-year validation). The backend does not infer the day from UTC or from saved coach settings. Format from local year/month/day parts; avoid `toISOString().slice(0, 10)` for local input. Days can lie in the past or future.

Weight accepts finite numbers from 20–400 kg. Sleep accepts finite numbers from 0–24 hours, including quarter hours and other fractions. Mood and energy accept integers from 1–5. Notes preserve whitespace and allow 280 input characters. All bounds are inclusive. Omitted fields keep their prior value; null removes that field. A new row with no measurements is allowed. Clearing every field keeps the row and its ID. Repeated updates to the same user/day keep one row; different users have different rows for the same day.

Ranges include both endpoints, sort ascending by day, and permit at most 400 calendar days including both endpoints. Reversed or longer ranges fail. Missing days produce no placeholder rows. `get` returns null when the caller has no record for that day. Coach reminder `settings.checkIns` times remain a separate feature.

For a form, query `get` for the selected local day, render absent fields blank, then send only changed fields. Send null when the user clears an existing value. Await `upsert` before closing; Convex refreshes subscribed queries. The seed passes 90 date strings computed in the CLI's local timezone, omits nine days, and replaces only the dev user's check-ins. Its optional `checkinDays` argument preserves older demo callers; callers without it use UTC date strings derived from the supplied first day timestamp.

## Data export

```ts
api.exportData.all({}) // query → {
//   version: 1;
//   exportedAt: number;
//   settings: null | {
//     waterGoal: number;
//     kcalTarget?: number;
//     proteinTarget?: number;
//     timeZone?: string;
//     checkIns?: string[];
//     remindersEnabled?: boolean;
//   };
//   muscles: Array<{ id: Id<"muscles">; name: string; cooldownHours: number }>;
//   workouts: Array<{
//     id: Id<"workouts">; muscleIds: Id<"muscles">[]; trainedAt: number; note: string;
//     sets: Array<{
//       id: Id<"strengthSets">; exerciseId: Id<"exercises">; exerciseName: string;
//       muscleIds: Id<"muscles">[]; reps: number; weightKg: number; order: number
//     }>;
//   }>;
//   exercises: Array<{ id: Id<"exercises">; name: string; muscleIds: Id<"muscles">[] }>;
//   water: Array<{ id: Id<"water">; amountMl: number; at: number }>;
//   meals: Array<{
//     id: Id<"meals">; description: string; at: number; items: MealItem[];
//     totals: { kcal: number; protein: number; carbs: number; fat: number };
//     status: "analyzing" | "ready" | "error"; error?: string
//   }>;
//   checkins: Array<{
//     id: Id<"bodyCheckins">; day: string;
//     weightKg?: number; sleepHours?: number; mood?: number; energy?: number; note?: string
//   }>;
// }

type Macros = { kcal: number; protein: number; carbs: number; fat: number };
type MealItem = {
  id: string; name: string; grams: number; searchQuery: string;
} & (
  { status: "unmatched" } |
  { status: "matched"; fdcId: number; foodDescription: string; per100g: Macros }
);
```

Export reads a single consistent Convex query snapshot of all caller-owned records. It needs no date range or initialization. An uninitialized account returns `settings: null` and empty arrays. Optional settings reflect stored values; absent fields are omitted, rather than filled with coach defaults. `exportedAt` is the query's execution time, so request a fresh query when the user clicks Download (for example, `convex.query(api.exportData.all, {})`), then serialize with `JSON.stringify(result, null, 2)` and download as `daywell-YYYY-MM-DD.json`. It is a snapshot, not an import format; there is no import API.

Workouts, drinks, and meals sort oldest first; check-ins sort ascending by day; sets sort by global order. Muscles and custom exercises use database insertion order. `exercises` contains custom exercises only. Built-in exercise references remain readable through each set's `exerciseName` and snapshot muscle IDs. The complete built-in library can be read through `strength.exercises`. Muscle-only workouts export an empty `sets` array.

Meals include every analysis status. Totals derive from the exported matched items and exclude unmatched items. An analyzing or failed meal can retain items from its previous analysis; its exported totals describe those items. For a ready-only summary, filter on `status === "ready"`. Totals remain unrounded. Error messages are user-facing; analysis revisions and start times are omitted.

Export excludes storage blobs, storage IDs, photo URLs, user IDs, creation timestamps, upload tickets, push subscriptions/keys/delivery logs, coach scheduling state, and recovery join rows. All relationships needed for user data use stable record IDs. The query follows Convex's normal read/response limits; it does not truncate data. If an account exceeds those limits, the query fails and the UI should retain the error. The local demo export was checked against the running backend. No chunked export or import is implemented.

## Production safety

Fixture nutrition and the dev JWT provider require both deployment system URLs to use exact loopback hosts. Non-local fixture mode stores a clear meal error instead of canned nutrients. The demo seed also requires the local guard, dev JWKS, dev-user subject, and dev issuer. Read the README's verified signal and canonical URL override limit for deployment setup. These guards do not alter existing public function shapes.
