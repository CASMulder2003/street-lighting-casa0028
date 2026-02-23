import { useRef, useState } from "react";
import TitleBar from "./components/TitleBar.jsx";
import DualMapStack from "./components/DualMapStack.jsx";
import InfoModal from "./components/InfoModal.jsx";
import ViewportStats from "./components/ViewportStats.jsx";

// I use this to keep animation values between 0 and 1
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Small animation helper.
 * I use it to smoothly change React state over time (instead of CSS),
 * so I can control the order of transitions (fade map, then fade lights).
 */
function tween(setter, from, to, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();

    function frame(now) {
      const t = clamp01((now - start) / durationMs);
      // Simple ease-out (starts fast, ends slow)
      const easeOut = t * (2 - t);

      setter(from + (to - from) * easeOut);

      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }

    requestAnimationFrame(frame);
  });
}

export default function App() {
  // Current map camera (kept in React so both maps stay in sync)
  const [view, setView] = useState({
    lng: 4.9,
    lat: 52.37,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  });

  // These control the look of the night view
  const [topOpacity, setTopOpacity] = useState(0); // fades the night map in/out
  const [lightsOpacity, setLightsOpacity] = useState(0); // controls glow strength
  const [blackoutOpacity, setBlackoutOpacity] = useState(0); // black “mask” over the night map

  // Simple UI state
  const [status, setStatus] = useState("Ready");
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  // Stats for what’s currently visible in the map view
  const [viewportStats, setViewportStats] = useState(null);

  // I use this to stop users clicking buttons mid-animation
  const runningRef = useRef(false);

  // I treat it as “night mode” once the night map is mostly visible
  const isNightMode = topOpacity > 0.5;

  // I only show stats when the basemap is visible behind the lights
  // (they don’t make much sense when the view is fully black)
  const showStats = isNightMode && blackoutOpacity < 0.5;

  // -----------------------
  // TRANSITIONS
  // -----------------------

  // Day → Night: crossfade to night map, then fade the glow in
  const toNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Day → Night");

    // Start with a black mask so the first thing you see is the lights
    setBlackoutOpacity(1);
    setLightsOpacity(0);

    await tween(setTopOpacity, topOpacity, 1, 350);
    await tween(setLightsOpacity, 0, 1, 2200);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Night → Day: fade lights out, then crossfade back to day map
  const toDay = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Night → Day");

    await tween(setLightsOpacity, lightsOpacity, 0, 900);
    await tween(setTopOpacity, topOpacity, 0, 450);

    // Reset mask so the next night transition starts clean
    setBlackoutOpacity(0);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Night (black) → Full map: lower the black mask so you can see the basemap too
  const toFull = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Night → Full map");

    // Make sure the night map + glow are fully on before revealing the basemap
    if (topOpacity < 1) await tween(setTopOpacity, topOpacity, 1, 250);
    if (lightsOpacity < 1) await tween(setLightsOpacity, lightsOpacity, 1, 500);

    await tween(setBlackoutOpacity, blackoutOpacity, 0.15, 700);

    setStatus("Ready");
    runningRef.current = false;
  };

  // Full map → Night (black): bring the black mask back up
  const fullToNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Full map → Night");

    await tween(setBlackoutOpacity, blackoutOpacity, 1, 500);

    setStatus("Ready");
    runningRef.current = false;
  };

  // -----------------------
  // BUTTON LOGIC
  // -----------------------

  // Main button toggles between day and night
  const mainLabel = isNightMode ? "Back to day" : "Show night lights";
  const mainAction = isNightMode ? toDay : toNight;

  // Second button toggles between “black reveal” and “full basemap”
  const contextLabel =
    blackoutOpacity < 0.5 ? "Hide full map" : "Show full map";

  // Only allow the full-map toggle when we are in night mode and not animating
  const contextDisabled = !isNightMode || runningRef.current;

  const contextAction = () => {
    if (blackoutOpacity >= 0.9) return toFull();
    if (blackoutOpacity < 0.5) return fullToNight();
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {/* The map component renders both the day and night maps, plus the glow layers */}
      <DualMapStack
        view={view}
        onView={setView}
        topOpacity={topOpacity}
        lightsOpacity={lightsOpacity}
        blackoutOpacity={blackoutOpacity}
        onStatus={setStatus}
        onViewportStats={setViewportStats}
      />

      {/* Top bar with buttons (single page, so this works like a “navbar” for controls) */}
      <TitleBar
        title="Amsterdam Night Lighting"
        controls={
          <>
            <button
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm hover:border-white/30 disabled:opacity-40"
              disabled={runningRef.current}
              onClick={mainAction}
            >
              {mainLabel}
            </button>

            <button
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm hover:border-white/30 disabled:opacity-40"
              disabled={contextDisabled}
              onClick={contextAction}
            >
              {contextLabel}
            </button>

            {/* Info modal button */}
            <button
              className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/40 text-sm hover:border-white/30"
              onClick={() => setIsInfoOpen(true)}
              type="button"
            >
              ?
            </button>
          </>
        }
      />

      {/* Small status text for debugging / feedback */}
      <div className="absolute left-4 top-20 z-50 text-xs text-white/70">
        {status}
      </div>

      {/* Viewport stats (only shown in “full map” night mode) */}
      <ViewportStats visible={showStats} stats={viewportStats} />

      {/* Info modal with context + how-to tabs */}
      <InfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </div>
  );
}