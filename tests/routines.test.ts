import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  await alice.mutation(api.tracker.initialize, {});
  await bob.mutation(api.tracker.initialize, {});
  const exercises = await alice.query(api.strength.exercises, {});
  const bobExercises = await bob.query(api.strength.exercises, {});
  const muscles = (await alice.query(api.tracker.overview, {})).muscles;
  return { t, alice, bob, exercises, bobExercises, muscles };
}

it("creates and lists routines with saved exercise order and library shapes", async () => {
  const { t, alice, bob, exercises, muscles } = await setup();
  const customId = await alice.mutation(api.strength.addExercise, {
    name: "Custom press",
    muscleIds: [muscles[0]._id, muscles[1]._id],
  });
  const custom = (await alice.query(api.strength.exercises, {})).find(
    (exercise) => exercise._id === customId,
  );
  if (!custom) throw new Error("Missing custom exercise");
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const exerciseIds = [customId, exercises[1]._id, exercises[0]._id];
  const id = await alice.mutation(api.routines.create, {
    name: "Push day A",
    exerciseIds,
  });
  expect(await alice.query(api.routines.list, {})).toEqual([
    {
      _id: id,
      name: "Push day A",
      lastUsedAt: null,
      exercises: [custom, exercises[1], exercises[0]],
    },
  ]);
  expect(await bob.query(api.routines.list, {})).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(id))).toEqual({
    _id: id,
    _creationTime: expect.any(Number),
    userId: "alice",
    name: "Push day A",
    exerciseIds,
    createdAt: 1000,
  });
  expect(await t.run((ctx) => ctx.db.query("strengthSets").collect())).toEqual(
    [],
  );
});

it("sorts by last use or creation descending, then by name", async () => {
  const { t, alice, exercises } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(100);
  const exerciseIds = [exercises[0]._id];
  const zulu = await alice.mutation(api.routines.create, {
    name: "Zulu",
    exerciseIds,
  });
  const alpha = await alice.mutation(api.routines.create, {
    name: "Alpha",
    exerciseIds,
  });
  clock.mockReturnValue(200);
  const newest = await alice.mutation(api.routines.create, {
    name: "Newest",
    exerciseIds,
  });
  expect(
    (await alice.query(api.routines.list, {})).map((routine) => routine._id),
  ).toEqual([newest, alpha, zulu]);
  clock.mockReturnValue(300);
  expect(await alice.mutation(api.routines.markUsed, { id: zulu })).toBeNull();
  expect(await alice.query(api.routines.list, {})).toEqual([
    { _id: zulu, name: "Zulu", lastUsedAt: 300, exercises: [exercises[0]] },
    {
      _id: newest,
      name: "Newest",
      lastUsedAt: null,
      exercises: [exercises[0]],
    },
    { _id: alpha, name: "Alpha", lastUsedAt: null, exercises: [exercises[0]] },
  ]);
  await alice.mutation(api.routines.markUsed, { id: alpha });
  expect(
    (await alice.query(api.routines.list, {})).map((routine) => routine._id),
  ).toEqual([alpha, zulu, newest]);
  clock.mockReturnValue(400);
  await alice.mutation(api.routines.markUsed, { id: zulu });
  expect(await t.run((ctx) => ctx.db.get(zulu))).toMatchObject({
    createdAt: 100,
    lastUsedAt: 400,
  });
  await t.run((ctx) => ctx.db.patch(zulu, { lastUsedAt: 0 }));
  expect(
    (await alice.query(api.routines.list, {})).map((routine) => routine._id),
  ).toEqual([alpha, newest, zulu]);
});

it("trims names and enforces 1–40 characters on create and rename", async () => {
  const { alice, exercises } = await setup();
  const exerciseIds = [exercises[0]._id];
  const id = await alice.mutation(api.routines.create, {
    name: `  ${"A".repeat(40)}  `,
    exerciseIds,
  });
  expect((await alice.query(api.routines.list, {}))[0].name).toBe(
    "A".repeat(40),
  );
  for (const name of ["", "   ", "A".repeat(41)]) {
    await expect(
      alice.mutation(api.routines.create, { name, exerciseIds }),
    ).rejects.toThrow("Enter a name of 1–40 characters.");
    await expect(
      alice.mutation(api.routines.rename, { id, name }),
    ).rejects.toThrow("Enter a name of 1–40 characters.");
  }
  expect(
    await alice.mutation(api.routines.rename, { id, name: " A " }),
  ).toBeNull();
  expect((await alice.query(api.routines.list, {}))[0].name).toBe("A");
  await alice.mutation(api.routines.rename, {
    id,
    name: ` ${"B".repeat(40)} `,
  });
  expect((await alice.query(api.routines.list, {}))[0].name).toBe(
    "B".repeat(40),
  );
  expect(await alice.query(api.routines.list, {})).toHaveLength(1);
});

it("enforces per-user case-insensitive names and allows renaming the same routine", async () => {
  const { alice, bob, exercises, bobExercises } = await setup();
  const exerciseIds = [exercises[0]._id];
  const id = await alice.mutation(api.routines.create, {
    name: "Push day A",
    exerciseIds,
  });
  await expect(
    alice.mutation(api.routines.create, { name: " push DAY a ", exerciseIds }),
  ).rejects.toThrow("You already have a routine called push DAY a.");
  const other = await alice.mutation(api.routines.create, {
    name: "Pull day",
    exerciseIds,
  });
  await expect(
    alice.mutation(api.routines.rename, { id: other, name: " PUSH DAY A " }),
  ).rejects.toThrow("You already have a routine called PUSH DAY A.");
  await alice.mutation(api.routines.rename, { id, name: " PUSH DAY A " });
  await alice.mutation(api.routines.rename, { id, name: "PUSH DAY A" });
  expect(
    (await alice.query(api.routines.list, {})).find(
      (routine) => routine._id === id,
    )?.name,
  ).toBe("PUSH DAY A");
  await bob.mutation(api.routines.create, {
    name: "push day a",
    exerciseIds: [bobExercises[0]._id],
  });
  expect(await bob.query(api.routines.list, {})).toHaveLength(1);
  expect(await alice.query(api.routines.list, {})).toHaveLength(2);
});

it("accepts 1–25 exercises, rejects empty or duplicate lists, and updates saved order", async () => {
  const { t, alice, exercises, muscles } = await setup();
  const exerciseIds = exercises.map((exercise) => exercise._id);
  const id = await alice.mutation(api.routines.create, {
    name: "All exercises",
    exerciseIds,
  });
  expect((await alice.query(api.routines.list, {}))[0].exercises).toEqual(
    exercises,
  );
  const extra = await alice.mutation(api.strength.addExercise, {
    name: "Extra exercise",
    muscleIds: [muscles[0]._id],
  });
  for (const invalid of [
    [],
    [exerciseIds[0], exerciseIds[0]],
    [...exerciseIds, extra],
  ]) {
    await expect(
      alice.mutation(api.routines.create, {
        name: "Invalid exercises",
        exerciseIds: invalid,
      }),
    ).rejects.toThrow("Choose 1–25 distinct exercises.");
    await expect(
      alice.mutation(api.routines.update, { id, exerciseIds: invalid }),
    ).rejects.toThrow("Choose 1–25 distinct exercises.");
  }
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ exerciseIds });
  expect(
    await alice.mutation(api.routines.update, { id, exerciseIds: [extra] }),
  ).toBeNull();
  await alice.mutation(api.routines.update, {
    id,
    exerciseIds: [...exerciseIds].reverse(),
  });
  expect((await alice.query(api.routines.list, {}))[0].exercises).toEqual(
    [...exercises].reverse(),
  );
  expect(await alice.query(api.routines.list, {})).toHaveLength(1);
});

it("rejects foreign and missing exercises on create and update", async () => {
  const { t, alice, exercises, bobExercises, muscles } = await setup();
  const id = await alice.mutation(api.routines.create, {
    name: "Push day",
    exerciseIds: [exercises[0]._id],
  });
  const missing = await alice.mutation(api.strength.addExercise, {
    name: "Missing exercise",
    muscleIds: [muscles[0]._id],
  });
  await t.run((ctx) => ctx.db.delete(missing));
  for (const foreignOrMissing of [bobExercises[0]._id, missing]) {
    const exerciseIds = [exercises[0]._id, foreignOrMissing];
    await expect(
      alice.mutation(api.routines.create, { name: "Invalid", exerciseIds }),
    ).rejects.toThrow("Exercise not found.");
    await expect(
      alice.mutation(api.routines.update, { id, exerciseIds }),
    ).rejects.toThrow("Exercise not found.");
  }
  expect(await alice.query(api.routines.list, {})).toEqual([
    { _id: id, name: "Push day", lastUsedAt: null, exercises: [exercises[0]] },
  ]);
});

it("caps each user at 30 routines and frees a slot on removal", async () => {
  const { alice, bob, exercises, bobExercises } = await setup();
  const exerciseIds = [exercises[0]._id];
  const ids = [];
  for (let i = 0; i < 30; i++)
    ids.push(
      await alice.mutation(api.routines.create, {
        name: `Routine ${i}`,
        exerciseIds,
      }),
    );
  await expect(
    alice.mutation(api.routines.create, { name: "Routine 31", exerciseIds }),
  ).rejects.toThrow("You can save at most 30 routines.");
  expect(await alice.query(api.routines.list, {})).toHaveLength(30);
  await alice.mutation(api.routines.rename, { id: ids[0], name: "Renamed" });
  await alice.mutation(api.routines.update, {
    id: ids[0],
    exerciseIds: [exercises[1]._id],
  });
  await bob.mutation(api.routines.create, {
    name: "Routine 31",
    exerciseIds: [bobExercises[0]._id],
  });
  await alice.mutation(api.routines.remove, { id: ids[0] });
  await alice.mutation(api.routines.create, {
    name: "Routine 31",
    exerciseIds,
  });
  expect(await alice.query(api.routines.list, {})).toHaveLength(30);
});

it("rejects another user's routine for rename, update, remove, and markUsed", async () => {
  const { t, alice, bob, exercises, bobExercises } = await setup();
  const id = await alice.mutation(api.routines.create, {
    name: "Alice routine",
    exerciseIds: [exercises[0]._id],
  });
  const before = await t.run((ctx) => ctx.db.get(id));
  await expect(
    bob.mutation(api.routines.rename, { id, name: "Bob routine" }),
  ).rejects.toThrow("Routine not found.");
  await expect(
    bob.mutation(api.routines.update, {
      id,
      exerciseIds: [bobExercises[0]._id],
    }),
  ).rejects.toThrow("Routine not found.");
  await expect(bob.mutation(api.routines.remove, { id })).rejects.toThrow(
    "Routine not found.",
  );
  await expect(bob.mutation(api.routines.markUsed, { id })).rejects.toThrow(
    "Routine not found.",
  );
  expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
  expect(await bob.query(api.routines.list, {})).toEqual([]);
});

it("removes a routine and returns the ordered data accepted by create for undo", async () => {
  const { t, alice, exercises } = await setup();
  const input = {
    name: "Push day A",
    exerciseIds: [exercises[1]._id, exercises[0]._id],
  };
  const id = await alice.mutation(api.routines.create, input);
  await alice.mutation(api.routines.markUsed, { id });
  const removed = await alice.mutation(api.routines.remove, { id });
  expect(removed).toEqual(input);
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  expect(await alice.query(api.routines.list, {})).toEqual([]);
  const restored = await alice.mutation(api.routines.create, removed);
  expect(restored).not.toBe(id);
  expect(await alice.query(api.routines.list, {})).toEqual([
    {
      _id: restored,
      name: input.name,
      lastUsedAt: null,
      exercises: [exercises[1], exercises[0]],
    },
  ]);
  await expect(
    alice.mutation(api.routines.rename, { id, name: "Missing" }),
  ).rejects.toThrow("Routine not found.");
  await expect(
    alice.mutation(api.routines.update, { id, exerciseIds: input.exerciseIds }),
  ).rejects.toThrow("Routine not found.");
  await expect(alice.mutation(api.routines.remove, { id })).rejects.toThrow(
    "Routine not found.",
  );
  await expect(alice.mutation(api.routines.markUsed, { id })).rejects.toThrow(
    "Routine not found.",
  );
});

it("rejects unauthenticated calls to every routine function", async () => {
  const { t, alice, exercises } = await setup();
  const exerciseIds = [exercises[0]._id];
  const id = await alice.mutation(api.routines.create, {
    name: "Push day A",
    exerciseIds,
  });
  const before = await t.run((ctx) => ctx.db.get(id));
  await expect(t.query(api.routines.list, {})).rejects.toThrow(
    "Sign in to continue.",
  );
  await expect(
    t.mutation(api.routines.create, { name: "Guest", exerciseIds }),
  ).rejects.toThrow("Sign in to continue.");
  await expect(
    t.mutation(api.routines.rename, { id, name: "Guest" }),
  ).rejects.toThrow("Sign in to continue.");
  await expect(
    t.mutation(api.routines.update, { id, exerciseIds }),
  ).rejects.toThrow("Sign in to continue.");
  await expect(t.mutation(api.routines.remove, { id })).rejects.toThrow(
    "Sign in to continue.",
  );
  await expect(t.mutation(api.routines.markUsed, { id })).rejects.toThrow(
    "Sign in to continue.",
  );
  expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
  expect(await alice.query(api.routines.list, {})).toHaveLength(1);
});

it("strips deleted exercises from the caller's routines and keeps empty routines", async () => {
  const { t, alice, bob, exercises, bobExercises, muscles } = await setup();
  const custom = await alice.mutation(api.strength.addExercise, {
    name: "Custom press",
    muscleIds: [muscles[0]._id],
  });
  const mixed = await alice.mutation(api.routines.create, {
    name: "Mixed",
    exerciseIds: [exercises[1]._id, custom, exercises[0]._id],
  });
  const empty = await alice.mutation(api.routines.create, {
    name: "Becomes empty",
    exerciseIds: [custom],
  });
  const unaffected = await alice.mutation(api.routines.create, {
    name: "Unaffected",
    exerciseIds: [exercises[0]._id],
  });
  const foreign = await bob.mutation(api.routines.create, {
    name: "Bob routine",
    exerciseIds: [bobExercises[0]._id],
  });
  await t.run((ctx) =>
    ctx.db.patch(foreign, { exerciseIds: [custom, bobExercises[0]._id] }),
  );
  const foreignBefore = await t.run((ctx) => ctx.db.get(foreign));
  const unaffectedBefore = await t.run((ctx) => ctx.db.get(unaffected));
  expect(
    await alice.mutation(api.strength.deleteExercise, { id: custom }),
  ).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(custom))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(mixed))).toMatchObject({
    exerciseIds: [exercises[1]._id, exercises[0]._id],
  });
  expect(await t.run((ctx) => ctx.db.get(empty))).toMatchObject({
    exerciseIds: [],
  });
  expect(
    (await alice.query(api.routines.list, {})).find(
      (routine) => routine._id === empty,
    ),
  ).toEqual({
    _id: empty,
    name: "Becomes empty",
    lastUsedAt: null,
    exercises: [],
  });
  expect(await t.run((ctx) => ctx.db.get(foreign))).toEqual(foreignBefore);
  expect(await t.run((ctx) => ctx.db.get(unaffected))).toEqual(
    unaffectedBefore,
  );
  expect(await alice.query(api.routines.list, {})).toHaveLength(3);
});

it("leaves routines intact when exercise deletion checks reject the request", async () => {
  const { t, alice, bob, exercises, muscles } = await setup();
  const custom = await alice.mutation(api.strength.addExercise, {
    name: "Logged exercise",
    muscleIds: [muscles[0]._id],
  });
  const id = await alice.mutation(api.routines.create, {
    name: "Protected",
    exerciseIds: [custom, exercises[0]._id],
  });
  const before = await t.run((ctx) => ctx.db.get(id));
  await expect(
    bob.mutation(api.strength.deleteExercise, { id: custom }),
  ).rejects.toThrow("Exercise not found.");
  await expect(
    alice.mutation(api.strength.deleteExercise, { id: exercises[0]._id }),
  ).rejects.toThrow("Only custom exercises can be deleted.");
  await alice.mutation(api.strength.logSession, {
    trainedAt: 1000,
    note: "",
    entries: [{ exerciseId: custom, sets: [{ reps: 10, weightKg: 0 }] }],
  });
  await expect(
    alice.mutation(api.strength.deleteExercise, { id: custom }),
  ).rejects.toThrow("Delete the workouts using this exercise first.");
  expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
});

it("skips missing and foreign exercises while preserving the remaining order", async () => {
  const { t, alice, exercises, bobExercises } = await setup();
  const id = await alice.mutation(api.routines.create, {
    name: "Stale routine",
    exerciseIds: [exercises[2]._id, exercises[1]._id, exercises[0]._id],
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(exercises[1]._id);
    await ctx.db.patch(id, {
      exerciseIds: [
        exercises[2]._id,
        exercises[1]._id,
        bobExercises[0]._id,
        exercises[0]._id,
      ],
    });
  });
  expect(await alice.query(api.routines.list, {})).toEqual([
    {
      _id: id,
      name: "Stale routine",
      lastUsedAt: null,
      exercises: [exercises[2], exercises[0]],
    },
  ]);
  await t.run(async (ctx) => {
    await ctx.db.delete(exercises[2]._id);
    await ctx.db.delete(exercises[0]._id);
  });
  expect(await alice.query(api.routines.list, {})).toEqual([
    { _id: id, name: "Stale routine", lastUsedAt: null, exercises: [] },
  ]);
});
