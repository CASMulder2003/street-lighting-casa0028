import { useRef, useState } from "react";
import TitleBar from "./components/TitleBar.jsx";
import MapStack from "./components/MapStack.jsx";
import InfoModal from "./components/InfoModal.jsx"; 

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
  const [view, setView] = useState({
    lng: 4.9,
    lat: 52.37,
    zoom: 12,
    bearing: 0,
    pitch: 0,
  });

  const [lightsOpacity, setLightsOpacity] = useState(0);
  const [blackoutOpacity, setBlackoutOpacity] = useState(0);
  const [darkMapOpacity, setDarkMapOpacity] = useState(0);

  const [mode, setMode] = useState("day");
  const [status, setStatus] = useState("Ready");

  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const runningRef = useRef(false);

  // ---- TRANSITIONS ----
  const toNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Day → Night");
    setMode("night");
    setDarkMapOpacity(0);

    await tween(setBlackoutOpacity, blackoutOpacity, 1, 900);
    await wait(120);
    await tween(setLightsOpacity, lightsOpacity, 1, 1200);

    setStatus("Ready");
    runningRef.current = false;
  };

  const toFull = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Night → Full map");
    setMode("full");

    if (lightsOpacity < 1) await tween(setLightsOpacity, lightsOpacity, 1, 300);

    await tween(setDarkMapOpacity, darkMapOpacity, 1, 500);
    await tween(setBlackoutOpacity, blackoutOpacity, 0.15, 450);

    setStatus("Ready");
    runningRef.current = false;
  };

  const fullToNight = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Full map → Night");
    setMode("night");

    await tween(setBlackoutOpacity, blackoutOpacity, 1, 250);
    await wait(60);
    await tween(setDarkMapOpacity, darkMapOpacity, 0, 450);
    await tween(setBlackoutOpacity, blackoutOpacity, 1, 200);

    setStatus("Ready");
    runningRef.current = false;
  };

  const toDay = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("Transition: Back to Day");
    setMode("day");

    await tween(setLightsOpacity, lightsOpacity, 0, 600);
    await wait(80);
    await tween(setDarkMapOpacity, darkMapOpacity, 0, 400);
    await tween(setBlackoutOpacity, blackoutOpacity, 0, 650);

    setStatus("Ready");
    runningRef.current = false;
  };

  const mainLabel = mode === "day" ? "Show night lights" : "Back to day";
  const mainAction = mode === "day" ? toNight : toDay;

  const contextLabel = mode === "full" ? "Hide full map" : "Show full map";
  const contextDisabled = mode === "day" || runningRef.current;
  const contextAction = () => {
    if (mode === "night") return toFull();
    if (mode === "full") return fullToNight();
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
            <button
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm hover:border-white/30 disabled:opacity-40"
              disabled={runningRef.current}
              onClick={mainAction}
              title={mainLabel}
            >
              {mainLabel}
            </button>

            <button
              className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm hover:border-white/30 disabled:opacity-40"
              disabled={contextDisabled}
              onClick={contextAction}
              title={contextLabel}
            >
              {contextLabel}
            </button>

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

      <div className="absolute left-4 top-20 z-50 text-xs text-white/70">
        {status}
      </div>

      <InfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </div>
  );
}