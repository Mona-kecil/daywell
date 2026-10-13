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
