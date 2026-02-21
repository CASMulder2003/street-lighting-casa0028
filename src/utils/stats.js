// As I wasn't fully sure how to do a lot of the math, 
// I used ChatGPT to help me compute here

// Clamp a number into the range 0–1 (useful for animation/opacity values).
export const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Earth radius in meters (used for distance calculations).
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

// Distance (meters) between two lon/lat points using the Haversine formula.
// This is an approximation, but accurate enough for line-length totals here.
export function haversineMeters(aLng, aLat, bLng, bLat) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Total length (meters) of a LineString coordinate array.
export function lineLengthMeters(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    sum += haversineMeters(aLng, aLat, bLng, bLat);
  }
  return sum;
}

// Total length (meters) of a GeoJSON LineString or MultiLineString geometry.
export function geomLengthMeters(geom) {
  if (!geom) return 0;
  if (geom.type === "LineString") return lineLengthMeters(geom.coordinates);
  if (geom.type === "MultiLineString") {
    let sum = 0;
    for (const part of geom.coordinates) sum += lineLengthMeters(part);
    return sum;
  }
  return 0;
}

// Bounding box for a LineString or MultiLineString.
// Returns [minLng, minLat, maxLng, maxLat] (or null if unsupported).
export function geomBBox(geom) {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;

  const consume = (pt) => {
    const lng = pt[0];
    const lat = pt[1];
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  if (!geom) return null;

  if (geom.type === "LineString") {
    for (const pt of geom.coordinates) consume(pt);
  } else if (geom.type === "MultiLineString") {
    for (const line of geom.coordinates) for (const pt of line) consume(pt);
  } else {
    return null;
  }

  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

// Quick bbox overlap test.
// Used to filter features before doing any heavier checks.
export function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// --- Geometry hashing (used to match a road segment to a lit segment) ---
// We create a short hash from the coordinates (rounded to reduce float noise).

function hashLineCoords(coords) {
  let s = "";
  for (let i = 0; i < coords.length; i++) {
    const lng = Math.round(coords[i][0] * 1e6) / 1e6;
    const lat = Math.round(coords[i][1] * 1e6) / 1e6;
    s += `${lng},${lat};`;
  }

  // Simple string hash (fast; good enough for matching here)
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// Returns a stable-ish hash for LineString/MultiLineString features (or null).
export function featureGeomHash(feature) {
  const g = feature?.geometry;
  if (!g) return null;

  if (g.type === "LineString") return `L:${hashLineCoords(g.coordinates)}`;

  if (g.type === "MultiLineString") {
    let combined = "M:";
    for (const part of g.coordinates) combined += hashLineCoords(part) + "|";
    let h = 5381;
    for (let i = 0; i < combined.length; i++)
      h = ((h << 5) + h) ^ combined.charCodeAt(i);
    return `M:${(h >>> 0).toString(16)}`;
  }

  return null;
}

// Build a Set of hashes for lit features so we can do fast lookups.
export function buildLitHashSet(litFeatureCollection) {
  const set = new Set();
  const feats = litFeatureCollection?.features || [];
  for (const f of feats) {
    const h = featureGeomHash(f);
    if (h) set.add(h);
  }
  return set;
}

// Add precomputed values onto each road feature:
// - __bbox: bounding box
// - __len_m: length in meters
// - __hash: geometry hash
// This makes per-move stats much faster.
export function annotateRoadFeatures(roadsFeatureCollection) {
  const feats = roadsFeatureCollection?.features || [];
  for (const f of feats) {
    if (!f?.geometry) continue;
    if (!f.properties) f.properties = {};
    f.properties.__bbox = geomBBox(f.geometry);
    f.properties.__len_m = geomLengthMeters(f.geometry);
    f.properties.__hash = featureGeomHash(f);
  }
}

// Main stats function used by the UI overlay.
// It totals road length in the current bbox, and counts how much of it is lit.
export function computeViewportStatsFromRoads({
  boundsBBox, // [west, south, east, north]
  roadsFeatureCollection,
  litHashSet,
}) {
  const feats = roadsFeatureCollection?.features || [];
  if (!feats.length) return null;

  let totalM = 0;
  let litM = 0;

  for (const f of feats) {
    const p = f?.properties;
    const bb = p?.__bbox;
    const len = p?.__len_m;

    if (!bb || !Number.isFinite(len) || len <= 0) continue;
    if (!bboxIntersects(bb, boundsBBox)) continue;

    totalM += len;

    // Treat a road as lit if:
    // - it already has lit=yes on the road feature, OR
    // - its geometry hash exists in the lit dataset Set
    const litTagged =
      p?.lit === "yes" || (p?.__hash && litHashSet?.has(p.__hash));
    if (litTagged) litM += len;
  }

  if (totalM <= 0) return null;

  const litKm = litM / 1000;
  const totalKm = totalM / 1000;
  const pctLitOfRoads = Math.round((litM / totalM) * 100);

  return { litKm, totalKm, pctLitOfRoads };
}