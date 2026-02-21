import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE_DAY =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

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

export default function DualMapStack({
  view,
  onView,
  topOpacity, // CSS fade for night map (0..1)
  lightsOpacity,
  blackoutOpacity,
  onStatus = () => {},
}) {
  const dayRef = useRef(null);
  const nightRef = useRef(null);

  const dayMapRef = useRef(null);
  const nightMapRef = useRef(null);

  const litDataRef = useRef(null);
  const rafRef = useRef(null);
  const syncingRef = useRef(false);

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

  const ensureNightLayers = async (map) => {
    // blackout mask
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

    // lights data
    if (!litDataRef.current) {
      onStatus("Loading lit roads…");
      const url = `${import.meta.env.BASE_URL}data/lit_web.geojson`;
      const res = await fetch(url);
      if (!res.ok) return;
      litDataRef.current = await res.json();
    }

    if (!map.getSource("lit-roads")) {
      map.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
    }

    const LIT_FILTER = ["==", ["get", "lit"], "yes"];
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
          "line-opacity": 0,
        },
      });
    };

    addLine("lit-glow-3", "#FF7A00", ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 14, 17, 30], 14);
    addLine("lit-glow-2", "#FF9C2A", ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 10, 17, 22], 10);
    addLine("lit-glow-1", "#FF9C2A", ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6, 17, 14], 5);
    addLine("lit-core",   "#FFF0C2", ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2, 17, 5], 0.8);

    onStatus("Ready");
  };

  const applyNightVisuals = () => {
    const map = nightMapRef.current;
    if (!map) return;

    const bo = clamp01(asNumber(blackoutOpacity, 0));
    const lo = clamp01(asNumber(lightsOpacity, 0));

    try {
      if (map.getLayer("dim-mask"))
        map.setPaintProperty("dim-mask", "fill-opacity", bo);

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

  useEffect(() => {
    // Day map (bottom, not interactive)
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

    // Night map (top, interactive)
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
      });
    };

    nightMap.on("move", () => {
      if (syncingRef.current) return;
      syncCamera(nightMap, dayMap);
      emitReactThrottled();
    });

    dayMap.on("load", () => {
      // ensure it matches immediately
      syncCamera(nightMap, dayMap);
    });

    nightMap.on("style.load", async () => {
      await ensureNightLayers(nightMap);
      hidePlaceNames(nightMap);
      applyNightVisuals();
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { nightMap.remove(); } catch {}
      try { dayMap.remove(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update night visuals whenever values change
  useEffect(() => {
    applyNightVisuals();
  }, [lightsOpacity, blackoutOpacity]);

  const topOp = clamp01(asNumber(topOpacity, 0));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Bottom day map */}
      <div
        ref={dayRef}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      {/* Top night map (interactive) */}
      <div
        ref={nightRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: topOp,
          transition: "opacity 0ms", // controlled by tween in App; no CSS easing conflicts
        }}
      />
    </div>
  );
}