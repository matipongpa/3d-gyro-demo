/**
 * POST /api/sensor
 *
 * Receives a SensorMessage from /phone and relays it to all dashboard
 * subscribers via Pusher.
 *
 * Why a route handler instead of a client-side Pusher publish:
 *   Public-channel client events on Pusher require a paid plan AND a private
 *   channel with auth. Doing it server-side keeps everything on the free tier
 *   and centralizes the secret. The latency cost is one extra hop, but with
 *   sin1 → ap-southeast-1 that's ~5ms — negligible.
 *
 * Region pinning:
 *   `preferredRegion = "sin1"` keeps this Lambda in Singapore, matching the
 *   Pusher cluster (also ap-southeast-1). Phone → Vercel → Pusher latency
 *   stays under ~40ms total from Bangkok.
 *
 * Validation:
 *   We re-run isSensorMessage() on the incoming body before triggering Pusher.
 *   Even though /phone always sends a valid shape, an external caller could
 *   POST garbage to this endpoint. Defense in depth.
 */

import { NextResponse } from "next/server";
import { getPusherServer } from "@/lib/pusher-server";
import {
  SENSOR_CHANNEL_NAME,
  SENSOR_EVENT_NAME,
  isSensorMessage,
} from "@/lib/sensor-channel";

export const runtime = "nodejs"; // Pusher SDK needs Node runtime (uses crypto)
export const preferredRegion = "sin1"; // Singapore — matches Pusher cluster

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isSensorMessage(body)) {
    return NextResponse.json(
      { error: "Body does not match SensorMessage schema" },
      { status: 422 }
    );
  }

  try {
    const pusher = getPusherServer();
    await pusher.trigger(SENSOR_CHANNEL_NAME, SENSOR_EVENT_NAME, body);
  } catch (err) {
    // Don't leak internals to the client — log + return generic error.
    console.error("[/api/sensor] Pusher trigger failed:", err);
    return NextResponse.json(
      { error: "Upstream relay failed" },
      { status: 502 }
    );
  }

  // 204 No Content — we don't need to send anything back.
  // Saves a few bytes per call (multiplied by 30Hz it adds up).
  return new NextResponse(null, { status: 204 });
}
