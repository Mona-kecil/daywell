import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("coach check-ins", { minutes: 15 }, internal.coachCron.run, {});
crons.interval(
  "coach weekly review",
  { minutes: 15 },
  internal.weeklyReviewCron.run,
  {},
);
export default crons;
