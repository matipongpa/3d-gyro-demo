"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SensorMessage } from "@/lib/sensor-channel";

/**
 * Phone page — runs on the iPhone (or any device with a gyroscope).
 *
 * Flow:
 *   1. User taps "Enable Gyro" button
 *   2. We request DeviceOrientation permission (iOS 13+ requires this on user gesture)
 *   3. Once granted, listen for `deviceorientation` events
 *   4. On every event: update local display AND POST the value to /api/sensor
 *      (server then relays to /dashboard via Pusher).
 *
 * Throttling:
 *   DeviceOrientation fires ~60 times/sec. POSTing each one would burn the
 *   Pusher free tier in under an hour AND saturate the phone radio. We cap
 *   publishes to PUBLISH_INTERVAL_MS (33ms ≈ 30Hz) — visually smooth, well
 *   within free tier even with long demo sessions. Local UI state still
 *   updates at full 60Hz so the on-phone numbers feel responsive.
 *
 * Why iOS needs the permission button:
 *   On Safari iOS 13+, DeviceOrientationEvent.requestPermission() is REQUIRED
 *   and must be called inside a user-initiated event handler (a click).
 *   Without this, events fire but all values are null. Subtle and frustrating.
 */

/** Minimum ms between POSTs to /api/sensor (≈30Hz at 33ms). */
const PUBLISH_INTERVAL_MS = 33;

// TypeScript: iOS Safari extends DeviceOrientationEvent with requestPermission().
// Standard TS types don't include this, so we declare the shape ourselves.
type DeviceOrientationEventConstructor = {
  new (type: string): DeviceOrientationEvent;
  requestPermission?: () => Promise<"granted" | "denied">;
};

type GyroState = {
  alpha: number | null; // rotation around Z axis (compass heading): 0–360
  beta: number | null; // rotation around X axis (front-to-back tilt): -180–180
  gamma: number | null; // rotation around Y axis (left-to-right tilt): -90–90
};

export default function PhonePage() {
  const [permission, setPermission] = useState<
    "idle" | "granted" | "denied" | "unsupported"
  >("idle");
  const [gyro, setGyro] = useState<GyroState>({
    alpha: null,
    beta: null,
    gamma: null,
  });

  const handleReset = useCallback(() => {
    setPermission("idle");
    setGyro({
      alpha: null,
      beta: null,
      gamma: null,
    });
  }, []);

  // Called when user taps the permission button
  const requestPermission = useCallback(async () => {
    const ctor = window.DeviceOrientationEvent as unknown as
      | DeviceOrientationEventConstructor
      | undefined;

    if (!ctor) {
      setPermission("unsupported");
      return;
    }

    // iOS 13+ path: explicit permission required
    if (typeof ctor.requestPermission === "function") {
      try {
        const result = await ctor.requestPermission();
        setPermission(result === "granted" ? "granted" : "denied");
      } catch {
        setPermission("denied");
      }
      return;
    }

    // Android / desktop path: no permission gate, just start listening
    setPermission("granted");
  }, []);

  /**
   * Tracks the last POST timestamp so we can throttle to PUBLISH_INTERVAL_MS.
   * Stored in a ref (not state) so updating it doesn't trigger re-renders —
   * the orientation handler reads/writes it on every gyro event (~60Hz).
   */
  const lastPublishMsRef = useRef<number>(0);

  /**
   * Tracks the latest in-flight publish status. Purely for the on-screen
   * "publishing OK / error" indicator — does not block publishing on error
   * (gyro is a continuous stream; a dropped POST is fine, next one comes
   * in ~33ms).
   */
  const [publishError, setPublishError] = useState<string | null>(null);

  // When permission flips to "granted":
  //   1. Listen for deviceorientation events
  //   2. On each event: update local UI state AND (if throttle allows)
  //      POST the value to /api/sensor for relay through Pusher
  //
  // The cleanup function (returned from the effect) detaches the listener
  // when permission changes back to "idle" (e.g. force reset) or when the
  // component unmounts. This prevents memory leaks and stale handlers.
  useEffect(() => {
    if (permission !== "granted") return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const message: SensorMessage = {
        type: "orientation",
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma,
        timestamp: Date.now(),
      };

      // Always update local display at full 60Hz — feels responsive on the phone
      setGyro({ alpha: event.alpha, beta: event.beta, gamma: event.gamma });

      // Throttle the publish to ~30Hz
      const now = Date.now();
      if (now - lastPublishMsRef.current < PUBLISH_INTERVAL_MS) return;
      lastPublishMsRef.current = now;

      // Fire-and-forget POST. We don't await — the next gyro event will arrive
      // in ~16ms regardless of server response, and we don't want to block.
      fetch("/api/sensor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        keepalive: true, // lets the request finish even if the page is closed
      })
        .then((res) => {
          if (!res.ok) setPublishError(`HTTP ${res.status}`);
          else if (publishError) setPublishError(null);
        })
        .catch((err: unknown) => {
          setPublishError(err instanceof Error ? err.message : "network error");
        });
    };

    window.addEventListener("deviceorientation", handleOrientation);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
    // Intentionally omitting publishError from deps: we don't want to
    // re-attach the listener every time the error state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 p-6 text-zinc-100">
      <h1 className="text-2xl font-semibold">Phone — Gyro Source</h1>

      {permission === "idle" && (
        <button
          onClick={requestPermission}
          className="rounded-md bg-purple-500 px-6 py-3 font-medium hover:bg-blue-600 transition-colors"
        >
          Enable Gyro
        </button>
      )}

      {permission === "denied" && (
        <p className="max-w-sm text-center text-sm text-red-400">
          Permission denied. On iOS, go to Settings → Safari → Motion &amp;
          Orientation Access and enable it, then refresh.
        </p>
      )}

      {permission === "unsupported" && (
        <p className="max-w-sm text-center text-sm text-yellow-400">
          DeviceOrientation API not supported on this device/browser.
        </p>
      )}

      {permission === "granted" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Streaming gyro values
          </p>

          <div className="grid grid-cols-3 gap-4 font-mono">
            <ValueCard label="α (alpha)" value={gyro.alpha} unit="°" />
            <ValueCard label="β (beta)" value={gyro.beta} unit="°" />
            <ValueCard label="γ (gamma)" value={gyro.gamma} unit="°" />
          </div>
          {publishError ? (
            <span className="text-xs text-red-400">
              Publish error: {publishError}
            </span>
          ) : (
            <span className="text-xs text-green-400">
              Publishing to dashboard
            </span>
          )}
          <p className="max-w-sm text-center text-xs text-zinc-500">
            Move/tilt your phone — open /dashboard on another device to see it.
          </p>
        </div>
      )}

      {/*
       * Reset is intentionally always visible — this is a "force recovery"
       * escape hatch. Sensor states can get stuck (iOS permission cache,
       * stale event listeners, browser quirks). Reset clears everything
       * back to idle regardless of current state.
       */}
      <button
        className="text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200 transition-colors"
        onClick={handleReset}
      >
        Force reset
      </button>
    </main>
  );
}

function ValueCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string;
}) {
  return (
    <div className="flex min-w-[80px] flex-col items-center rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className="text-lg tabular-nums text-zinc-100">
        {value !== null ? value.toFixed(1) : "—"}
      </span>
      <span className="text-[10px] text-zinc-500">{unit}</span>
    </div>
  );
}
