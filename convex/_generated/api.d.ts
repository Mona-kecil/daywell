/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as achievements from "../achievements.js";
import type * as checkinModel from "../checkinModel.js";
import type * as checkins from "../checkins.js";
import type * as coach from "../coach.js";
import type * as coachChat from "../coachChat.js";
import type * as coachChatProviders_fake from "../coachChatProviders/fake.js";
import type * as coachChatProviders_index from "../coachChatProviders/index.js";
import type * as coachChatProviders_openai from "../coachChatProviders/openai.js";
import type * as coachChatProviders_types from "../coachChatProviders/types.js";
import type * as coachCron from "../coachCron.js";
import type * as coachData from "../coachData.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as demoSeed from "../demoSeed.js";
import type * as exerciseModel from "../exerciseModel.js";
import type * as exportData from "../exportData.js";
import type * as food from "../food.js";
import type * as historyData from "../historyData.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as mealActions from "../mealActions.js";
import type * as mealVision_fake from "../mealVision/fake.js";
import type * as mealVision_index from "../mealVision/index.js";
import type * as mealVision_openai from "../mealVision/openai.js";
import type * as mealVision_types from "../mealVision/types.js";
import type * as meals from "../meals.js";
import type * as model from "../model.js";
import type * as push from "../push.js";
import type * as pushActions from "../pushActions.js";
import type * as pushProviders_fake from "../pushProviders/fake.js";
import type * as pushProviders_types from "../pushProviders/types.js";
import type * as pushProviders_webpush from "../pushProviders/webpush.js";
import type * as quickLog from "../quickLog.js";
import type * as quickLogProviders_fake from "../quickLogProviders/fake.js";
import type * as quickLogProviders_index from "../quickLogProviders/index.js";
import type * as quickLogProviders_openai from "../quickLogProviders/openai.js";
import type * as quickLogProviders_types from "../quickLogProviders/types.js";
import type * as routines from "../routines.js";
import type * as shortcuts from "../shortcuts.js";
import type * as strength from "../strength.js";
import type * as tracker from "../tracker.js";
import type * as validators from "../validators.js";
import type * as weeklyReviewCron from "../weeklyReviewCron.js";
import type * as weeklyReviewData from "../weeklyReviewData.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  achievements: typeof achievements;
  checkinModel: typeof checkinModel;
  checkins: typeof checkins;
  coach: typeof coach;
  coachChat: typeof coachChat;
  "coachChatProviders/fake": typeof coachChatProviders_fake;
  "coachChatProviders/index": typeof coachChatProviders_index;
  "coachChatProviders/openai": typeof coachChatProviders_openai;
  "coachChatProviders/types": typeof coachChatProviders_types;
  coachCron: typeof coachCron;
  coachData: typeof coachData;
  crons: typeof crons;
  demo: typeof demo;
  demoSeed: typeof demoSeed;
  exerciseModel: typeof exerciseModel;
  exportData: typeof exportData;
  food: typeof food;
  historyData: typeof historyData;
  http: typeof http;
  insights: typeof insights;
  mealActions: typeof mealActions;
  "mealVision/fake": typeof mealVision_fake;
  "mealVision/index": typeof mealVision_index;
  "mealVision/openai": typeof mealVision_openai;
  "mealVision/types": typeof mealVision_types;
  meals: typeof meals;
  model: typeof model;
  push: typeof push;
  pushActions: typeof pushActions;
  "pushProviders/fake": typeof pushProviders_fake;
  "pushProviders/types": typeof pushProviders_types;
  "pushProviders/webpush": typeof pushProviders_webpush;
  quickLog: typeof quickLog;
  "quickLogProviders/fake": typeof quickLogProviders_fake;
  "quickLogProviders/index": typeof quickLogProviders_index;
  "quickLogProviders/openai": typeof quickLogProviders_openai;
  "quickLogProviders/types": typeof quickLogProviders_types;
  routines: typeof routines;
  shortcuts: typeof shortcuts;
  strength: typeof strength;
  tracker: typeof tracker;
  validators: typeof validators;
  weeklyReviewCron: typeof weeklyReviewCron;
  weeklyReviewData: typeof weeklyReviewData;
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
