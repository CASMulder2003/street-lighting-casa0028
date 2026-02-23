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
 * Two stacked maps:
 * - Bottom: day basemap (not interactive)
 * - Top: night basemap + glowing lit roads (interactive)
 *
 * I tried a 1-map setup and a 3-map setup first, but had issues (camera/transition glitches).
 * This 2-map approach is the cleanest: smooth fades, stable movement, no setStyle().
 * I used AI to help test/refine this structure.
 *
 * Props:
 * - view, onView: camera state + updates back to React
 * - topOpacity: crossfade for night map (0–1)
 * - lightsOpacity: brightness of the glow (0–1)
 * - blackoutOpacity: black mask strength (0–1)
 * - onStatus: status text
 * - onViewportStats: sends back “in view” stats
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
  // Map containers (MapLibre needs real DOM nodes)
  const dayRef = useRef(null);
  const nightRef = useRef(null);

  // Map instances (stored in refs so they don’t re-create on re-render)
  const dayMapRef = useRef(null);
  const nightMapRef = useRef(null);

  // Data is loaded once and cached here
  const roadsDataRef = useRef(null); // roads_web.geojson (all roads)
  const litDataRef = useRef(null); // lit_web.geojson (lit-tagged subset)
  const litHashSetRef = useRef(null); // quick “is this lit?” lookup

  // Used to throttle updates (keeps panning smooth)
  const rafRef = useRef(null);

  // Stops feedback loops when syncing cameras
  const syncingRef = useRef(false);

  // Basemap styles
  const STYLE_DAY =
    "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
  const STYLE_DARK =
    "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

  // Small helpers
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

  // A world-sized polygon used for the black “mask” layer
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

  // Hide place labels on the night map (the glow looks cleaner without them)
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

  // Add the mask + lit layers to the night map, and load the data if needed
  const ensureNightLayers = async (map) => {
    // 1) Black mask (opacity controlled by blackoutOpacity)
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

    // 2) Load GeoJSON once (roads + lit)
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

      // Used for quick matching between roads and lit segments
      litHashSetRef.current = buildLitHashSet(litDataRef.current);

      // Precompute bbox/length/hash so viewport stats stay fast
      annotateRoadFeatures(roadsDataRef.current);
    }

    // 3) Add lit roads source (used only for the glowing visuals)
    if (!map.getSource("lit-roads")) {
      map.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
    }

    const LIT_FILTER = ["==", ["get", "lit"], "yes"];

    // Helper to add one glow layer (we stack a few to get the neon effect)
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
          "line-width": widthExpr,
          "line-blur": blur,
          "line-opacity": 0, // controlled by lightsOpacity
        },
      });
    };

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

  // Update mask + glow opacities on the night map
  const applyNightVisuals = () => {
    const map = nightMapRef.current;
    if (!map) return;

    const bo = clamp01(asNumber(blackoutOpacity, 0));
    const lo = clamp01(asNumber(lightsOpacity, 0));

    try {
      if (map.getLayer("dim-mask")) {
        map.setPaintProperty("dim-mask", "fill-opacity", bo);
      }

      if (map.getLayer("lit-glow-3"))
        map.setPaintProperty("lit-glow-3", "line-opacity", lo * 0.18);
      if (map.getLayer("lit-glow-2"))
        map.setPaintProperty("lit-glow-2", "line-opacity", lo * 0.3);
      if (map.getLayer("lit-glow-1"))
        map.setPaintProperty("lit-glow-1", "line-opacity", lo * 0.45);
      if (map.getLayer("lit-core"))
        map.setPaintProperty("lit-core", "line-opacity", lo * 0.95);
    } catch {}
  };

  // Keep day map camera matched to the night map camera
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

  // Calculate the “in view” stats for the current bounds and send them back up
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

  // Create both maps once (on mount)
  useEffect(() => {
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

    // Throttle updates to once per animation frame
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

        computeViewportStats();
      });
    };

    // User moves the night map -> sync day map + update React state
    nightMap.on("move", () => {
      if (syncingRef.current) return;
      syncCamera(nightMap, dayMap);
      emitReactThrottled();
    });

    // Make sure day map matches when it finishes loading
    dayMap.on("load", () => {
      syncCamera(nightMap, dayMap);
    });

    // When the night style loads, add layers and set initial visuals/stats
    nightMap.on("style.load", async () => {
      await ensureNightLayers(nightMap);
      hidePlaceNames(nightMap);
      applyNightVisuals();
      computeViewportStats();
    });

    // Cleanup
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

  // Update visuals when these values change
  useEffect(() => {
    applyNightVisuals();
  }, [lightsOpacity, blackoutOpacity]);

  // Opacity for the night map crossfade
  const topOp = clamp01(asNumber(topOpacity, 0));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Day map (bottom) */}
      <div
        ref={dayRef}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      {/* Night map (top) */}
      <div
        ref={nightRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: topOp,
          // Opacity animation is handled in App.jsx (tween), so no CSS easing here
          transition: "opacity 0ms",
        }}
      />
    </div>
  );
}