/*
 * Small overlay displaying derived lighting metrics
 * for the current map viewport.
 *
 * Shown only in "full map" night mode.
 * Receives precomputed stats from DualMapStack.
 *
 * Props:
 * - visible: controls whether the panel renders
 * - stats: { pctLitOfRoads, litKm, totalKm }
 */
export default function ViewportStats({ visible, stats }) {
  // Do not render anything if hidden or stats are not available
  if (!visible || !stats) return null;

  // Destructure computed values for readability
  const { pctLitOfRoads, litKm, totalKm } = stats;

  return (
    // Overlay in top-right corner of the map
    <div className="absolute right-4 top-20 z-50 rounded-2xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/80 backdrop-blur max-w-[220px]">
      
      {/* Section label */}
      <div className="text-white/60">In view (OSM tags)</div>

      {/* Percentage of mapped road length tagged as lit */}
      <div className="mt-1">
        <span className="font-semibold text-white">{pctLitOfRoads}%</span>{" "}
        of mapped roads tagged as lit
      </div>

      {/* Absolute lengths (km) for context */}
      <div className="mt-1 text-white/55">
        Lit: {litKm.toFixed(1)} km · Roads: {totalKm.toFixed(1)} km
      </div>

      {/* Data limitations note for transparency */}
      <div className="mt-1 text-[10px] leading-snug text-white/40">
        Based on volunteered OpenStreetMap lighting tags;
        mapping coverage may vary by area.
      </div>
    </div>
  );
}