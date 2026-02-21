import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE_DAY = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export default function MapStack({
  view,
  onView,
  lightsOpacity,
  blackoutOpacity,
  darkMapOpacity,
  onStatus = () => {},
}) {
  const dayRef = useRef(null);
  const darkRef = useRef(null);
  const overlayRef = useRef(null);

  const dayEl = useRef(null);
  const darkEl = useRef(null);
  const overlayEl = useRef(null);

  const [darkIdleReady, setDarkIdleReady] = useState(false);

  const litDataRef = useRef(null);
  const rafRef = useRef(null);

  // Keep last camera so when dark/day finishes loading we can snap it immediately.
  const lastCamRef = useRef({
    center: [view.lng, view.lat],
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch,
  });

  useEffect(() => {
    let dead = false;

    onStatus("Creating maps…");

    // --- Create DAY map (non-interactive) ---
    const dayMap = new maplibregl.Map({
      container: dayEl.current,
      style: STYLE_DAY,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: false,
      attributionControl: false,
    });

    // --- Create DARK map (non-interactive) ---
    const darkMap = new maplibregl.Map({
      container: darkEl.current,
      style: STYLE_DARK,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: false,
      attributionControl: false,
    });

    // --- Create OVERLAY map (interactive, transparent style) ---
    const overlayMap = new maplibregl.Map({
      container: overlayEl.current,
      style: { version: 8, sources: {}, layers: [] }, // transparent canvas
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: true,
      attributionControl: false,
    });

    dayRef.current = dayMap;
    darkRef.current = darkMap;
    overlayRef.current = overlayMap;

    // Ensure canvases size correctly (important in absolute layouts)
    const resizeAll = () => {
      try { dayMap.resize(); } catch {}
      try { darkMap.resize(); } catch {}
      try { overlayMap.resize(); } catch {}
    };
    // next tick resize helps avoid “frozen” transforms on some browsers
    requestAnimationFrame(resizeAll);
    window.addEventListener("resize", resizeAll);

    // ----- Dark readiness gate to prevent flash -----
    const onDarkIdle = () => {
      if (dead) return;
      setDarkIdleReady(true);
      // snap to last camera so when it appears it’s already aligned
      try { darkMap.jumpTo(lastCamRef.current); } catch {}
    };
    darkMap.once("idle", onDarkIdle);

    // ----- Helpers to set paint safely on overlay -----
    const safeSetPaint = (layerId, prop, value) => {
      try {
        if (!overlayMap.getLayer(layerId)) return;
        overlayMap.setPaintProperty(layerId, prop, value);
      } catch {}
    };

    const addLights = async () => {
      // Blackout layer FIRST, default to 1 to prevent any flash during load
      if (!overlayMap.getLayer("blackout")) {
        overlayMap.addLayer({
          id: "blackout",
          type: "background",
          paint: {
            "background-color": "#000",
            "background-opacity": 1,
          },
        });
      }

      if (!litDataRef.current) {
        onStatus("Loading lit roads…");
        const url = `${import.meta.env.BASE_URL}data/lit_web.geojson`;
        const res = await fetch(url);
        if (!res.ok) {
          onStatus(`FAILED: lit_web.geojson (${res.status})`);
          return false;
        }
        litDataRef.current = await res.json();
      }

      if (!overlayMap.getSource("lit-roads")) {
        overlayMap.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
      }

      const LIT_FILTER = ["==", ["get", "lit"], "yes"];

      const coreColor = "#FFF0C2";
      const glowColor = "#FF9C2A";
      const bloomColor = "#FF7A00";

      const add = (id, color, widthExpr, blur) => {
        if (overlayMap.getLayer(id)) return;
        overlayMap.addLayer({
          id,
          type: "line",
          source: "lit-roads",
          filter: LIT_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": color,
            "line-width": widthExpr,
            "line-blur": blur,
            "line-opacity": 0,
          },
        });
      };

      add("lit-glow-3", bloomColor, ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 14, 17, 30], 14);
      add("lit-glow-2", glowColor,  ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 10, 17, 22], 10);
      add("lit-glow-1", glowColor,  ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6, 17, 14], 5);
      add("lit-core",   coreColor,  ["interpolate", ["linear"], ["zoom"], 10, 1.0, 14, 2.2, 17, 5], 0.8);

      onStatus("Ready");
      return true;
    };

    overlayMap.once("load", async () => {
      const ok = await addLights();
      if (!ok || dead) return;

      // apply initial props once layers exist
      const bo = clamp01(asNumber(blackoutOpacity, 0));
      const lo = clamp01(asNumber(lightsOpacity, 0));
      safeSetPaint("blackout", "background-opacity", bo);
      safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
      safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
      safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
      safeSetPaint("lit-core",   "line-opacity", lo * 0.95);
    });

    // ----- THE IMPORTANT PART: lock basemaps to overlay CAMERA ON EVERY MOVE -----
    const syncBasemapsToOverlay = () => {
      const c = overlayMap.getCenter();
      const cam = {
        center: [c.lng, c.lat],
        zoom: overlayMap.getZoom(),
        bearing: overlayMap.getBearing(),
        pitch: overlayMap.getPitch(),
      };

      lastCamRef.current = cam;

      // If a style isn't fully ready yet, jumpTo can be ignored — so check styleLoaded
      try { if (dayMap.isStyleLoaded()) dayMap.jumpTo(cam); } catch {}
      try { if (darkMap.isStyleLoaded()) darkMap.jumpTo(cam); } catch {}
    };

    const emitReactThrottled = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const c = overlayMap.getCenter();
        onView({
          lng: c.lng,
          lat: c.lat,
          zoom: overlayMap.getZoom(),
          bearing: overlayMap.getBearing(),
          pitch: overlayMap.getPitch(),
        });
      });
    };

    overlayMap.on("move", syncBasemapsToOverlay);
    overlayMap.on("move", emitReactThrottled);

    return () => {
      dead = true;
      window.removeEventListener("resize", resizeAll);

      try { overlayMap.off("move", syncBasemapsToOverlay); } catch {}
      try { overlayMap.off("move", emitReactThrottled); } catch {}
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      try { dayMap.remove(); } catch {}
      try { darkMap.remove(); } catch {}
      try { overlayMap.remove(); } catch {}

      dayRef.current = null;
      darkRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // create once

  // Update overlay paints when opacities change
  useEffect(() => {
    const overlayMap = overlayRef.current;
    if (!overlayMap) return;
    try {
      if (overlayMap.getLayer("blackout")) {
        overlayMap.setPaintProperty(
          "blackout",
          "background-opacity",
          clamp01(asNumber(blackoutOpacity, 0))
        );
      }
    } catch {}
  }, [blackoutOpacity]);

  useEffect(() => {
    const overlayMap = overlayRef.current;
    if (!overlayMap) return;

    const lo = clamp01(asNumber(lightsOpacity, 0));
    try {
      if (overlayMap.getLayer("lit-glow-3")) overlayMap.setPaintProperty("lit-glow-3", "line-opacity", lo * 0.18);
      if (overlayMap.getLayer("lit-glow-2")) overlayMap.setPaintProperty("lit-glow-2", "line-opacity", lo * 0.30);
      if (overlayMap.getLayer("lit-glow-1")) overlayMap.setPaintProperty("lit-glow-1", "line-opacity", lo * 0.45);
      if (overlayMap.getLayer("lit-core"))   overlayMap.setPaintProperty("lit-core",   "line-opacity", lo * 0.95);
    } catch {}
  }, [lightsOpacity]);

  return (
    <div className="absolute inset-0">
      {/* Day basemap */}
      <div ref={dayEl} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

      {/* Dark basemap (fade in only once it has idled at least once to prevent flash) */}
      <div
        ref={darkEl}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: darkIdleReady ? darkMapOpacity : 0,
          transition: "opacity 250ms linear",
        }}
      />

      {/* Interactive overlay */}
      <div ref={overlayEl} style={{ position: "absolute", inset: 0, pointerEvents: "auto" }} />
    </div>
  );
}