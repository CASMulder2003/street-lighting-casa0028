import { useRef, useState } from "react";
import TitleBar from "./components/TitleBar.jsx";
import MapStack from "./components/MapStack.jsx";

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tween(setter, from, to, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      const t = clamp01((now - start) / durationMs);
      const easeOut = t * (2 - t);
      setter(from + (to - from) * easeOut);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

export default function App() {
  // Shared view state (controlled by the top interactive map)
  const [view, setView] = useState({
    lng: 4.9,
    lat: 52.37,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  });

  // Visual states
  const [lightsOpacity, setLightsOpacity] = useState(0);   // 0..1
  const [blackoutOpacity, setBlackoutOpacity] = useState(0); // 0..1 (black overlay)
  const [darkMapOpacity, setDarkMapOpacity] = useState(0); // 0..1 (crossfade day->dark basemap)

  // mode bookkeeping
  const [mode, setMode] = useState("day"); // day | night | full
  const [status, setStatus] = useState("Ready");

  const runningRef = useRef(false);

  // ---- TRANSITIONS ----

  // Day -> Night (blackout up, lights in)
  const toNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Day → Night");
    setMode("night");

    // Ensure dark map is off for pure night mode
    setDarkMapOpacity(0);

    // Fade to black
    await tween(setBlackoutOpacity, blackoutOpacity, 1, 900);
    await wait(120);

    // Fade lights in
    await tween(setLightsOpacity, lightsOpacity, 1, 1200);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Night -> Full (dark basemap fades in; blackout reduces to allow basemap to show)
  const toFull = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Night → Full map");
    setMode("full");

    // Keep lights on
    if (lightsOpacity < 1) await tween(setLightsOpacity, lightsOpacity, 1, 400);

    // Fade in dark basemap under the lights
    await tween(setDarkMapOpacity, darkMapOpacity, 1, 500);

    // Reduce blackout so the basemap is visible but still “night”
    await tween(setBlackoutOpacity, blackoutOpacity, 0.15, 450);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Full -> Night (hide dark basemap, blackout back up)
  const fullToNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Full map → Night");
    setMode("night");

    // Bring blackout up slightly first to mask the crossfade
    await tween(setBlackoutOpacity, blackoutOpacity, 1, 350);
    await wait(60);

    // Fade out dark basemap
    await tween(setDarkMapOpacity, darkMapOpacity, 0, 450);

    // Stay in pure night (black)
    await tween(setBlackoutOpacity, blackoutOpacity, 1, 200);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Night or Full -> Day (lights out, blackout down, dark basemap off)
  const toDay = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Back to Day");
    setMode("day");

    // Fade lights out
    await tween(setLightsOpacity, lightsOpacity, 0, 600);
    await wait(80);

    // Make sure dark basemap is gone
    await tween(setDarkMapOpacity, darkMapOpacity, 0, 400);

    // Fade blackout away to reveal day basemap
    await tween(setBlackoutOpacity, blackoutOpacity, 0, 650);

    setStatus("Ready");
    runningRef.current = false;
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <MapStack
        view={view}
        onView={setView}
        lightsOpacity={lightsOpacity}
        blackoutOpacity={blackoutOpacity}
        darkMapOpacity={darkMapOpacity}
        onStatus={setStatus}
      />

      <TitleBar title="Amsterdam Night Lighting" />

      {/* Controls (always visible) */}
      <div className="absolute left-4 top-20 z-50 w-[360px] rounded-xl border border-white/15 bg-black/55 p-3 text-white backdrop-blur">
        <div className="text-sm opacity-90 mb-2">Controls</div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            disabled={mode !== "day" || runningRef.current}
            onClick={toNight}
          >
            Show night lights
          </button>

          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            disabled={mode !== "night" || runningRef.current}
            onClick={toFull}
          >
            Show full map
          </button>

          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            disabled={mode !== "full" || runningRef.current}
            onClick={fullToNight}
          >
            Hide full map
          </button>

          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            disabled={(mode === "day") || runningRef.current}
            onClick={toDay}
          >
            Back to day
          </button>
        </div>

        <div className="mt-3 text-xs opacity-80">Status: {status}</div>
      </div>
    </div>
  );
}
