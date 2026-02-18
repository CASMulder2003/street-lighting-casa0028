import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const AMSTERDAM_CENTER = [4.9, 52.37];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export default function MapView({
  baseOpacity = 1,
  lightsOpacity = 0,
  darkBasemapOn = false,
  onStatus = () => {},
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  // StrictMode-safe: we must reset this on cleanup or refresh breaks
  const loadedRef = useRef(false);

  const safeSetPaint = (layerId, prop, value) => {
    const map = mapRef.current;
    try {
      if (!map) return;
      if (!loadedRef.current) return;
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, prop, value);
    } catch {
      // ignore timing issues
    }
  };

  useEffect(() => {
    // StrictMode dev: ensure no stale instance blocks init
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch {}
      mapRef.current = null;
      loadedRef.current = false;
    }

    onStatus("Creating map…");

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: AMSTERDAM_CENTER,
      zoom: 12,
      minZoom: 9,
      maxZoom: 18,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {},
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#000" } },
        ],
      },
    });

    mapRef.current = map;

    const onLoad = async () => {
      try {
        onStatus("Map loaded. Adding basemaps…");

        // --- Intro basemap (light) ---
        map.addSource("base-intro", {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          ],
          tileSize: 256,
        });

        map.addLayer({
          id: "intro-basemap",
          type: "raster",
          source: "base-intro",
          paint: {
            "raster-opacity": 1,
            "raster-saturation": -0.1,
            "raster-contrast": 0.15,
          },
        });

        // --- Dark basemap (behind lights) ---
        map.addSource("base-dark", {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          ],
          tileSize: 256,
        });

        map.addLayer({
          id: "dark-basemap",
          type: "raster",
          source: "base-dark",
          paint: {
            "raster-opacity": 0, // toggled later
            "raster-brightness-min": 0.15,
            "raster-brightness-max": 0.85,
            "raster-saturation": -0.35,
            "raster-contrast": 0.25,
          },
        });

        // --- Blackout overlay above basemaps ---
        map.addLayer({
          id: "blackout-overlay",
          type: "background",
          paint: {
            "background-color": "#000000",
            "background-opacity": 0,
          },
        });

        onStatus("Loading lit roads…");

        const url = `${import.meta.env.BASE_URL}data/lit_web.geojson`;
        const res = await fetch(url);

        if (!res.ok) {
          onStatus(`FAILED: lit_web.geojson (${res.status})`);
          return;
        }

        const lit = await res.json();

        map.addSource("lit-roads", { type: "geojson", data: lit });

        // If your data differs, change this one line:
        const LIT_FILTER = ["==", ["get", "lit"], "yes"];

        // Stronger glow palette
        const coreColor = "#FFF0C2";
        const glowColor = "#FF9C2A";
        const bloomColor = "#FF7A00";

        // Extra soft bloom (bottom-most) — makes the whole line feel luminous
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

        // Big glow
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

        // Mid glow
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

        // Core
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

        loadedRef.current = true;
        onStatus("Ready.");

        // Apply initial state
        const base = clamp01(asNumber(baseOpacity, 1));
        const lo = clamp01(asNumber(lightsOpacity, 0));

        // Basemap fade
        safeSetPaint("intro-basemap", "raster-opacity", base);

        // Blackout: if dark basemap is ON, keep overlay translucent so map shows through
        const blackout = darkBasemapOn ? 0.15 : (1 - base);
        safeSetPaint("blackout-overlay", "background-opacity", clamp01(blackout));

        // Dark basemap toggle
        safeSetPaint("dark-basemap", "raster-opacity", darkBasemapOn ? 0.65 : 0);

        // Lights
        safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
        safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
        safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
        safeSetPaint("lit-core", "line-opacity", lo * 0.95);
      } catch (e) {
        onStatus(`ERROR: ${String(e?.message || e)}`);
      }
    };

    map.once("load", onLoad);

    return () => {
      try {
        map.off("load", onLoad);
        map.remove();
      } catch {}

      // StrictMode FIX: reset refs so next mount can create a map
      mapRef.current = null;
      loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update basemap + blackout as baseOpacity changes
  useEffect(() => {
    const base = clamp01(asNumber(baseOpacity, 1));
    safeSetPaint("intro-basemap", "raster-opacity", base);

    const blackout = darkBasemapOn ? 0.15 : (1 - base);
    safeSetPaint("blackout-overlay", "background-opacity", clamp01(blackout));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseOpacity, darkBasemapOn]);

  // Update lights
  useEffect(() => {
    const lo = clamp01(asNumber(lightsOpacity, 0));
    safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
    safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
    safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
    safeSetPaint("lit-core", "line-opacity", lo * 0.95);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightsOpacity]);

  // Update dark basemap toggle
  useEffect(() => {
    safeSetPaint("dark-basemap", "raster-opacity", darkBasemapOn ? 0.65 : 0);

    // When showing full map, ensure overlay isn’t fully black
    if (darkBasemapOn) {
      safeSetPaint("blackout-overlay", "background-opacity", 0.15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darkBasemapOn]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
