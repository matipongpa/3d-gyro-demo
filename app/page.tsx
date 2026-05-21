"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Euler, MathUtils, Quaternion, type Mesh } from "three";
import Pusher from "pusher-js";
import { QRCodeSVG } from "qrcode.react";
import {
  SENSOR_CHANNEL_NAME,
  SENSOR_EVENT_NAME,
  GEOMETRY_EVENT_NAME,
  isSensorMessage,
  isGeometryMessage,
  type SensorMessage,
  type GeometryKind,
} from "@/lib/sensor-channel";

/** How many ms before a gyro message is considered stale (cube stops following). */
const STALE_AFTER_MS = 2000;

/**
 * Slerp factor for smoothing.
 * 0 = ignore new data (frozen). 1 = snap instantly (jittery).
 * 0.2 = ~80% of the way to target per second — smooth catch-up without lag feel.
 */
const ROTATION_SMOOTHING = 0.2;

const GEOMETRY_COLOR: Record<GeometryKind, string> = {
  box: "#3b82f6",
  sphere: "#22c55e",
  torus: "#f97316",
  cone: "#ef4444",
};

export default function Home() {
  // Latest sensor reading received from /phone via Pusher.
  // Null until the first message arrives.
  const [latest, setLatest] = useState<SensorMessage | null>(null);
  const [geometry, setGeometry] = useState<GeometryKind>("box");

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    if (!key || !cluster) {
      console.warn(
        "[home] NEXT_PUBLIC_PUSHER_KEY / NEXT_PUBLIC_PUSHER_CLUSTER not set — dashboard will show 'waiting' forever.",
      );
      return;
    }

    const pusher = new Pusher(key, { cluster });
    const channel = pusher.subscribe(SENSOR_CHANNEL_NAME);

    const handleMessage = (data: unknown) => {
      // Type guard — protects against malformed payloads on the wire
      if (isSensorMessage(data)) {
        setLatest(data);
      }
    };

    const handleGeometry = (data: unknown) => {
      if (isGeometryMessage(data)) {
        setGeometry(data.geometry);
      }
    };

    channel.bind(SENSOR_EVENT_NAME, handleMessage);
    channel.bind(GEOMETRY_EVENT_NAME, handleGeometry);

    return () => {
      channel.unbind(SENSOR_EVENT_NAME, handleMessage);
      channel.unbind(GEOMETRY_EVENT_NAME, handleGeometry);
      pusher.unsubscribe(SENSOR_CHANNEL_NAME);
      pusher.disconnect();
    };
  }, []);

  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const hostInfo = useSyncExternalStore<HostInfo | null>(
    subscribeNoop,
    getHostInfo,
    () => null,
  );

  // Detect stale data — recomputed every render (now every 500ms minimum).
  // Uses STALE_AFTER_MS constant — single source of truth shared with GyroDrivenCube.
  const isLive = latest !== null && now - latest.timestamp < STALE_AFTER_MS;

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100  h-dvh">
      {/* Top bar — plain DOM */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-sm font-semibold uppercase tracking-wider">
          Dashboard — 3D Viewer
        </h1>

        <div className="flex items-center gap-4 font-mono text-xs">
          {/* Live indicator dot */}
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isLive ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            <span className={isLive ? "text-emerald-400" : "text-zinc-500"}>
              {isLive ? "LIVE" : "waiting for /phone"}
            </span>
          </span>

          {/* Latest values — shown even when stale, just dimmed */}
          <div className="flex gap-3 text-zinc-400">
            <span>α {fmt(latest?.alpha)}</span>
            <span>β {fmt(latest?.beta)}</span>
            <span>γ {fmt(latest?.gamma)}</span>
          </div>
        </div>
      </header>

      {/* The 3D canvas fills the rest of the viewport */}
      <div className="relative flex-1">
        {!isLive && hostInfo && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
            <div className="flex max-w-sm flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
              {hostInfo.reachable ? (
                <>
                  <h2 className="text-base font-semibold text-zinc-100">
                    Connect your phone
                  </h2>
                  <p className="text-center text-xs text-zinc-400">
                    Scan this QR code with your phone to open the gyro source page.
                  </p>
                  <div className="rounded-md bg-white p-3">
                    <QRCodeSVG value={hostInfo.phoneUrl} size={192} />
                  </div>
                  <a
                    href={hostInfo.phoneUrl}
                    className="break-all text-center text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300"
                  >
                    {hostInfo.phoneUrl}
                  </a>
                </>
              ) : (
                <>
                  <h2 className="text-base font-semibold text-yellow-400">
                    Dev server on localhost
                  </h2>
                  <p className="text-center text-xs text-zinc-400">
                    Your phone can&apos;t reach{" "}
                    <code className="rounded bg-zinc-800 px-1">{hostInfo.hostname}</code>.
                    Open this dashboard via your machine&apos;s LAN IP (e.g.{" "}
                    <code className="rounded bg-zinc-800 px-1">http://192.168.x.x:3000</code>
                    ) or an ngrok / tunnel URL, then a QR will appear here.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        <Canvas
          // Camera pulled back to fit the spread-out shapes (X: ±4, Y: -3 to +4).
          // Looking slightly down so the gyro cube at y=-3 is visible without scrolling.
          camera={{ position: [0, 0, 12], fov: 50 }}
          // Tells the WebGL renderer to use the device pixel ratio (retina-safe).
          // Capped at 2 to avoid burning GPU on 3x screens.
          dpr={[1, 2]}
        >
          {/* Lighting — without this, MeshStandardMaterial renders black */}
          <ambientLight intensity={1} />
          <directionalLight position={[5, 5, 5]} intensity={1} />

          {/* The hero mesh: geometry is driven by /phone's selection,
              rotation by /phone's gyroscope. */}
          <GyroDrivenMesh
            message={latest}
            isLive={isLive}
            geometry={geometry}
          />

          {/* Drei helper: drag to orbit the camera, scroll to zoom.
              Useful for debugging — you can rotate around the scene. */}
          <OrbitControls enableDamping />
        </Canvas>
      </div>
    </main>
  );
}

const subscribeNoop = (): (() => void) => () => {};

type HostInfo = {
  phoneUrl: string;
  hostname: string;
  /** False when running on localhost/127.0.0.1 — a QR encoding that host can't be reached from a phone. */
  reachable: boolean;
};

let cachedHostInfo: HostInfo | null = null;

function getHostInfo(): HostInfo {
  if (cachedHostInfo) return cachedHostInfo;
  const { hostname, origin } = window.location;
  const reachable = hostname !== "localhost" && hostname !== "127.0.0.1";
  cachedHostInfo = { phoneUrl: `${origin}/phone`, hostname, reachable };
  return cachedHostInfo;
}

/** Format a degrees value (or null/undefined) for compact header display. */
function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}°`;
}

function GyroDrivenMesh({
  message,
  isLive,
  geometry,
}: {
  message: SensorMessage | null;
  isLive: boolean;
  geometry: GeometryKind;
}) {
  const meshRef = useRef<Mesh>(null);
  const eulerRef = useRef<Euler>(new Euler());
  const targetQuaternionRef = useRef<Quaternion>(new Quaternion());

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // No message yet, or any axis is null (sensor not producing values) → don't rotate
    if (
      !message ||
      message.alpha === null ||
      message.beta === null ||
      message.gamma === null
    ) {
      return;
    }

    if (Date.now() - message.timestamp > STALE_AFTER_MS) return;

    // Build the target orientation from DeviceOrientation Euler angles
    eulerRef.current.set(
      MathUtils.degToRad(message.beta), // X axis: pitch
      MathUtils.degToRad(message.alpha), // Y axis: yaw
      -MathUtils.degToRad(message.gamma), // Z axis: roll (negated for Three.js handedness)
      "YXZ",
    );
    targetQuaternionRef.current.setFromEuler(eulerRef.current);

    // Smoothly interpolate from current to target
    mesh.quaternion.slerp(targetQuaternionRef.current, ROTATION_SMOOTHING);
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      {geometry === "box" ? (
        <boxGeometry args={[1.8, 1.8, 1.8]} />
      ) : geometry === "sphere" ? (
        <sphereGeometry args={[1.2, 32, 32]} />
      ) : geometry === "cone" ? (
        <coneGeometry args={[1, 2, 32]} />
      ) : (
        <torusGeometry args={[1, 0.4, 16, 100]} />
      )}
      <meshStandardMaterial
        color={isLive ? GEOMETRY_COLOR[geometry] : "#52525b"}
        metalness={0.3}
        roughness={0.35}
        wireframe={geometry === "sphere"}
      />
    </mesh>
  );
}
