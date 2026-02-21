import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Carto basemap styles (day + dark)
const STYLE_DAY = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Small helpers
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
  // Keep map instances around (so we can update them from effects)
  const dayRef = useRef(null);
  const darkRef = useRef(null);
  const overlayRef = useRef(null);

  // DOM containers for each MapLibre canvas
  const dayEl = useRef(null);
  const darkEl = useRef(null);
  const overlayEl = useRef(null);

  // I only fade the dark map in after it's "idle" once (prevents a flash)
  const [darkIdleReady, setDarkIdleReady] = useState(false);

  // Cache the GeoJSON in-memory so I don’t refetch it
  const litDataRef = useRef(null);

  // I throttle view updates back into React using RAF (smooth dragging)
  const rafRef = useRef(null);

  // I keep the last camera state so newly-ready maps can snap into place
  const lastCamRef = useRef({
    center: [view.lng, view.lat],
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch,
  });

  useEffect(() => {
    let dead = false; // simple “is unmounted” guard

    onStatus("Creating maps…");

    // -----------------------------
    // 1) Create the DAY basemap
    // -----------------------------
    // Non-interactive: the overlay map is the one that receives gestures.
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

    // -----------------------------
    // 2) Create the DARK basemap
    // -----------------------------
    // Also non-interactive and faded in/out using darkMapOpacity.
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

    // I hide place-name labels on the dark map (e.g., “Amsterdam”),
    // but I try to leave other labels (like roads) alone.
    const hidePlaceNames = () => {
      try {
        const style = darkMap.getStyle();
        if (!style?.layers) return;

        for (const layer of style.layers) {
          if (layer.type !== "symbol") continue;

          const id = layer.id || "";
          const looksLikePlace =
            /place|settlement|city|town|village|hamlet|suburb|neighbourhood|neighborhood/i.test(id);

          if (looksLikePlace) {
            try {
              darkMap.setLayoutProperty(layer.id, "visibility", "none");
            } catch {}
          }
        }
      } catch {}
    };

    // Apply label hiding once the dark style has loaded…
    darkMap.once("load", hidePlaceNames);

    // …and re-apply if the style updates internally.
    const onDarkStyleData = () => {
      try {
        if (darkMap.isStyleLoaded && darkMap.isStyleLoaded()) hidePlaceNames();
      } catch {}
    };
    darkMap.on("styledata", onDarkStyleData);

    // -----------------------------
    // 3) Create the OVERLAY map
    // -----------------------------
    // Transparent style so only my lighting layers show.
    // This is the ONLY interactive map.
    const overlayMap = new maplibregl.Map({
      container: overlayEl.current,
      style: { version: 8, sources: {}, layers: [] },
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: true,
      attributionControl: false,
    });

    // Store instances in refs (so other effects can use them)
    dayRef.current = dayMap;
    darkRef.current = darkMap;
    overlayRef.current = overlayMap;

    // -----------------------------
    // 4) Keep canvas sizes correct
    // -----------------------------
    // MapLibre can get “stuck” if it thinks the canvas size is 0,
    // so I resize all maps on mount and on window resize.
    const resizeAll = () => {
      try { dayMap.resize(); } catch {}
      try { darkMap.resize(); } catch {}
      try { overlayMap.resize(); } catch {}
    };
    requestAnimationFrame(resizeAll);
    window.addEventListener("resize", resizeAll);

    // -----------------------------
    // 5) Gate dark-map fade-in
    // -----------------------------
    // Waiting for "idle" avoids the dark map flashing in while tiles are still loading.
    const onDarkIdle = () => {
      if (dead) return;
      setDarkIdleReady(true);

      // When dark becomes ready, snap it to the last camera so it matches instantly.
      try { darkMap.jumpTo(lastCamRef.current); } catch {}
    };
    darkMap.once("idle", onDarkIdle);

    // -----------------------------
    // 6) Helpers for overlay styling
    // -----------------------------
    const safeSetPaint = (layerId, prop, value) => {
      try {
        if (!overlayMap.getLayer(layerId)) return;
        overlayMap.setPaintProperty(layerId, prop, value);
      } catch {}
    };

    // Add lighting layers (load GeoJSON once, then add glow lines)
    const addLights = async () => {
      // Black screen layer used for the “night” effect
      if (!overlayMap.getLayer("blackout")) {
        overlayMap.addLayer({
          id: "blackout",
          type: "background",
          paint: {
            "background-color": "#000",
            // I start at 1 so there’s no flash while data/layers are loading
            "background-opacity": 1,
          },
        });
      }

      // Fetch the lit roads GeoJSON once and cache it
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

      // Create a GeoJSON source for lit roads
      if (!overlayMap.getSource("lit-roads")) {
        overlayMap.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
      }

      // Only show features tagged lit = yes
      const LIT_FILTER = ["==", ["get", "lit"], "yes"];

      // Simple glow palette (core + halos)
      const coreColor = "#FFF0C2";
      const glowColor = "#FF9C2A";
      const bloomColor = "#FF7A00";

      // Helper for adding each glow layer
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
            // Width changes with zoom so it always looks “glowy” but readable
            "line-width": widthExpr,
            "line-blur": blur,
            // Opacity gets driven by React (lightsOpacity)
            "line-opacity": 0,
          },
        });
      };

      // Big blurry outer glows
      add("lit-glow-3", bloomColor, ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 14, 17, 30], 14);
      add("lit-glow-2", glowColor,  ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 10, 17, 22], 10);

      // Smaller inner glows + core
      add("lit-glow-1", glowColor,  ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6, 17, 14], 5);
      add("lit-core",   coreColor,  ["interpolate", ["linear"], ["zoom"], 10, 1.0, 14, 2.2, 17, 5], 0.8);

      onStatus("Ready");
      return true;
    };

    // Wait for overlay to load, then add lighting layers
    overlayMap.once("load", async () => {
      const ok = await addLights();
      if (!ok || dead) return;

      // Apply initial visual state (from React props)
      const bo = clamp01(asNumber(blackoutOpacity, 0));
      const lo = clamp01(asNumber(lightsOpacity, 0));
      safeSetPaint("blackout", "background-opacity", bo);
      safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
      safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
      safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
      safeSetPaint("lit-core",   "line-opacity", lo * 0.95);
    });

    // -----------------------------
    // 7) Keep basemaps locked to overlay
    // -----------------------------
    // Overlay is the “driver”. Basemaps follow it instantly.
    const syncBasemapsToOverlay = () => {
      const c = overlayMap.getCenter();

      // Camera snapshot from overlay
      const cam = {
        center: [c.lng, c.lat],
        zoom: overlayMap.getZoom(),
        bearing: overlayMap.getBearing(),
        pitch: overlayMap.getPitch(),
      };

      // Store for later (used when dark map becomes ready)
      lastCamRef.current = cam;

      // Avoid jumpTo before styles are loaded (it can be ignored)
      try { if (dayMap.isStyleLoaded()) dayMap.jumpTo(cam); } catch {}
      try { if (darkMap.isStyleLoaded()) darkMap.jumpTo(cam); } catch {}
    };

    // I still keep React state updated, but throttled (so it stays smooth)
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

    // Attach move handlers (drag/zoom/rotate)
    overlayMap.on("move", syncBasemapsToOverlay);
    overlayMap.on("move", emitReactThrottled);

    // -----------------------------
    // 8) Cleanup
    // -----------------------------
    return () => {
      dead = true;

      window.removeEventListener("resize", resizeAll);

      try { overlayMap.off("move", syncBasemapsToOverlay); } catch {}
      try { overlayMap.off("move", emitReactThrottled); } catch {}
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      try { darkMap.off("styledata", onDarkStyleData); } catch {}

      try { dayMap.remove(); } catch {}
      try { darkMap.remove(); } catch {}
      try { overlayMap.remove(); } catch {}

      dayRef.current = null;
      darkRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // create once

  // -----------------------------
  // 9) React -> Map paint updates
  // -----------------------------
  // Update blackout opacity (night mask)
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

  // Update the glow opacities when lightsOpacity changes
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

  // -----------------------------
  // 10) Render the three canvases
  // -----------------------------
  return (
    <div className="absolute inset-0">
      {/* Day basemap canvas */}
      <div
        ref={dayEl}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />

      {/* Dark basemap canvas (only visible once it has idled at least once) */}
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

      {/* Overlay canvas (interactive) */}
      <div
        ref={overlayEl}
        style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
      />
    </div>
  );
}