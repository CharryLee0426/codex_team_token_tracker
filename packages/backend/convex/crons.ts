import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("cleanup expired device auth requests", { hours: 1 }, internal.deviceAuth.cleanupExpired, {});
// Keep the price table current with OpenAI's published list prices; a changed table re-prices history.
crons.interval("refresh OpenAI pricing", { hours: 1 }, internal.pricing.refresh, {});
export default crons;
