# 3D Gyro Demo

A real-time, cross-device demo where a phone streams its gyroscope orientation to a desktop dashboard that renders a 3D shape rotating in sync. The user can pick the geometry (box / sphere / torus / cone) on the phone and the dashboard switches to it live.

```
[iPhone /phone] ──HTTP POST──> [Next.js /api/sensor] ──pusher.trigger──> [Pusher Cloud] ──WSS──> [Desktop / ]
       │                                                                                              │
       └─ DeviceOrientation @ ~60Hz (throttled to ~30Hz)                                              └─ react-three-fiber Canvas
       └─ Geometry select  (event: "geometry")                                                        └─ Quaternion slerp @ rAF
```

## Stack

- **Next.js 16** (App Router) — `next dev` / `next build`
- **React 19**
- **react-three-fiber** + **three.js 0.184** — declarative WebGL scene
- **Pusher** (`pusher-js` on the client, `pusher` server SDK in the route handler) — managed pub/sub relay
- **HeroUI 3** + **Tailwind v4** — dark-themed UI primitives (`Select`, `ListBox`, …)
- **TypeScript strict mode**

> ⚠️ Per `AGENTS.md`: this Next.js version has breaking changes vs older training data. When editing, prefer the patterns already in the repo over any remembered Next.js idioms — the local `node_modules/next/dist/docs/` is the source of truth.

## Pages

| Route         | Purpose                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `/`           | Dashboard — Pusher subscriber + react-three-fiber Canvas; overlays a QR to `/phone` when no live data  |
| `/phone`      | Capture device orientation, pick a geometry, fire-and-forget POSTs to `/api/sensor`                    |
| `/api/sensor` | POST endpoint that validates the payload and `pusher.trigger`s the right Pusher event                  |

## Pusher channel/event protocol

Defined in [`lib/sensor-channel.ts`](lib/sensor-channel.ts):

- **Channel:** `gyro-sensor` (public, no auth)
- **Events on that channel:**
  - `orientation` → `SensorMessage` `{ type: "orientation", alpha, beta, gamma, timestamp }`
  - `geometry` → `GeometryMessage` `{ type: "geometry", geometry: "box" | "sphere" | "torus" | "cone", timestamp }`

Both events go through the same `/api/sensor` POST endpoint; the route dispatches by payload shape using `isSensorMessage` / `isGeometryMessage` type guards.

## Geometry colors (dashboard)

| Geometry | Color  | Material                                   |
| -------- | ------ | ------------------------------------------ |
| Box      | Blue   | Solid                                      |
| Sphere   | Green  | **Wireframe** (so the rotation is visible) |
| Torus    | Orange | Solid                                      |
| Cone     | Red    | Solid                                      |

When data is stale (>2s without a phone message) the mesh dims to zinc gray.

## Running locally

### 1. Install

```bash
npm install
```

### 2. Configure Pusher

Create a free app at <https://pusher.com> (Channels product). Then copy the credentials into `.env.local`:

```bash
# Server-only (used by /api/sensor)
PUSHER_APP_ID=...
PUSHER_KEY=...
PUSHER_SECRET=...
PUSHER_CLUSTER=ap1   # match your app's region

# Public — inlined into the dashboard client bundle
NEXT_PUBLIC_PUSHER_KEY=...        # same value as PUSHER_KEY
NEXT_PUBLIC_PUSHER_CLUSTER=ap1
```

`NEXT_PUBLIC_*` vars are read at dev-server startup — **restart `npm run dev` after editing `.env.local`** or they won't reach the client.

### 3. Start the dev server

```bash
npm run dev
```

Open `http://localhost:3000` on your laptop — you'll see the dashboard with a QR-overlay placeholder (the QR itself only renders once you're on a LAN IP / tunnel host, since `localhost` isn't reachable from the phone).

### 4. Reach the phone over HTTPS

iOS Safari **requires a secure context** for `DeviceOrientationEvent.requestPermission()`. `http://192.168.x.x:3000` will not work — the **Enable Gyro** button will silently fail. Use a tunnel:

```bash
# Option A — ngrok
npx ngrok http 3000

# Option B — cloudflared
cloudflared tunnel --url http://localhost:3000
```

Open the resulting `https://…` URL on the phone, navigate to `/phone`, tap **Enable Gyro**, accept the iOS permission prompt, then tilt the phone. The dashboard should update within ~50–100 ms.

## Scripts

```bash
npm run dev        # next dev
npm run build      # next build
npm run start      # next start (production)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Project layout

```
app/
├── layout.tsx              # Root layout, dark theme wiring (data-theme="dark", className="dark")
├── globals.css             # Tailwind v4 + HeroUI styles, forced dark color-scheme
├── page.tsx                # Dashboard (Pusher subscriber + r3f Canvas + QR overlay)
├── phone/page.tsx          # Phone capture + geometry picker
└── api/sensor/route.ts     # POST handler: validates body, dispatches to Pusher
lib/
├── sensor-channel.ts       # Shared types, constants, runtime type guards
└── pusher-server.ts        # Lazy singleton for the Pusher server SDK
```

## Behavior notes

- **Throttling:** phone POSTs are throttled to ~30 Hz (`PUBLISH_INTERVAL_MS = 33`); local on-screen display updates at the full ~60 Hz of `deviceorientation` events.
- **Smoothing:** the dashboard uses quaternion `slerp` with factor `0.2` per frame — smooth catch-up without feeling laggy.
- **Stale detection:** if no `orientation` message arrives for 2 s the mesh switches to gray and the "LIVE" indicator dims. A 500 ms `setInterval` forces a re-render so staleness is detected even when the WS goes quiet.
- **Geometry persistence:** geometry is not stored server-side. A fresh dashboard tab defaults to **box** until the next phone selection.

## Troubleshooting

| Symptom                                                | Likely cause                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Dashboard console: `NEXT_PUBLIC_PUSHER_KEY … not set`  | `.env.local` missing those keys, or you forgot to restart `npm run dev`                          |
| **Enable Gyro** does nothing on iPhone                 | You're on plain HTTP — use an HTTPS tunnel                                                       |
| Phone shows "Publish error"                            | `/api/sensor` failing — check server logs; usually missing `PUSHER_SECRET` or wrong cluster code |
| Dashboard cube never moves                             | Open DevTools → Network → WS — confirm a Pusher WSS connection exists and is "101 Switching"    |
| Geometry switch on phone has no effect on dashboard    | Old dashboard tab open from before the geometry binding shipped — hard reload it                 |

## Deploying

Set the same env vars (`PUSHER_*` and `NEXT_PUBLIC_PUSHER_*`) in your hosting provider and deploy with `next build`. The `/api/sensor` route pins `preferredRegion = "sin1"` to minimize latency to the `ap1` Pusher cluster — change it if your Pusher region differs.
