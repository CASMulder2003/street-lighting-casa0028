import { useRef, useState } from "react";
import TitleBar from "./components/TitleBar.jsx";
import DualMapStack from "./components/DualMapStack.jsx";
import InfoModal from "./components/InfoModal.jsx";
import ViewportStats from "./components/ViewportStats.jsx";

// Clamp helper used by the tween function (keeps values between 0 and 1)
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Small animation helper for smoothly transitioning state values.
 * I use this instead of CSS transitions so I can sequence effects (fade map, then fade lights, etc.).
 */
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
  // Camera state (shared with the MapLibre component)
  const [view, setView] = useState({
    lng: 4.9,
    lat: 52.37,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  });

  // Visual state controlling the crossfade + lighting reveal
  const [topOpacity, setTopOpacity] = useState(0); // 0 = day only, 1 = night map visible
  const [lightsOpacity, setLightsOpacity] = useState(0); // glow intensity for lit roads
  const [blackoutOpacity, setBlackoutOpacity] = useState(0); // black mask for “night reveal”

  // Small UI state
  const [status, setStatus] = useState("Ready");
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  // Derived stats for the current viewport (computed inside DualMapStack)
  const [viewportStats, setViewportStats] = useState(null);

  // Prevent users spamming transitions (avoids conflicting animations)
  const runningRef = useRef(false);

  const isNightMode = topOpacity > 0.5;

  // Only show the stats when the basemap has been revealed behind the lights
  // (stats make more sense in “context” mode than on a fully black screen)
  const showStats = isNightMode && blackoutOpacity < 0.5;

  // -----------------------
  // TRANSITIONS
  // -----------------------

  const toNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Day → Night");

    // Start from black, then fade in the glow
    setBlackoutOpacity(1);
    setLightsOpacity(0);

    await tween(setTopOpacity, topOpacity, 1, 350);
    await tween(setLightsOpacity, 0, 1, 2200);

    setStatus("Ready");
    runningRef.current = false;
  };

  const toDay = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Night → Day");

    // Fade glow out, then crossfade back to the day map
    await tween(setLightsOpacity, lightsOpacity, 0, 900);
    await tween(setTopOpacity, topOpacity, 0, 450);

    setBlackoutOpacity(0);

    setStatus("Ready");
    runningRef.current = false;
  };

  const toFull = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Night → Full map");

    // Ensure the night map is visible and the glow is on
    if (topOpacity < 1) await tween(setTopOpacity, topOpacity, 1, 250);
    if (lightsOpacity < 1) await tween(setLightsOpacity, lightsOpacity, 1, 500);

    // Reveal the dark basemap behind the lights by lowering the mask
    await tween(setBlackoutOpacity, blackoutOpacity, 0.15, 700);

    setStatus("Ready");
    runningRef.current = false;
  };

  const fullToNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Full map → Night");

    // Bring the mask back up to return to the black “night reveal” view
    await tween(setBlackoutOpacity, blackoutOpacity, 1, 500);

    setStatus("Ready");
    runningRef.current = false;
  };

  // -----------------------
  // BUTTON LOGIC
  // -----------------------

  const mainLabel = isNightMode ? "Back to day" : "Show night lights";
  const mainAction = isNightMode ? toDay : toNight;

  const contextLabel =
    blackoutOpacity < 0.5 ? "Hide full map" : "Show full map";

  const contextDisabled = !isNightMode || runningRef.current;

  const contextAction = () => {
    if (blackoutOpacity >= 0.9) return toFull();
    if (blackoutOpacity < 0.5) return fullToNight();
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <DualMapStack
        view={view}
        onView={setView}
        topOpacity={topOpacity}
        lightsOpacity={lightsOpacity}
        blackoutOpacity={blackoutOpacity}
        onStatus={setStatus}
        onViewportStats={setViewportStats}
      />

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

      <div className="absolute left-4 top-20 z-50 text-xs text-white/70">
        {status}
      </div>

      <ViewportStats visible={showStats} stats={viewportStats} />

      <InfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </div>
  );
}