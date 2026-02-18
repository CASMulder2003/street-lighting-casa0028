import { useRef, useState } from "react";
import MapView from "./components/MapView.jsx";
import TitleBar from "./components/TitleBar.jsx";

function tween(setter, from, to, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
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

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function App() {
  // Transition controls
  const [baseOpacity, setBaseOpacity] = useState(1);     // intro basemap opacity
  const [lightsOpacity, setLightsOpacity] = useState(0); // lights opacity

  // Modes: day -> transitioning -> night
  const [mode, setMode] = useState("day");
  const [darkBasemapOn, setDarkBasemapOn] = useState(false);

  // On-screen status (so it never “does nothing” silently)
  const [status, setStatus] = useState("Idle");

  const runningRef = useRef(false);

  const startNightSequence = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setMode("transitioning");
    setDarkBasemapOn(false);

    // Fade intro basemap out (blackout overlay will rise in MapView)
    await tween(setBaseOpacity, 1, 0, 1200);
    await wait(150);

    // Fade lights in
    await tween(setLightsOpacity, 0, 1, 1600);

    setMode("night");
    runningRef.current = false;
  };

  const backToDay = async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setMode("transitioning");
    setDarkBasemapOn(false);

    await tween(setLightsOpacity, 1, 0, 900);
    await wait(100);
    await tween(setBaseOpacity, 0, 1, 900);

    setMode("day");
    runningRef.current = false;
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <div className="absolute inset-0">
        <MapView
          baseOpacity={baseOpacity}
          lightsOpacity={lightsOpacity}
          darkBasemapOn={mode === "night" ? darkBasemapOn : false}
          onStatus={setStatus}
        />
      </div>

      <TitleBar title="Amsterdam Night Lighting" />

      {/* Controls: ALWAYS visible */}
      <div className="absolute left-4 top-20 z-40 w-[340px] rounded-xl border border-white/15 bg-black/55 p-3 text-white backdrop-blur">
        <div className="text-sm opacity-90 mb-2">Controls</div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            onClick={startNightSequence}
            disabled={mode !== "day"}
          >
            Show night lights
          </button>

          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            onClick={() => setDarkBasemapOn((v) => !v)}
            disabled={mode !== "night"}
          >
            {darkBasemapOn ? "Hide full map" : "Show full map"}
          </button>

          <button
            className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 hover:border-white/30 disabled:opacity-40"
            onClick={backToDay}
            disabled={mode !== "night"}
          >
            Back to day
          </button>
        </div>

        <div className="mt-3 text-xs opacity-80">Status: {status}</div>
      </div>
    </div>
  );
}
