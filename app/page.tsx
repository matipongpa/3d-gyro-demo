import Link from "next/link";

/**
 * Home page — entry point with two links:
 *  - /phone     → opens on the iPhone, captures gyro data
 *  - /dashboard → opens on the laptop, renders 3D scene driven by gyro
 *
 * Both pages must be open at the same time on the SAME device for v1
 * (because we use BroadcastChannel which only syncs same-origin tabs/windows).
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 p-6 text-zinc-100">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">3D Gyro Demo</h1>
        <p className="max-w-md text-sm text-zinc-400">
          Real-time visualization: phone gyroscope drives a 3D scene in another browser tab.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/phone"
          className="rounded-md bg-blue-500 px-6 py-3 text-center font-medium hover:bg-blue-600 transition-colors"
        >
          Open Phone Page
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md bg-emerald-500 px-6 py-3 text-center font-medium hover:bg-emerald-600 transition-colors"
        >
          Open Dashboard
        </Link>
      </div>

      <p className="max-w-md text-center text-xs text-zinc-500">
        Tip: open <code className="rounded bg-zinc-800 px-1">/phone</code> in one tab and{" "}
        <code className="rounded bg-zinc-800 px-1">/dashboard</code> in another. They communicate via the browser&apos;s
        BroadcastChannel API.
      </p>
    </main>
  );
}
