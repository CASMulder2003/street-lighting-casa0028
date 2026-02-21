// src/components/ViewportStats.jsx

export default function ViewportStats({ visible, stats }) {
  if (!visible || !stats) return null;

  const { pctLitOfRoads, litKm, totalKm } = stats;

  return (
    <div className="absolute right-4 top-20 z-50 rounded-2xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white/80 backdrop-blur max-w-[220px]">
      <div className="text-white/60">In view (OSM tags)</div>

      <div className="mt-1">
        <span className="font-semibold text-white">{pctLitOfRoads}%</span>{" "}
        of mapped roads tagged as lit
      </div>

      <div className="mt-1 text-white/55">
        Lit: {litKm.toFixed(1)} km · Roads: {totalKm.toFixed(1)} km
      </div>

      <div className="mt-1 text-[10px] leading-snug text-white/40">
        Based on volunteered OpenStreetMap lighting tags;
        mapping coverage may vary by area.
      </div>
    </div>
  );
}