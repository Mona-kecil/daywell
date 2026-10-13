import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { requireUser } from "./model";
import { validBarcode } from "../lib/barcode";
import { lookupBarcode as lookupFdcBarcode } from "../lib/fdc";
import { fdcMode } from "../lib/local-deployment";

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
