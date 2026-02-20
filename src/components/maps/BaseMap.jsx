import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function BaseMap({ view, styleUrl, opacity = 1, onStatus = () => {} }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    // StrictMode-safe reset
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch {}
      mapRef.current = null;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      interactive: false, // IMPORTANT: basemaps follow the overlay
    });

    mapRef.current = map;

    map.once("load", () => {
      onStatus("Ready");
    });

    return () => {
      try { map.remove(); } catch {}
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  // Follow the overlay view
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
    });
  }, [view]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity }}
    />
  );
}
