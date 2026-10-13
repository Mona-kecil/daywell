import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("coach check-ins", { minutes: 15 }, internal.coachCron.run, {});
export default crons;
