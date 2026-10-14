import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { FunctionArgs } from "convex/server";
import type { GenericDatabaseWriter, GenericDataModel } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { photoDigest } from "../lib/photo";
import { DEV_ISSUER, DEV_USER } from "../lib/dev-auth-config";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-10-15T12:00:00Z");
const photoFields = { pose: "front", day: "2026-10-15", takenAt: now } as const;
const expiredMessage = "Photo upload expired. Please choose the photo again.";
const metadataMessage = "Photo must be the uploaded JPEG, under 3 MB.";

function setup() {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const t = convexTest(schema, modules);
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}

async function upload(
  context: ReturnType<typeof setup>,
  blob = new Blob(["progress photo"], { type: "image/jpeg" }),
) {
  const sha256 = await photoDigest(blob);
  const { ticketId } = await context.alice.mutation(api.meals.uploadUrl, {
    sha256,
  });
  const storageId = await context.t.run(async (ctx) => {
    const id = await ctx.storage.store(blob);
    // convex-test omits contentType. Supply the metadata that Convex stores.
    const storageDb: GenericDatabaseWriter<GenericDataModel> = ctx.db;
    await storageDb.patch(id, { contentType: blob.type });
    return id;
  });
  return { ticketId, storageId };
}

async function addPhoto(
  context: ReturnType<typeof setup>,
  fields: Partial<
    Pick<FunctionArgs<typeof api.progress.add>, "pose" | "day" | "takenAt">
  > = {},
) {
  const uploaded = await upload(context);
  const id = await context.alice.mutation(api.progress.add, {
    ...uploaded,
    ...photoFields,
    ...fields,
  });
  return { ...uploaded, id };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("progress photo uploads", () => {
  it("stores real blobs with Convex upload metadata in the test fixture", async () => {
    const context = setup();
    const { storageId } = await upload(context);
    expect(
      await context.t.run((ctx) => ctx.db.system.get(storageId)),
    ).toMatchObject({
      contentType: "image/jpeg",
      size: 14,
      sha256: await photoDigest(new Blob(["progress photo"])),
    });
  });

  it("issues owned ten-minute upload tickets and consumes them on add", async () => {
    const context = setup();
    const sha256 = await photoDigest(new Blob(["progress photo"]));
    const ticket = await context.alice.mutation(api.progress.uploadUrl, {
      sha256,
    });
    expect(ticket.url).toMatch(/^https:\/\//);
    expect(
      await context.t.run((ctx) => ctx.db.get(ticket.ticketId)),
    ).toMatchObject({ userId: "alice", sha256, expiresAt: now + 600_000 });
    const { storageId } = await upload(context);
    const id = await context.alice.mutation(api.progress.add, {
      ...photoFields,
      storageId,
      ticketId: ticket.ticketId,
    });
    expect(await context.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      userId: "alice",
      storageId,
      ...photoFields,
    });
    expect(
      await context.t.run((ctx) => ctx.db.get(ticket.ticketId)),
    ).toBeNull();
    await expect(
      context.alice.mutation(api.progress.add, {
        ...photoFields,
        storageId,
        ticketId: ticket.ticketId,
      }),
    ).rejects.toThrow(expiredMessage);
  });

  it.each(["", "0".repeat(64), "A".repeat(44), `${"!".repeat(43)}=`])(
    "rejects invalid digest %j",
    async (sha256) => {
      const { alice } = setup();
      await expect(
        alice.mutation(api.progress.uploadUrl, { sha256 }),
      ).rejects.toThrow("Invalid photo digest.");
    },
  );

  it("rejects unauthenticated uploads, adds, lists, and removes", async () => {
    const context = setup();
    const uploaded = await upload(context);
    await expect(
      context.t.mutation(api.progress.uploadUrl, {
        sha256: await photoDigest(new Blob(["photo"])),
      }),
    ).rejects.toThrow("Sign in to continue.");
    await expect(context.t.query(api.progress.list, {})).rejects.toThrow(
      "Sign in to continue.",
    );
    await expect(
      context.t.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow("Sign in to continue.");
    const { id } = await addPhoto(context);
    await expect(
      context.t.mutation(api.progress.remove, { id }),
    ).rejects.toThrow("Sign in to continue.");
  });

  it("rejects foreign, expired, and missing tickets without consuming them", async () => {
    const context = setup();
    const uploaded = await upload(context);
    await expect(
      context.bob.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow(expiredMessage);
    expect(
      await context.t.run((ctx) => ctx.db.get(uploaded.ticketId)),
    ).not.toBeNull();
    await context.t.run((ctx) =>
      ctx.db.patch(uploaded.ticketId, { expiresAt: now - 1 }),
    );
    await expect(
      context.alice.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow(expiredMessage);
    expect(
      await context.t.run((ctx) => ctx.db.get(uploaded.ticketId)),
    ).not.toBeNull();
    await context.t.run((ctx) => ctx.db.delete(uploaded.ticketId));
    await expect(
      context.alice.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow(expiredMessage);
  });

  it.each(["image/png", "application/octet-stream", ""])(
    "rejects content type %j",
    async (type) => {
      const context = setup();
      const uploaded = await upload(context, new Blob(["photo"], { type }));
      await expect(
        context.alice.mutation(api.progress.add, {
          ...uploaded,
          ...photoFields,
        }),
      ).rejects.toThrow(metadataMessage);
      expect(
        await context.t.run((ctx) => ctx.db.get(uploaded.ticketId)),
      ).not.toBeNull();
    },
  );

  it("rejects missing content type, digest mismatch, and deleted storage", async () => {
    const context = setup();
    const uploaded = await upload(context);
    await context.t.run(async (ctx) => {
      const storageDb: GenericDatabaseWriter<GenericDataModel> = ctx.db;
      await storageDb.patch(uploaded.storageId, { contentType: undefined });
    });
    await expect(
      context.alice.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow(metadataMessage);
    await context.t.run(async (ctx) => {
      const storageDb: GenericDatabaseWriter<GenericDataModel> = ctx.db;
      await storageDb.patch(uploaded.storageId, { contentType: "image/jpeg" });
      await ctx.db.patch(uploaded.ticketId, { sha256: "A".repeat(43) + "=" });
    });
    await expect(
      context.alice.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow(metadataMessage);
    await context.t.run((ctx) => ctx.storage.delete(uploaded.storageId));
    await expect(
      context.alice.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow(metadataMessage);
  });

  it.each([3_000_000, 3_000_001])(
    "enforces the JPEG byte limit at %i",
    async (size) => {
      const context = setup();
      const uploaded = await upload(
        context,
        new Blob([new Uint8Array(size)], { type: "image/jpeg" }),
      );
      const added = context.alice.mutation(api.progress.add, {
        ...uploaded,
        ...photoFields,
      });
      if (size === 3_000_000)
        await expect(added).resolves.toEqual(expect.any(String));
      else await expect(added).rejects.toThrow(metadataMessage);
    },
  );

  it("rejects malformed storage IDs", async () => {
    const context = setup();
    const { ticketId } = await upload(context);
    await expect(
      context.alice.mutation(api.progress.add, {
        ticketId,
        storageId: "invalid",
        ...photoFields,
      }),
    ).rejects.toThrow("Invalid photo ID.");
  });

  it("rejects storage reuse from meals to progress across users", async () => {
    const context = setup();
    const uploaded = await upload(context);
    const mealId = await context.alice.mutation(internal.meals.register, {
      ...uploaded,
      at: now,
    });
    const sha256 = await photoDigest(new Blob(["progress photo"]));
    for (const user of [context.alice, context.bob]) {
      const { ticketId } = await user.mutation(api.progress.uploadUrl, {
        sha256,
      });
      await expect(
        user.mutation(api.progress.add, {
          ticketId,
          storageId: uploaded.storageId,
          ...photoFields,
        }),
      ).rejects.toThrow("Photo is already attached to a meal.");
      expect(await context.t.run((ctx) => ctx.db.get(ticketId))).not.toBeNull();
    }
    expect(await context.t.run((ctx) => ctx.db.get(mealId))).not.toBeNull();
  });

  it("rejects storage reuse from progress to meals or progress across users", async () => {
    const context = setup();
    const { storageId } = await addPhoto(context);
    const sha256 = await photoDigest(new Blob(["progress photo"]));
    for (const user of [context.alice, context.bob]) {
      const { ticketId } = await user.mutation(api.meals.uploadUrl, { sha256 });
      await expect(
        user.mutation(internal.meals.register, {
          ticketId,
          storageId,
          at: now,
        }),
      ).rejects.toThrow("Photo is already attached to a progress photo.");
      await expect(
        user.mutation(api.progress.add, {
          ticketId,
          storageId,
          ...photoFields,
        }),
      ).rejects.toThrow("Photo is already attached to a progress photo.");
      expect(await context.t.run((ctx) => ctx.db.get(ticketId))).not.toBeNull();
    }
  });

  it("meals reject storage already owned by a progress photo", async () => {
    const context = setup();
    const uploaded = await upload(context);
    await context.t.run((ctx) =>
      ctx.db.insert("progressPhotos", {
        userId: "alice",
        storageId: uploaded.storageId,
        ...photoFields,
      }),
    );
    await expect(
      context.alice.mutation(internal.meals.register, {
        ...uploaded,
        at: now,
      }),
    ).rejects.toThrow("Photo is already attached to a progress photo.");
  });

  it("allows the 200th photo and rejects the 201st without consuming its ticket", async () => {
    const context = setup();
    await context.t.run(async (ctx) => {
      for (const userId of ["alice", "bob"]) {
        for (let i = 0; i < 199; i++) {
          const storageId = await ctx.storage.store(new Blob([String(i)]));
          await ctx.db.insert("progressPhotos", {
            userId,
            storageId,
            ...photoFields,
          });
        }
      }
    });
    const { id } = await addPhoto(context);
    expect(await context.alice.query(api.progress.list, {})).toHaveLength(200);
    const uploaded = await upload(context);
    await expect(
      context.alice.mutation(api.progress.add, { ...uploaded, ...photoFields }),
    ).rejects.toThrow("You can keep up to 200 progress photos.");
    expect(
      await context.t.run((ctx) => ctx.db.get(uploaded.ticketId)),
    ).not.toBeNull();
    await context.alice.mutation(api.progress.remove, { id });
    await context.alice.mutation(api.progress.add, {
      ...uploaded,
      ...photoFields,
    });
    expect(await context.alice.query(api.progress.list, {})).toHaveLength(200);
  });

  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-01",
    "2026-10-15T00:00:00Z",
    "",
  ])("rejects invalid local day %j", async (day) => {
    const context = setup();
    const uploaded = await upload(context);
    await expect(
      context.alice.mutation(api.progress.add, {
        ...uploaded,
        ...photoFields,
        day,
      }),
    ).rejects.toThrow("Use a valid YYYY-MM-DD day.");
  });

  it.each([NaN, Infinity, -Infinity, -1, 8_640_000_000_000_001, now + 300_001])(
    "rejects invalid takenAt %j",
    async (takenAt) => {
      const context = setup();
      const uploaded = await upload(context);
      await expect(
        context.alice.mutation(api.progress.add, {
          ...uploaded,
          ...photoFields,
          takenAt,
        }),
      ).rejects.toThrow("Invalid timestamp.");
    },
  );

  it("accepts a leap day and the five-minute future boundary with every pose", async () => {
    const context = setup();
    for (const pose of ["front", "side", "back"] as const) {
      const uploaded = await upload(context);
      await expect(
        context.alice.mutation(api.progress.add, {
          ...uploaded,
          pose,
          day: "2024-02-29",
          takenAt: now + 300_000,
        }),
      ).resolves.toEqual(expect.any(String));
    }
  });

  it.each(["three-quarter", "Front", "", null, 1])(
    "rejects invalid pose %j",
    async (pose) => {
      const context = setup();
      const uploaded = await upload(context);
      const add = makeFunctionReference<"mutation">("progress:add");
      await expect(
        context.alice.mutation(add, { ...uploaded, ...photoFields, pose }),
      ).rejects.toThrow();
      expect(await context.alice.query(api.progress.list, {})).toEqual([]);
    },
  );
});

describe("progress photo reads and deletion", () => {
  it("orders by local day then takenAt and joins only owned same-day weights", async () => {
    const context = setup();
    const older = await addPhoto(context, { day: "2026-10-14", takenAt: now });
    const firstToday = await addPhoto(context, { takenAt: now - 2 });
    const latest = await addPhoto(context);
    const noWeight = await addPhoto(context, { day: "2026-10-13" });
    const noCheckin = await addPhoto(context, { day: "2026-10-12" });
    await context.alice.mutation(api.checkins.upsert, {
      day: "2026-10-15",
      weightKg: 75,
    });
    await context.alice.mutation(api.checkins.upsert, {
      day: "2026-10-14",
      weightKg: 76,
    });
    await context.alice.mutation(api.checkins.upsert, {
      day: "2026-10-13",
      mood: 3,
    });
    await context.bob.mutation(api.checkins.upsert, {
      day: "2026-10-12",
      weightKg: 99,
    });
    await context.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["bob"]));
      await ctx.db.insert("progressPhotos", {
        userId: "bob",
        storageId,
        ...photoFields,
      });
    });
    expect(await context.alice.query(api.progress.list, {})).toEqual([
      { id: latest.id, url: expect.any(String), ...photoFields, weightKg: 75 },
      {
        id: firstToday.id,
        url: expect.any(String),
        ...photoFields,
        takenAt: now - 2,
        weightKg: 75,
      },
      {
        id: older.id,
        url: expect.any(String),
        ...photoFields,
        day: "2026-10-14",
        weightKg: 76,
      },
      {
        id: noWeight.id,
        url: expect.any(String),
        ...photoFields,
        day: "2026-10-13",
        weightKg: null,
      },
      {
        id: noCheckin.id,
        url: expect.any(String),
        ...photoFields,
        day: "2026-10-12",
        weightKg: null,
      },
    ]);
    expect(await context.bob.query(api.progress.list, {})).toHaveLength(1);
    expect(
      await context.t
        .withIdentity({ subject: "new" })
        .query(api.progress.list, {}),
    ).toEqual([]);
    await context.alice.mutation(api.checkins.upsert, {
      day: "2026-10-15",
      weightKg: 74,
    });
    expect((await context.alice.query(api.progress.list, {}))[0].weightKg).toBe(
      74,
    );
    await context.t.run((ctx) => ctx.storage.delete(latest.storageId));
    expect(
      (await context.alice.query(api.progress.list, {}))[0].url,
    ).toBeNull();
  });

  it("removes the owned row and storage and rejects foreign or missing photos", async () => {
    const context = setup();
    const { id, storageId } = await addPhoto(context);
    await expect(
      context.bob.mutation(api.progress.remove, { id }),
    ).rejects.toThrow("Photo not found.");
    expect(
      await context.t.run(
        async (ctx) => (await ctx.storage.get(storageId)) !== null,
      ),
    ).toBe(true);
    expect(await context.t.run((ctx) => ctx.db.get(id))).not.toBeNull();
    expect(
      await context.alice.mutation(api.progress.remove, { id }),
    ).toBeNull();
    expect(await context.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    expect(await context.t.run((ctx) => ctx.db.get(id))).toBeNull();
    expect(await context.alice.query(api.progress.list, {})).toEqual([]);
    await expect(
      context.alice.mutation(api.progress.remove, { id }),
    ).rejects.toThrow("Photo not found.");
  });

  it("exports only owned progress metadata without URLs, storage IDs, or bookkeeping", async () => {
    const context = setup();
    await addPhoto(context);
    await context.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["bob"]));
      await ctx.db.insert("progressPhotos", {
        userId: "bob",
        storageId,
        ...photoFields,
        pose: "back",
      });
    });
    const data = await context.alice.query(api.exportData.all, {});
    expect(data.progressPhotos).toEqual([photoFields]);
    expect(
      (await context.bob.query(api.exportData.all, {})).progressPhotos,
    ).toEqual([{ ...photoFields, pose: "back" }]);
    expect(
      (
        await context.t
          .withIdentity({ subject: "new" })
          .query(api.exportData.all, {})
      ).progressPhotos,
    ).toEqual([]);
    for (const field of [
      "url",
      "storageId",
      "userId",
      "_creationTime",
      "sha256",
    ]) {
      expect(JSON.stringify(data.progressPhotos)).not.toContain(field);
    }
  });

  it("demo reset deletes owned progress rows and storage and preserves other users", async () => {
    const context = setup();
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    vi.stubEnv("DEV_AUTH_JWKS", "configured");
    const dev = context.t.withIdentity({
      subject: DEV_USER,
      issuer: DEV_ISSUER,
    });
    const photos = await context.t.run(async (ctx) => {
      const result = [];
      for (const userId of [DEV_USER, "bob"]) {
        const storageId = await ctx.storage.store(new Blob([userId]));
        const id = await ctx.db.insert("progressPhotos", {
          userId,
          storageId,
          ...photoFields,
        });
        result.push({ id, storageId });
      }
      return result;
    });
    const start = Date.parse("2026-10-15T00:00:00Z");
    await dev.mutation(internal.demo.replace, {
      now,
      days: Array.from({ length: 14 }, (_, i) => start - i * 86_400_000),
      meals: [],
    });
    expect(await context.t.run((ctx) => ctx.db.get(photos[0].id))).toBeNull();
    expect(await dev.query(api.progress.list, {})).toEqual([]);
    expect(
      await context.t.run((ctx) => ctx.storage.get(photos[0].storageId)),
    ).toBeNull();
    expect(await context.bob.query(api.progress.list, {})).toHaveLength(1);
    expect(
      await context.t.run((ctx) => ctx.db.get(photos[1].id)),
    ).not.toBeNull();
    expect(
      await context.t.run(
        async (ctx) => (await ctx.storage.get(photos[1].storageId)) !== null,
      ),
    ).toBe(true);
  });
});
