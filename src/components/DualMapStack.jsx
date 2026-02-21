import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  buildLitHashSet,
  annotateRoadFeatures,
  computeViewportStatsFromRoads,
} from "../utils/stats.js";

/**
 * DualMapStack
 *
 * Renders two stacked MapLibre maps:
 * - Bottom: day basemap (static)
 * - Top: night basemap + glowing lit roads (interactive)
 *
 * I tested both a single-map and a three-map setup.
 * The single-map approach caused transition/camera issues,
 * while three maps made animations overly complex.
 *
 * This two-map solution allows smooth crossfading without setStyle(),
 * keeps camera movement stable, and avoids reloading layers.
 * AI was used to explore and refine this architecture.
 *
 * Props:
 * - view: camera state
 * - onView: sync camera back to React
 * - topOpacity: night map crossfade (0–1)
 * - lightsOpacity: glow intensity (0–1)
 * - blackoutOpacity: dim mask opacity (0–1)
 * - onStatus: optional status updates
 * - onViewportStats: returns computed viewport metrics
 */

export default function DualMapStack({
  view,
  onView,
  topOpacity,
  lightsOpacity,
  blackoutOpacity,
  onStatus = () => {},
  onViewportStats = () => {},
}) {
  // DOM containers (MapLibre needs actual DOM elements, so we use refs)
  const dayRef = useRef(null);
  const nightRef = useRef(null);

  // MapLibre map instances live in refs to avoid re-creating them on every render
  const dayMapRef = useRef(null);
  const nightMapRef = useRef(null);

  // Data caches (loaded once and reused)
  const roadsDataRef = useRef(null); // roads_web.geojson (total roads in view)
  const litDataRef = useRef(null); // lit_web.geojson (subset: lit-tagged roads)
  const litHashSetRef = useRef(null); // fast membership test of "lit" geometries

  // requestAnimationFrame handle for throttling React state updates
  const rafRef = useRef(null);

  // Guard to prevent infinite feedback loop while synchronising cameras
  const syncingRef = useRef(false);

  // Basemap style URLs (Carto)
  const STYLE_DAY =
    "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
  const STYLE_DARK =
    "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

  // Small helpers
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

  /**
   * WORLD_MASK is a single polygon covering the world.
   * We use it as a "dim layer" (a black fill) and control its opacity.
   * This gives the blackout effect without swapping basemaps.
   */
  const WORLD_MASK = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-180, -85],
              [180, -85],
              [180, 85],
              [-180, 85],
              [-180, -85],
            ],
          ],
        },
      },
    ],
  };

  /**
   * Hide place-name labels in the night map as it looks bad with the street lighting effect on top.
   * (Wrapped in try/catch so it fails gracefully if a style differs.)
   */
  const hidePlaceNames = (map) => {
    try {
      const style = map.getStyle();
      if (!style?.layers) return;

      for (const layer of style.layers) {
        if (layer.type !== "symbol") continue;
        if (/place|settlement|city|town|village/i.test(layer.id)) {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }
    } catch {}
  };

  /**
   * Ensure all night-only sources and layers exist.
   * This runs once per style load (MapLibre emits "style.load" after style JSON is ready).
   */
  const ensureNightLayers = async (map) => {
    // 1) Black dim-mask layer (for the blackout / reveal effect)
    if (!map.getSource("world-mask")) {
      map.addSource("world-mask", { type: "geojson", data: WORLD_MASK });
    }
    if (!map.getLayer("dim-mask")) {
      map.addLayer({
        id: "dim-mask",
        type: "fill",
        source: "world-mask",
        paint: { "fill-color": "#000", "fill-opacity": 1 },
      });
    }

    // 2) Load datasets once (roads + lit)
    //    roads_web.geojson provides the denominator (total mapped road length)
    //    lit_web.geojson provides the glowing layer + membership for stats
    if (!roadsDataRef.current || !litDataRef.current || !litHashSetRef.current) {
      onStatus("Loading road + lighting data…");

      const base = import.meta.env.BASE_URL;
      const [roadsRes, litRes] = await Promise.all([
        fetch(`${base}data/roads_web.geojson`),
        fetch(`${base}data/lit_web.geojson`),
      ]);

      if (!roadsRes.ok || !litRes.ok) return;

      roadsDataRef.current = await roadsRes.json();
      litDataRef.current = await litRes.json();

      // Build a Set of geometry hashes so we can very quickly check:
      // "Is this road segment also present in the lit dataset?"
      litHashSetRef.current = buildLitHashSet(litDataRef.current);

      // Precompute bbox + length + hash for each road feature.
      // This makes viewport stats fast enough to recompute on pan/zoom.
      annotateRoadFeatures(roadsDataRef.current);
    }

    // 3) Add the lit roads as a source for the glowing layers
    if (!map.getSource("lit-roads")) {
      map.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
    }

    // Only draw features explicitly tagged lit=yes in the lit dataset
    const LIT_FILTER = ["==", ["get", "lit"], "yes"];

    // Helper to add a single glow layer (we stack multiple for a neon effect)
    const addLine = (id, color, widthExpr, blur) => {
      if (map.getLayer(id)) return;

      map.addLayer({
        id,
        type: "line",
        source: "lit-roads",
        filter: LIT_FILTER,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": color,
          "line-width": widthExpr, // width scales with zoom
          "line-blur": blur,
          "line-opacity": 0, // animated via applyNightVisuals()
        },
      });
    };

    // Multiple layers = glow + core highlight
    addLine(
      "lit-glow-3",
      "#FF7A00",
      ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 14, 17, 30],
      14
    );
    addLine(
      "lit-glow-2",
      "#FF9C2A",
      ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 10, 17, 22],
      10
    );
    addLine(
      "lit-glow-1",
      "#FF9C2A",
      ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6, 17, 14],
      5
    );
    addLine(
      "lit-core",
      "#FFF0C2",
      ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2, 17, 5],
      0.8
    );

    onStatus("Ready");
  };

  /**
   * Apply current visual parameters to the night map.
   * This updates:
   * - dim-mask opacity (blackoutOpacity)
   * - glow/core opacity (lightsOpacity)
   *
   * This is called whenever props change (see useEffect below).
   */
  const applyNightVisuals = () => {
    const map = nightMapRef.current;
    if (!map) return;

    const bo = clamp01(asNumber(blackoutOpacity, 0));
    const lo = clamp01(asNumber(lightsOpacity, 0));

    try {
      if (map.getLayer("dim-mask")) {
        map.setPaintProperty("dim-mask", "fill-opacity", bo);
      }

      // Glow stack (low opacities for the bloom feel)
      if (map.getLayer("lit-glow-3"))
        map.setPaintProperty("lit-glow-3", "line-opacity", lo * 0.18);
      if (map.getLayer("lit-glow-2"))
        map.setPaintProperty("lit-glow-2", "line-opacity", lo * 0.3);
      if (map.getLayer("lit-glow-1"))
        map.setPaintProperty("lit-glow-1", "line-opacity", lo * 0.45);

      // Core line (higher opacity to keep it crisp)
      if (map.getLayer("lit-core"))
        map.setPaintProperty("lit-core", "line-opacity", lo * 0.95);
    } catch {}
  };

  /**
   * Keep the bottom (day) map camera locked to the top (night) map camera.
   * We use jumpTo for instant sync, and a guard flag to avoid recursion.
   */
  const syncCamera = (fromMap, toMap) => {
    if (!fromMap || !toMap) return;

    const c = fromMap.getCenter();
    syncingRef.current = true;
    toMap.jumpTo({
      center: [c.lng, c.lat],
      zoom: fromMap.getZoom(),
      bearing: fromMap.getBearing(),
      pitch: fromMap.getPitch(),
    });
    syncingRef.current = false;
  };

  /**
   * Compute the "In view" stats for the current viewport:
   * % of road length tagged as lit, within the current map bounds.
   *
   * The heavy work (bbox/length/hash) is precomputed in utils/stats.js so this
   * can run on every pan/zoom without lag.
   */
  const computeViewportStats = () => {
    const map = nightMapRef.current;
    const roadsFC = roadsDataRef.current;
    const litSet = litHashSetRef.current;

    if (!map || !roadsFC || !litSet) return;

    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];

    const stats = computeViewportStatsFromRoads({
      boundsBBox: bbox,
      roadsFeatureCollection: roadsFC,
      litHashSet: litSet,
    });

    onViewportStats(stats);
  };

  /**
   * Create the two maps once.
   * We intentionally do this only on mount (empty dependency array).
   */
  useEffect(() => {
    // Bottom map: day basemap, non-interactive (acts like a background image)
    const dayMap = new maplibregl.Map({
      container: dayRef.current,
      style: STYLE_DAY,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: false,
      attributionControl: false,
    });
    dayMapRef.current = dayMap;

    // Top map: night basemap, interactive (this is the "real" map the user controls)
    const nightMap = new maplibregl.Map({
      container: nightRef.current,
      style: STYLE_DARK,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: true,
      attributionControl: false,
    });
    nightMapRef.current = nightMap;

    /**
     * Throttle updates back into React to once per animation frame.
     * This keeps panning smooth while still keeping state in sync.
     */
    const emitReactThrottled = () => {
      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const c = nightMap.getCenter();
        onView({
          lng: c.lng,
          lat: c.lat,
          zoom: nightMap.getZoom(),
          bearing: nightMap.getBearing(),
          pitch: nightMap.getPitch(),
        });

        // Update "in view" stats at the same throttled rate as camera updates
        computeViewportStats();
      });
    };

    // When the user moves the night map:
    // - sync the day map camera
    // - send camera changes to React (throttled)
    nightMap.on("move", () => {
      if (syncingRef.current) return;
      syncCamera(nightMap, dayMap);
      emitReactThrottled();
    });

    // Ensure the day map matches immediately after it loads
    dayMap.on("load", () => {
      syncCamera(nightMap, dayMap);
    });

    // After the night style loads, add the custom layers and apply visuals
    nightMap.on("style.load", async () => {
      await ensureNightLayers(nightMap);
      hidePlaceNames(nightMap);
      applyNightVisuals();
      computeViewportStats(); // initial value
    });

    // Cleanup on unmount
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        nightMap.remove();
      } catch {}
      try {
        dayMap.remove();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Whenever these props change, update the MapLibre paint properties.
   * (This avoids re-creating layers or touching the style.)
   */
  useEffect(() => {
    applyNightVisuals();
  }, [lightsOpacity, blackoutOpacity]);

  // Night map crossfade opacity (clamped to 0..1)
  const topOp = clamp01(asNumber(topOpacity, 0));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Day map (bottom layer) */}
      <div
        ref={dayRef}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      {/* Night map (top layer) */}
      <div
        ref={nightRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: topOp,
          // No CSS easing here as the opacity animation is driven by the tween in App.jsx
          transition: "opacity 0ms",
        }}
      />
    </div>
  );
}