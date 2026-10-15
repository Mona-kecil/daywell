import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { requireUser } from "./model";
import { validBarcode } from "../lib/barcode";
import { lookupBarcode as lookupFdcBarcode, searchFoods } from "../lib/fdc";
import { fdcMode } from "../lib/local-deployment";

export const search = action({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const query = args.query.trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 80)
      throw new ConvexError("Search for a food name of 2 to 80 characters.");
    try {
      return await searchFoods(
        query,
        process.env.USDA_FDC_API_KEY,
        fdcMode(process.env),
      );
    } catch {
      throw new ConvexError(
        "Food search is unavailable right now. Please try again.",
      );
    }
  },
});

export const lookupBarcode = action({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    if (!validBarcode(args.code))
      throw new ConvexError(
        "Use a valid EAN-8, EAN-13 or UPC-A barcode with its check digit.",
      );
    return lookupFdcBarcode(
      args.code,
      process.env.USDA_FDC_API_KEY,
      fdcMode(process.env),
    );
  },
});
