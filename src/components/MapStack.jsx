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
      {/* Basemaps must NOT intercept gestures */}
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        <BaseMap view={view} styleUrl={STYLE_DAY} onStatus={onStatus} />
      </div>

      <div
        className="absolute inset-0"
        style={{
          opacity: darkMapOpacity,
          transition: "opacity 250ms linear",
          pointerEvents: "none",
        }}
      >
        <BaseMap view={view} styleUrl={STYLE_DARK} onStatus={onStatus} />
      </div>

      {/* Overlay receives gestures */}
      <div className="absolute inset-0" style={{ pointerEvents: "auto" }}>
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
