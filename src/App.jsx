import { useRef, useState } from "react";
import TitleBar from "./components/TitleBar.jsx";
import DualMapStack from "./components/DualMapStack.jsx";
import InfoModal from "./components/InfoModal.jsx";
import ViewportStats from "./components/ViewportStats.jsx";

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
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
  // Camera state
  const [view, setView] = useState({
    lng: 4.9,
    lat: 52.37,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  });

  // Visual states
  const [topOpacity, setTopOpacity] = useState(0);
  const [lightsOpacity, setLightsOpacity] = useState(0);
  const [blackoutOpacity, setBlackoutOpacity] = useState(0);

  const [status, setStatus] = useState("Ready");
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  // NEW: derived viewport stats (computed in DualMapStack via utils/stats.js)
  const [viewportStats, setViewportStats] = useState(null);

  const runningRef = useRef(false);

  const isNightMode = topOpacity > 0.5;

  // Show stats only when user has revealed the basemap (i.e., not full black)
  // Your "full map" state sets blackoutOpacity to ~0.15
  const showStats = isNightMode && blackoutOpacity < 0.5;

  // -----------------------
  // TRANSITIONS
  // -----------------------

  const toNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Transition: Day → Night");

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

    if (topOpacity < 1) await tween(setTopOpacity, topOpacity, 1, 250);
    if (lightsOpacity < 1) await tween(setLightsOpacity, lightsOpacity, 1, 500);

    await tween(setBlackoutOpacity, blackoutOpacity, 0.15, 700);

    setStatus("Ready");
    runningRef.current = false;
  };

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
        onViewportStats={setViewportStats} // NEW
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

      {/* Only show derived stats when the basemap is visible (full map mode) */}
      <ViewportStats visible={showStats} stats={viewportStats} />

      <InfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </div>
  );
}