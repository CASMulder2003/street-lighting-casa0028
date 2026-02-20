import BaseMap from "./maps/BaseMap.jsx";
import LightsOverlay from "./maps/LightsOverlay.jsx";

const STYLE_DAY = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function MapStack({
  view,
  onView,
  lightsOpacity,
  blackoutOpacity,
  darkMapOpacity,
  onStatus,
}) {
  return (
    <div className="absolute inset-0">
      {/* Day basemap */}
      <div className="absolute inset-0">
        <BaseMap
          view={view}
          styleUrl={STYLE_DAY}
          opacity={1}
          onStatus={onStatus}
        />
      </div>

      {/* Dark basemap (crossfade) */}
      <div className="absolute inset-0" style={{ opacity: darkMapOpacity, transition: "opacity 250ms linear" }}>
        <BaseMap
          view={view}
          styleUrl={STYLE_DARK}
          opacity={1}
          onStatus={onStatus}
        />
      </div>

      {/* Lights overlay (top, interactive) */}
      <div className="absolute inset-0">
        <LightsOverlay
          view={view}
          onView={onView}
          lightsOpacity={lightsOpacity}
          blackoutOpacity={blackoutOpacity}
          onStatus={onStatus}
        />
      </div>
    </div>
  );
}
