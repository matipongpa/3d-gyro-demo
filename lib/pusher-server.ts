/**
 * Server-only Pusher client.
 *
 * Imported by the /api/sensor route to publish gyro events to the channel.
 * Reads the SECRET key — must NEVER be imported from client components.
 *
 * Lazy initialization:
 *   We use a module-level singleton so multiple API invocations on the same
 *   warm Lambda share the same Pusher instance instead of re-creating it
 *   on every request (small perf win, harmless if cold).
 *
 * Why a custom `getPusherServer()` instead of just `export const pusher = ...`:
 *   The factory pattern lets us throw a clear error when env vars are missing
 *   (instead of letting the Pusher constructor fail with a less obvious
 *   message). Better DX during setup.
 */

import Pusher from "pusher";

let cached: Pusher | null = null;

export function getPusherServer(): Pusher {
  if (cached) return cached;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    throw new Error(
      "Missing Pusher env vars. Required: PUSHER_APP_ID, PUSHER_KEY, " +
        "PUSHER_SECRET, PUSHER_CLUSTER. See .env.local.example."
    );
  }

  cached = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });

  return cached;
}
