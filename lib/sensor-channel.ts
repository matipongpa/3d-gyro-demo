/**
 * Shared definitions for the gyro pub/sub pipeline.
 *
 * Architecture (v2 — Pusher-based, cross-device):
 *
 *   [iPhone Safari]                            [Desktop browser]
 *      /phone                                      /dashboard
 *         │                                           ▲
 *         ▼ POST /api/sensor (JSON, throttled ~30Hz)  │ subscribes via pusher-js
 *      Next.js API route                              │
 *         │                                           │
 *         └─ pusher.trigger(CHANNEL, EVENT, msg) ─────┘
 *                          │
 *                          ▼
 *                  Pusher cloud cluster
 *                  (managed pub/sub relay)
 *
 * This module holds ONLY the things that both server and client need to agree on:
 *   - Channel name (where to publish/subscribe)
 *   - Event name (what to look for on the channel)
 *   - Message shape (the SensorMessage type)
 *   - Runtime validation (isSensorMessage type guard)
 *
 * Pusher client/server SDK setup lives in lib/pusher-server.ts (server-only,
 * uses the secret) and is instantiated lazily in /dashboard for the browser.
 *
 * Why we moved off BroadcastChannel (v1):
 *   BroadcastChannel only works between same-origin tabs on the SAME device.
 *   For a real cross-device demo (phone in your hand, dashboard on a laptop),
 *   we need a relay that both sides can reach over the public internet.
 *   Pusher is the simplest managed option — sub-100ms latency, free tier covers
 *   portfolio use, swappable later for AWS IoT Core or a self-hosted WebSocket.
 */

/** Pusher channel name. Public channel — no auth required. */
export const SENSOR_CHANNEL_NAME = "gyro-sensor";

/** Pusher event name on that channel. */
export const SENSOR_EVENT_NAME = "orientation";

/** Pusher event name for geometry selection updates from /phone. */
export const GEOMETRY_EVENT_NAME = "geometry";

/** Allowed geometry kinds the phone can request the dashboard to render. */
export const GEOMETRY_KINDS = ["sphere", "box", "torus", "cone"] as const;
export type GeometryKind = (typeof GEOMETRY_KINDS)[number];

export type GeometryMessage = {
  type: "geometry";
  geometry: GeometryKind;
  timestamp: number;
};

export function isGeometryMessage(data: unknown): data is GeometryMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  return (
    m.type === "geometry" &&
    typeof m.geometry === "string" &&
    (GEOMETRY_KINDS as readonly string[]).includes(m.geometry) &&
    typeof m.timestamp === "number"
  );
}

/**
 * The message payload the phone publishes and the dashboard consumes.
 *
 *   alpha — rotation around Z axis (compass heading): 0–360°
 *   beta  — rotation around X axis (front-to-back tilt): -180° to 180°
 *   gamma — rotation around Y axis (left-to-right tilt): -90° to 90°
 *   timestamp — ms since epoch when the value was captured on the phone.
 *               Used by /dashboard to detect stale data (e.g., phone unplugged).
 */
export type SensorMessage = {
  type: "orientation";
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  timestamp: number;
};

/**
 * Runtime type guard — verifies an arbitrary payload matches SensorMessage.
 *
 * Why it's needed:
 *   pusher-js delivers each event as `unknown`. Without this check we'd be
 *   trusting whatever JSON came over the wire. A malformed payload would
 *   crash the dashboard or produce garbage rotations.
 *
 * Also used by the /api/sensor route to validate the incoming POST body
 * before triggering Pusher — defense in depth.
 */
export function isSensorMessage(data: unknown): data is SensorMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  return (
    m.type === "orientation" &&
    (typeof m.alpha === "number" || m.alpha === null) &&
    (typeof m.beta === "number" || m.beta === null) &&
    (typeof m.gamma === "number" || m.gamma === null) &&
    typeof m.timestamp === "number"
  );
}
