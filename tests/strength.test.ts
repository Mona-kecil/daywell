import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { e1rm, summarizeSets, EXERCISE_DEFAULTS } from "../lib/strength";
import { MUSCLE_DEFAULTS, recovery } from "../lib/recovery";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  await alice.mutation(api.tracker.initialize, {});
  await bob.mutation(api.tracker.initialize, {});
  const exercises = await alice.query(api.strength.exercises, {});
  const bench = exercises.find((e) => e.name === "Bench press");
  if (!bench) throw new Error("Missing bench");
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  return { t, alice, bob, bench, muscles };
}

it("uses Epley, keeps singles exact, and counts weighted volume", () => {
  expect(e1rm({ reps: 1, weightKg: 100 })).toBe(100);
  expect(e1rm({ reps: 10, weightKg: 60 })).toBe(80);
  expect(e1rm({ reps: 100, weightKg: 0 })).toBe(0);
  expect(summarizeSets([])).toEqual({ topSetKg: 0, volumeKg: 0, bestE1rm: 0 });
  expect(
    summarizeSets([
      { reps: 10, weightKg: 60 },
      { reps: 1, weightKg: 90 },
    ]),
  ).toEqual({ topSetKg: 90, volumeKg: 690, bestE1rm: 90 });
  for (const e of EXERCISE_DEFAULTS)
    for (const name of e.muscles)
      expect(MUSCLE_DEFAULTS.map((m) => m.name)).toContain(name);
});

it("seeds 25 exercises once, scopes customs, and rejects deletion of built-ins or references", async () => {
  const { t, alice, bob, bench, muscles } = await setup();
  await alice.mutation(api.tracker.initialize, {});
  const library = await alice.query(api.strength.exercises, {});
  expect(library).toHaveLength(25);
  expect(library.map((e) => e.name)).toEqual(
    library.map((e) => e.name).sort((a, b) => a.localeCompare(b)),
  );
  await expect(t.query(api.strength.exercises, {})).rejects.toThrow("Sign in");
  await expect(
    alice.mutation(api.strength.deleteExercise, { id: bench._id }),
  ).rejects.toThrow("Only custom");
  const id = await alice.mutation(api.strength.addExercise, {
    name: " My exercise ",
    muscleIds: [muscles[0]._id, muscles[0]._id],
  });
  expect(
    (await alice.query(api.strength.exercises, {})).find((e) => e._id === id),
  ).toMatchObject({
    name: "My exercise",
    muscles: [muscles[0].name],
    custom: true,
  });
  expect(
    (await bob.query(api.strength.exercises, {})).some((e) => e._id === id),
  ).toBe(false);
  await expect(
    bob.mutation(api.strength.deleteExercise, { id }),
  ).rejects.toThrow("Exercise not found");
  await expect(
    bob.mutation(api.strength.addExercise, {
      name: "Foreign",
      muscleIds: [muscles[0]._id],
    }),
  ).rejects.toThrow("Muscle not found");
  const workout = await alice.mutation(api.strength.logSession, {
    trainedAt: 1000,
    note: "",
    entries: [{ exerciseId: id, sets: [{ reps: 10, weightKg: 0 }] }],
  });
  await expect(
    alice.mutation(api.strength.deleteExercise, { id }),
  ).rejects.toThrow("Delete the workouts");
  await alice.mutation(api.tracker.deleteWorkout, { id: workout });
  await alice.mutation(api.strength.deleteExercise, { id });
  expect(
    (await alice.query(api.strength.exercises, {})).some((e) => e._id === id),
  ).toBe(false);
});

it("creates one workout with the union, matches tracker recovery, and cascades set deletion", async () => {
  const { t, alice, bob, bench, muscles } = await setup();
  const abs = muscles.find((m) => m.name === "abs");
  if (!abs) throw new Error("Missing abs");
  const ids = muscles
    .filter((m) => bench.muscles.includes(m.name))
    .map((m) => m._id);
  const old = await alice.mutation(api.tracker.addWorkout, {
    muscleIds: [...ids, abs._id],
    trainedAt: 100,
    note: "Old",
  });
  const logged = await alice.mutation(api.strength.logSession, {
    trainedAt: 200,
    note: "  Session  ",
    entries: [
      {
        exerciseId: bench._id,
        sets: [
          { reps: 10, weightKg: 60 },
          { reps: 8, weightKg: 60 },
        ],
      },
    ],
    extraMuscleIds: [abs._id, abs._id],
  });
  const bobMuscles = (await bob.query(api.tracker.overview, {})).muscles;
  await bob.mutation(api.tracker.addWorkout, {
    trainedAt: 200,
    note: "Tracker equivalent",
    muscleIds: bobMuscles
      .filter((m) => [...bench.muscles, "abs"].includes(m.name))
      .map((m) => m._id),
  });
  const bobOverview = await bob.query(api.tracker.overview, {});
  const overview = await alice.query(api.tracker.overview, {});
  for (const m of overview.muscles.filter((m) =>
    [...ids, abs._id].includes(m._id),
  )) {
    expect(m.lastTrainedAt).toBe(200);
    const equivalent = bobOverview.muscles.find(
      (group) => group.name === m.name,
    );
    if (!equivalent) throw new Error("Missing tracker equivalent");
    expect(recovery(1000, m.lastTrainedAt, m.cooldownHours)).toEqual(
      recovery(1000, equivalent.lastTrainedAt, equivalent.cooldownHours),
    );
    expect(recovery(1000, m.lastTrainedAt, m.cooldownHours)).toEqual(
      recovery(1000, 200, m.cooldownHours),
    );
  }
  const history = await alice.query(api.tracker.workoutHistory, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(history.page).toHaveLength(2);
  expect(history.page[0]).toMatchObject({
    _id: logged,
    note: "Session",
    muscleIds: expect.arrayContaining([...ids, abs._id]),
  });
  expect(history.page[0].muscleIds).toHaveLength(4);
  expect(
    (await alice.query(api.strength.session, { workoutId: old }))?.entries,
  ).toEqual([]);
  expect(
    (
      await alice.query(api.strength.session, { workoutId: logged })
    )?.entries[0].sets.map((s) => s.order),
  ).toEqual([0, 1]);
  expect(
    await bob.query(api.strength.session, { workoutId: logged }),
  ).toBeNull();
  await expect(
    bob.query(api.strength.exerciseHistory, { exerciseId: bench._id }),
  ).rejects.toThrow("Exercise not found");
  await expect(
    bob.mutation(api.strength.logSession, {
      trainedAt: 300,
      note: "",
      entries: [{ exerciseId: bench._id, sets: [{ reps: 10, weightKg: 60 }] }],
    }),
  ).rejects.toThrow("Exercise not found");
  await expect(
    bob.mutation(api.tracker.deleteWorkout, { id: logged }),
  ).rejects.toThrow("Workout not found");
  await alice.mutation(api.tracker.deleteWorkout, { id: logged });
  expect(await t.run((ctx) => ctx.db.query("strengthSets").collect())).toEqual(
    [],
  );
  expect(
    await alice.query(api.strength.session, { workoutId: logged }),
  ).toBeNull();
  for (const m of (await alice.query(api.tracker.overview, {})).muscles.filter(
    (m) => [...ids, abs._id].includes(m._id),
  ))
    expect(m.lastTrainedAt).toBe(100);
});

it("summarizes history, all-time PRs, and seven-day counts without future sets or extra muscles", async () => {
  const { alice, bob, bench, muscles } = await setup();
  const now = 20 * 86_400_000;
  const times = [now - 8 * 86_400_000, now - 7 * 86_400_000, now, now + 1];
  for (const [i, trainedAt] of times.entries())
    await alice.mutation(api.strength.logSession, {
      trainedAt,
      note: "",
      entries: [
        {
          exerciseId: bench._id,
          sets: [
            { reps: 10, weightKg: 100 - i * 10 },
            { reps: 1, weightKg: 80 },
          ],
        },
      ],
      extraMuscleIds: [
        muscles.find((m) => m.name === "abs")?._id ?? muscles[0]._id,
      ],
    });
  const history = await alice.query(api.strength.exerciseHistory, {
    exerciseId: bench._id,
    limit: 1,
  });
  expect(history.sessions).toHaveLength(1);
  expect(history.sessions[0]).toMatchObject({
    trainedAt: now + 1,
    topSetKg: 80,
    volumeKg: 780,
    bestE1rm: 70 * (1 + 10 / 30),
  });
  expect(history.prE1rm).toBe(100 * (1 + 10 / 30));
  expect(history.prWeightKg).toBe(100);
  expect(history.prAt).toBe(times[0]);
  for (const m of await alice.query(api.strength.weeklyMuscleSets, { now }))
    expect(m.sets).toBe(bench.muscles.includes(m.name) ? 4 : 0);
  expect(
    (await bob.query(api.strength.weeklyMuscleSets, { now })).every(
      (m) => m.sets === 0,
    ),
  ).toBe(true);
});

it("rejects invalid sets, duplicate entries, timestamps and limits without inserting a workout", async () => {
  const { alice, bench } = await setup();
  for (const set of [
    { reps: 0, weightKg: 10 },
    { reps: 101, weightKg: 10 },
    { reps: 1.5, weightKg: 10 },
    { reps: 8, weightKg: -1 },
    { reps: 8, weightKg: 1001 },
    { reps: 8, weightKg: Infinity },
  ])
    await expect(
      alice.mutation(api.strength.logSession, {
        trainedAt: 100,
        note: "",
        entries: [{ exerciseId: bench._id, sets: [set] }],
      }),
    ).rejects.toThrow("Reps");
  for (const entries of [
    [],
    [{ exerciseId: bench._id, sets: [] }],
    Array.from({ length: 2 }, () => ({
      exerciseId: bench._id,
      sets: [{ reps: 10, weightKg: 0 }],
    })),
  ])
    await expect(
      alice.mutation(api.strength.logSession, {
        trainedAt: 100,
        note: "",
        entries,
      }),
    ).rejects.toThrow();
  await expect(
    alice.query(api.strength.exerciseHistory, {
      exerciseId: bench._id,
      limit: 101,
    }),
  ).rejects.toThrow("Limit");
  await expect(
    alice.mutation(api.strength.logSession, {
      trainedAt: -1,
      note: "",
      entries: [{ exerciseId: bench._id, sets: [{ reps: 1, weightKg: 0 }] }],
    }),
  ).rejects.toThrow("timestamp");
  expect(
    (
      await alice.query(api.tracker.workoutHistory, {
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page,
  ).toEqual([]);
});
