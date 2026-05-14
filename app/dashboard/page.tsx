"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import { Euler, MathUtils, Quaternion, type Mesh } from "three";
import Pusher from "pusher-js";
import {
  SENSOR_CHANNEL_NAME,
  SENSOR_EVENT_NAME,
  isSensorMessage,
  type SensorMessage,
} from "@/lib/sensor-channel";

/** How many ms before a gyro message is considered stale (cube stops following). */
const STALE_AFTER_MS = 2000;

/**
 * Slerp factor for smoothing.
 * 0 = ignore new data (frozen). 1 = snap instantly (jittery).
 * 0.2 = ~80% of the way to target per second — smooth catch-up without lag feel.
 */
const ROTATION_SMOOTHING = 0.2;

const SHAPE = {
  BOX: "box",
  SPHERE: "sphere",
  CONE: "cone",
  TORUS: "torus",
} as const;

type Shape = (typeof SHAPE)[keyof typeof SHAPE]; // "box" | "sphere" | "cone" | "torus"

interface ObjectPosition {
  x: number;
  y: number;
  z: number;
}

interface RotationSpeed {
  x: number;
  y: number;
  z: number;
}

interface RotationMeshProps {
  shape: Shape;
  position: ObjectPosition;
  rotationSpeed: RotationSpeed;
  color: string;
}
export default function DashboardPage() {
  // Latest sensor reading received from /phone via Pusher.
  // Null until the first message arrives.
  const [latest, setLatest] = useState<SensorMessage | null>(null);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    if (!key || !cluster) {
      console.warn(
        "[dashboard] NEXT_PUBLIC_PUSHER_KEY / NEXT_PUBLIC_PUSHER_CLUSTER not set — dashboard will show 'waiting' forever.",
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

    channel.bind(SENSOR_EVENT_NAME, handleMessage);

    return () => {
      channel.unbind(SENSOR_EVENT_NAME, handleMessage);
      pusher.unsubscribe(SENSOR_CHANNEL_NAME);
      pusher.disconnect();
    };
  }, []);

  // Fix 1: force a re-render every 500ms so isLive is recomputed against a fresh
  // Date.now() even when no Pusher messages arrive (e.g. phone disconnected).
  // Without this, the component goes to sleep and isLive stays frozen at "true".
  // We discard the value [,] — we only need the side-effect of triggering a render.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Detect stale data — recomputed every render (now every 500ms minimum).
  // Uses STALE_AFTER_MS constant — single source of truth shared with GyroDrivenCube.
  const isLive = latest !== null && Date.now() - latest.timestamp < STALE_AFTER_MS;

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
      <div className="flex-1">
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
          {/* The cube */}
          <RotationMesh
            shape={SHAPE.BOX}
            position={{ y: 0, x: -4, z: 0 }}
            rotationSpeed={{ x: 1, y: 0, z: 0 }}
            color="red"
          />
          <RotationMesh
            shape={SHAPE.SPHERE}
            position={{ y: 0, x: 0, z: 0 }}
            rotationSpeed={{ x: 0, y: 1, z: 0 }}
            color="green"
          />
          <RotationMesh
            shape={SHAPE.CONE}
            position={{ y: 0, x: 4, z: 0 }}
            rotationSpeed={{ x: 0, y: 0, z: 1 }}
            color="blue"
          />
          <RotationMesh
            shape={SHAPE.TORUS}
            position={{ y: 4, x: 0, z: 0 }}
            rotationSpeed={{ x: 0, y: 0, z: 1 }}
            color="orange"
          />

          {/* THE HERO OBJECT: rotates with your phone's gyroscope in real-time.
              Positioned below the auto-rotating shapes so the demo focus is clear:
              if you tilt the phone, this is the cube that responds. */}
          {/* isLive prop — single source of truth from parent, no duplicate check */}
          <GyroDrivenCube message={latest} isLive={isLive} />

          {/* Drei helper: drag to orbit the camera, scroll to zoom.
              Useful for debugging — you can rotate around the scene. */}
          <OrbitControls enableDamping />
        </Canvas>
      </div>
    </main>
  );
}

/** Format a degrees value (or null/undefined) for compact header display. */
function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}°`;
}

function GyroDrivenCube({
  message,
  isLive, // Fix 2+3: received from parent — single source of truth, no local duplicate
}: {
  message: SensorMessage | null;
  isLive: boolean;
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

    // Fix 3: keep this timestamp check HERE (inside useFrame, 60fps) for the
    // rotation decision only. This stops rotation immediately when data goes stale,
    // without waiting for the next React render cycle.
    // The cube COLOR uses the isLive prop (from parent) — that's the UI concern.
    // The rotation DECISION uses Date.now() directly — that's the timing concern.
    if (Date.now() - message.timestamp > STALE_AFTER_MS) return;

    // Build the target orientation from DeviceOrientation Euler angles
    eulerRef.current.set(
      MathUtils.degToRad(message.beta),    // X axis: pitch
      MathUtils.degToRad(message.alpha),   // Y axis: yaw
      -MathUtils.degToRad(message.gamma),  // Z axis: roll (negated for Three.js handedness)
      "YXZ",
    );
    targetQuaternionRef.current.setFromEuler(eulerRef.current);

    // Smoothly interpolate from current to target
    mesh.quaternion.slerp(targetQuaternionRef.current, ROTATION_SMOOTHING);
  });

  return (
    <mesh ref={meshRef} position={[0, -3, 0]}>
      <boxGeometry args={[1.8, 1.8, 1.8]} />
      <meshStandardMaterial
        color={isLive ? "#facc15" : "#52525b"} // uses prop — consistent with header
        metalness={0.3}
        roughness={0.35}
      />
    </mesh>
  );
}

function RotationMesh({
  shape,
  position,
  rotationSpeed,
  color,
}: RotationMeshProps) {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    // Rotate ~0.5 rad/sec on each axis — slow enough to look smooth
    meshRef.current.rotation.x += delta * rotationSpeed.x;
    meshRef.current.rotation.y += delta * rotationSpeed.y;
    meshRef.current.rotation.z += delta * rotationSpeed.z;
  });

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]}>
      {/* args = constructor arguments passed to BoxGeometry(width, height, depth) */}
      {shape === SHAPE.BOX ? (
        <boxGeometry args={[1.5, 1.5, 1.5]} />
      ) : shape === SHAPE.SPHERE ? (
        <sphereGeometry args={[1, 32, 32]} />
      ) : shape === SHAPE.TORUS ? (
        <torusGeometry args={[1, 0.4, 16, 100]} />
      ) : (
        <coneGeometry args={[1, 1, 20]} />
      )}
      <meshStandardMaterial
        color={color}
        metalness={0.2}
        roughness={0.4}
        wireframe={shape === SHAPE.SPHERE}
      />
    </mesh>
  );
}
