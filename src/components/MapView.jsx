import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const AMSTERDAM_CENTER = [4.9, 52.37];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

const STYLE_DAY = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function MapView({
  baseOpacity = 1,
  lightsOpacity = 0,
  darkBasemapOn = false,
  onStatus = () => {},
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  // Keep the lit GeoJSON in memory so we can re-add after style changes
  const litDataRef = useRef(null);

  // StrictMode-safe
  const loadedRef = useRef(false);
  const currentStyleRef = useRef("day"); // "day" | "dark"

  const safeSetPaint = (layerId, prop, value) => {
    const map = mapRef.current;
    try {
      if (!map) return;
      if (!loadedRef.current) return;
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, prop, value);
    } catch {
      // ignore
    }
  };

  const ensureOverlaysAndLights = async (map) => {
    // Blackout overlay (always on top of basemap)
    if (!map.getLayer("blackout-overlay")) {
      map.addLayer({
        id: "blackout-overlay",
        type: "background",
        paint: {
          "background-color": "#000000",
          "background-opacity": 0,
        },
      });
    }

    // Load / keep lit data
    if (!litDataRef.current) {
      onStatus("Loading lit roads…");
      const url = `${import.meta.env.BASE_URL}data/lit_web.geojson`;
      const res = await fetch(url);
      if (!res.ok) {
        onStatus(`FAILED: lit_web.geojson (${res.status})`);
        return;
      }
      litDataRef.current = await res.json();
    }

    // Source
    if (!map.getSource("lit-roads")) {
      map.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
    }

    // Adjust if your data differs:
    const LIT_FILTER = ["==", ["get", "lit"], "yes"];

    const coreColor = "#FFF0C2";
    const glowColor = "#FF9C2A";
    const bloomColor = "#FF7A00";

    // Layers (add only if missing)
    if (!map.getLayer("lit-glow-3")) {
      map.addLayer({
        id: "lit-glow-3",
        type: "line",
        source: "lit-roads",
        filter: LIT_FILTER,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": bloomColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 14, 17, 30],
          "line-blur": 14,
          "line-opacity": 0,
        },
      });
    }

    if (!map.getLayer("lit-glow-2")) {
      map.addLayer({
        id: "lit-glow-2",
        type: "line",
        source: "lit-roads",
        filter: LIT_FILTER,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": glowColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 10, 17, 22],
          "line-blur": 10,
          "line-opacity": 0,
        },
      });
    }

    if (!map.getLayer("lit-glow-1")) {
      map.addLayer({
        id: "lit-glow-1",
        type: "line",
        source: "lit-roads",
        filter: LIT_FILTER,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": glowColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6, 17, 14],
          "line-blur": 5,
          "line-opacity": 0,
        },
      });
    }

    if (!map.getLayer("lit-core")) {
      map.addLayer({
        id: "lit-core",
        type: "line",
        source: "lit-roads",
        filter: LIT_FILTER,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": coreColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.0, 14, 2.2, 17, 5],
          "line-blur": 0.8,
          "line-opacity": 0,
        },
      });
    }

    loadedRef.current = true;
    onStatus("Ready.");

    // Apply current visual state immediately
    const base = clamp01(asNumber(baseOpacity, 1));
    const lo = clamp01(asNumber(lightsOpacity, 0));

    // In dark basemap mode, we want blackout overlay low so the map is visible
    const blackout = darkBasemapOn ? 0.15 : (1 - base);
    safeSetPaint("blackout-overlay", "background-opacity", clamp01(blackout));

    safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
    safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
    safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
    safeSetPaint("lit-core", "line-opacity", lo * 0.95);
  };

  useEffect(() => {
    // StrictMode dev safety: destroy old instance if it exists
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch {}
      mapRef.current = null;
      loadedRef.current = false;
      currentStyleRef.current = "day";
    }

    onStatus("Creating map…");

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: AMSTERDAM_CENTER,
      zoom: 12,
      minZoom: 9,
      maxZoom: 18,
      style: STYLE_DAY, // vector = crisp text
    });

    mapRef.current = map;

    const onLoad = async () => {
      onStatus("Map loaded. Adding overlays…");
      loadedRef.current = false;
      await ensureOverlaysAndLights(map);
    };

    map.once("load", onLoad);

    return () => {
      try {
        map.off("load", onLoad);
        map.remove();
      } catch {}
      mapRef.current = null;
      loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle style toggle for “Show full map”
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const want = darkBasemapOn ? "dark" : "day";
    if (want === currentStyleRef.current) {
      // just adjust blackout overlay when toggling without style change
      const base = clamp01(asNumber(baseOpacity, 1));
      const blackout = darkBasemapOn ? 0.15 : (1 - base);
      safeSetPaint("blackout-overlay", "background-opacity", clamp01(blackout));
      return;
    }

    onStatus(`Switching style… (${want})`);
    loadedRef.current = false;
    currentStyleRef.current = want;

    const styleUrl = darkBasemapOn ? STYLE_DARK : STYLE_DAY;
    map.setStyle(styleUrl);

    // After setStyle, we must re-add overlays/layers once the new style loads
    map.once("styledata", async () => {
      // styledata can fire multiple times; ensureOverlaysAndLights is idempotent
      await ensureOverlaysAndLights(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkBasemapOn]);

  // Update blackout based on baseOpacity (day→black transition)
  useEffect(() => {
    const base = clamp01(asNumber(baseOpacity, 1));
    const blackout = darkBasemapOn ? 0.15 : (1 - base);
    safeSetPaint("blackout-overlay", "background-opacity", clamp01(blackout));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseOpacity, darkBasemapOn]);

  // Update lights opacity
  useEffect(() => {
    const lo = clamp01(asNumber(lightsOpacity, 0));
    safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
    safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
    safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
    safeSetPaint("lit-core", "line-opacity", lo * 0.95);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightsOpacity]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
