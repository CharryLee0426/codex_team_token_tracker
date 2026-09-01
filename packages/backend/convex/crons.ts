import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("cleanup expired device auth requests", { hours: 1 }, internal.deviceAuth.cleanupExpired, {});
export default crons;
