import { v, ConvexError } from "convex/values";
import type { FunctionArgs } from "convex/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireDevUser } from "./demo";
import { groundFood } from "../lib/fdc";

const menus = [
  {
    description: "Oatmeal with banana and Greek yogurt",
    foods: [
      ["oatmeal", 240],
      ["banana", 110],
      ["Greek yogurt", 170],
    ],
  },
  {
    description: "Grilled chicken, white rice and broccoli",
    foods: [
      ["chicken breast grilled", 150],
      ["white rice cooked", 180],
      ["broccoli", 100],
      ["olive oil", 10],
    ],
  },
  {
    description: "Salmon pasta with broccoli",
    foods: [
      ["salmon", 140],
      ["pasta cooked", 200],
      ["broccoli", 100],
    ],
  },
  {
    description: "Egg and avocado on whole-wheat bread",
    foods: [
      ["egg", 100],
      ["avocado", 70],
      ["bread", 80],
    ],
  },
] satisfies { description: string; foods: [string, number][] }[];

export const run = action({
  args: {
    now: v.number(),
    checkinDays: v.optional(v.array(v.string())),
    days: v.array(v.number()),
    photos: v.array(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    days: number;
    workouts: number;
    water: number;
    meals: number;
    muscles: number;
    checkins: number;
  }> => {
    await requireDevUser(ctx);
    if (
      args.days.length !== 14 ||
      args.photos.length !== menus.length ||
      !Number.isFinite(args.now)
    )
      throw new ConvexError("Invalid demo seed input.");
    const photos = args.photos.map(
      (encoded) =>
        new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], {
          type: "image/jpeg",
        }),
    );
    if (photos.some((photo) => photo.size > 3_000_000))
      throw new ConvexError("Demo photo exceeds 3 MB.");
    const stored: Id<"_storage">[] = [];
    try {
      const meals: FunctionArgs<typeof internal.demo.replace>["meals"] = [];
      // Keep the caller's recent civil-day starts; add history for patterns.
      const days = Array.from(
        { length: 36 },
        (_, i) => args.days[i] ?? args.days[0] - i * 86_400_000,
      );
      for (const [offset, start] of days.entries()) {
        const count = 2 + (offset % 3);
        for (let slot = 0; slot < count; slot++) {
          const menuIndex = (slot + offset) % menus.length;
          const menu = menus[menuIndex];
          const items = await Promise.all(
            menu.foods.map(([name, grams], i) =>
              groundFood(
                { id: `demo-${i}`, name, grams, searchQuery: name },
                undefined,
                "fixture",
              ),
            ),
          );
          const storageId = await ctx.storage.store(photos[menuIndex]);
          stored.push(storageId);
          const at =
            offset === 0
              ? start + ((args.now - start) * (slot + 1)) / (count + 1)
              : start + [8, 13, 19, 21][slot] * 3_600_000;
          meals.push({ storageId, at, description: menu.description, items });
        }
      }
      const savedMeals = [
        {
          description: menus[0].description,
          name: menus[0].description,
          servings: 2,
        },
        {
          description: menus[1].description,
          name: "Chicken rice bowl",
          servings: 1,
        },
      ].map(({ description, name, servings }) => {
        const meal = meals.find((meal) => meal.description === description);
        if (!meal) throw new ConvexError("Missing demo recipe.");
        return {
          name,
          servings,
          items: meal.items.flatMap((item) =>
            item.status === "matched"
              ? [
                  {
                    name: item.name,
                    grams: item.grams * servings,
                    fdcId: item.fdcId,
                    per100g: item.per100g,
                  },
                ]
              : [],
          ),
        };
      });
      return await ctx.runMutation(internal.demo.replace, {
        now: args.now,
        days: args.days,
        checkinDays: args.checkinDays,
        meals,
        savedMeals,
      });
    } catch (error) {
      for (const id of stored) await ctx.storage.delete(id);
      throw error;
    }
  },
});
