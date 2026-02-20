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
  // Shared view state (controlled by overlay map)
  const [view, setView] = useState({
    lng: 4.9,
    lat: 52.37,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  });

  // Visual states
  const [lightsOpacity, setLightsOpacity] = useState(0);     // 0..1
  const [blackoutOpacity, setBlackoutOpacity] = useState(0); // 0..1
  const [darkMapOpacity, setDarkMapOpacity] = useState(0);   // 0..1

  // Modes: day | night | full
  const [mode, setMode] = useState("day");
  const [status, setStatus] = useState("Ready");

  // Info modal placeholder
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const runningRef = useRef(false);

  // ---- TRANSITIONS ----

  // Day -> Night (blackout up, lights in)
  const toNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Day → Night");
    setMode("night");

    // Ensure full-map context is off when entering night
    setDarkMapOpacity(0);

    await tween(setBlackoutOpacity, blackoutOpacity, 1, 900);
    await wait(120);
    await tween(setLightsOpacity, lightsOpacity, 1, 1200);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Night -> Full (dark basemap fades in; blackout reduces)
  const toFull = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Night → Full map");
    setMode("full");

    // Keep lights on
    if (lightsOpacity < 1) await tween(setLightsOpacity, lightsOpacity, 1, 300);

    await tween(setDarkMapOpacity, darkMapOpacity, 1, 500);
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

    // Mask the crossfade slightly
    await tween(setBlackoutOpacity, blackoutOpacity, 1, 250);
    await wait(60);
    await tween(setDarkMapOpacity, darkMapOpacity, 0, 450);

    // Return to pure night black behind lights
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

    // Fade lights out first
    await tween(setLightsOpacity, lightsOpacity, 0, 600);
    await wait(80);

    // Ensure dark map context is off
    await tween(setDarkMapOpacity, darkMapOpacity, 0, 400);

    // Reveal day basemap
    await tween(setBlackoutOpacity, blackoutOpacity, 0, 650);

    setStatus("Ready");
    runningRef.current = false;
  };

  // ---- BUTTON LOGIC ----

  // Button 1: Show night lights <-> Back to day
  const mainLabel = mode === "day" ? "Show night lights" : "Back to day";
  const mainAction = mode === "day" ? toNight : toDay;

  // Button 2: Show full map <-> Hide full map (only works once in night/full)
  const contextLabel = mode === "full" ? "Hide full map" : "Show full map";
  const contextDisabled = (mode === "day") || runningRef.current;
  const contextAction = () => {
    if (mode === "night") return toFull();
    if (mode === "full") return fullToNight();
    // if day: do nothing (disabled anyway)
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

      <TitleBar
        title="Amsterdam Night Lighting"
        controls={
          <>
            {/* 1) Main toggle */}
            <button
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm hover:border-white/30 disabled:opacity-40"
              disabled={runningRef.current}
              onClick={mainAction}
              title={mainLabel}
            >
              {mainLabel}
            </button>

            {/* 2) Context toggle */}
            <button
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm hover:border-white/30 disabled:opacity-40"
              disabled={contextDisabled}
              onClick={contextAction}
              title={contextLabel}
            >
              {contextLabel}
            </button>

            {/* 3) Info button (placeholder for modal later) */}
            <button
              className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/40 text-sm hover:border-white/30"
              onClick={() => setIsInfoOpen(true)}
              title="Info"
              type="button"
            >
              ?
            </button>
          </>
        }
      />

      {/* Optional: tiny status line (you said you'll change later, but this is handy) */}
      <div className="absolute left-4 top-20 z-50 text-xs text-white/70">
        {status}
      </div>

      {/* Placeholder modal (does nothing functional yet; can remove if you prefer) */}
      {isInfoOpen && (
        <div className="absolute inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-black/70 p-4 text-white backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Info</h2>
              <button
                className="rounded-lg border border-white/20 bg-black/40 px-3 py-1 text-sm hover:border-white/30"
                onClick={() => setIsInfoOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm text-white/80">
              Placeholder — we’ll hook this up to your methodology / data story modal later.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

