/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as coach from "../coach.js";
import type * as demo from "../demo.js";
import type * as demoSeed from "../demoSeed.js";
import type * as insights from "../insights.js";
import type * as mealActions from "../mealActions.js";
import type * as mealVision_fake from "../mealVision/fake.js";
import type * as mealVision_index from "../mealVision/index.js";
import type * as mealVision_types from "../mealVision/types.js";
import type * as meals from "../meals.js";
import type * as model from "../model.js";
import type * as tracker from "../tracker.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  coach: typeof coach;
  demo: typeof demo;
  demoSeed: typeof demoSeed;
  insights: typeof insights;
  mealActions: typeof mealActions;
  "mealVision/fake": typeof mealVision_fake;
  "mealVision/index": typeof mealVision_index;
  "mealVision/types": typeof mealVision_types;
  meals: typeof meals;
  model: typeof model;
  tracker: typeof tracker;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
