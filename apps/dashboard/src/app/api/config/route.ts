import { NextResponse } from "next/server";
import { WIRE_VERSION } from "@codex-tracker/shared/wire";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

/** Discovery endpoint used by the menu bar app / agent to find the Convex deployment. */
export function GET(request: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return NextResponse.json(
    {
      convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? null,
      dashboardUrl: origin,
      appName: "Codex Tracker",
      wireVersion: WIRE_VERSION,
    },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
