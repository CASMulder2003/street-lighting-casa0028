import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const asNumber = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export default function LightsOverlay({
  view,
  onView,
  lightsOpacity = 0,
  blackoutOpacity = 0,
  onStatus = () => {},
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const litDataRef = useRef(null);

  // throttle view sync to React so dragging stays smooth
  const rafRef = useRef(null);

  const safeSetPaint = (layerId, prop, value) => {
    const map = mapRef.current;
    try {
      if (!map) return;
      if (!readyRef.current) return;
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, prop, value);
    } catch {}
  };

  const addLights = async (map) => {
    // Blackout layer (covers basemaps below)
    if (!map.getLayer("blackout")) {
      map.addLayer({
        id: "blackout",
        type: "background",
        paint: {
          "background-color": "#000",
          "background-opacity": 0,
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

    if (!map.getSource("lit-roads")) {
      map.addSource("lit-roads", { type: "geojson", data: litDataRef.current });
    }

    const LIT_FILTER = ["==", ["get", "lit"], "yes"];

    const coreColor = "#FFF0C2";
    const glowColor = "#FF9C2A";
    const bloomColor = "#FF7A00";

    const add = (id, color, widthExpr, blur) => {
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

    add("lit-glow-3", bloomColor, ["interpolate", ["linear"], ["zoom"], 10, 6, 14, 14, 17, 30], 14);
    add("lit-glow-2", glowColor,  ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 10, 17, 22], 10);
    add("lit-glow-1", glowColor,  ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 6, 17, 14], 5);
    add("lit-core",   coreColor,  ["interpolate", ["linear"], ["zoom"], 10, 1.0, 14, 2.2, 17, 5], 0.8);

    readyRef.current = true;
    onStatus("Ready");
    return true;
  };

  useEffect(() => {
    // StrictMode-safe rebuild
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch {}
      mapRef.current = null;
      readyRef.current = false;
    }

    onStatus("Creating overlay…");

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] }, // transparent overlay
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: true,
      dragPan: true,
      scrollZoom: true,
      dragRotate: true,
      touchZoomRotate: true,
      attributionControl: false,
    });

    mapRef.current = map;

    map.once("load", async () => {
      const ok = await addLights(map);
      if (!ok) return;

      // initial paint
      safeSetPaint("blackout", "background-opacity", clamp01(asNumber(blackoutOpacity, 0)));
      const lo = clamp01(asNumber(lightsOpacity, 0));
      safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
      safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
      safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
      safeSetPaint("lit-core",   "line-opacity", lo * 0.95);
    });

    // IMPORTANT: only emit view OUTWARD; do NOT jumpTo based on view props
    const emitThrottled = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const c = map.getCenter();
        onView({
          lng: c.lng,
          lat: c.lat,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
      });
    };

    map.on("move", emitThrottled);

    return () => {
      try {
        map.off("move", emitThrottled);
        map.remove();
      } catch {}
      mapRef.current = null;
      readyRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update blackout + lights ONLY (no camera updates here)
  useEffect(() => {
    safeSetPaint("blackout", "background-opacity", clamp01(asNumber(blackoutOpacity, 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blackoutOpacity]);

  useEffect(() => {
    const lo = clamp01(asNumber(lightsOpacity, 0));
    safeSetPaint("lit-glow-3", "line-opacity", lo * 0.18);
    safeSetPaint("lit-glow-2", "line-opacity", lo * 0.30);
    safeSetPaint("lit-glow-1", "line-opacity", lo * 0.45);
    safeSetPaint("lit-core",   "line-opacity", lo * 0.95);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightsOpacity]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
