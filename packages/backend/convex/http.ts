import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

const http = httpRouter();

/**
 * Clerk webhook endpoint: https://<deployment>.convex.site/clerk-webhook
 * Subscribe to user.*, organization.* and organizationMembership.* events and set
 * CLERK_WEBHOOK_SECRET in the Convex dashboard.
 */
http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) return new Response("CLERK_WEBHOOK_SECRET not configured", { status: 500 });
    const payload = await request.text();
    const headers = {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    };
    let event: { type: string; data: unknown };
    try {
      event = new Webhook(secret).verify(payload, headers) as { type: string; data: unknown };
    } catch (err) {
      console.error("Clerk webhook signature verification failed", err);
      return new Response("Invalid signature", { status: 400 });
    }
    await ctx.runMutation(internal.webhooks.handleClerkEvent, { type: event.type, data: event.data });
    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response(JSON.stringify({ ok: true, time: Date.now() }), { headers: { "content-type": "application/json" } })),
});

export default http;
