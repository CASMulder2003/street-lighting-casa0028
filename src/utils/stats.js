// src/utils/stats.js
// Pure geo utilities for fast, viewport-based stats (no external deps).

export const clamp01 = (x) => Math.max(0, Math.min(1, x));

const R = 6371000; // meters
const toRad = (d) => (d * Math.PI) / 180;

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

export function lineLengthMeters(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    sum += haversineMeters(aLng, aLat, bLng, bLat);
  }
  return sum;
}

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

// returns [minLng, minLat, maxLng, maxLat]
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

export function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// --- Stable-ish geometry hash for matching lit lines to road lines ---
function hashLineCoords(coords) {
  let s = "";
  for (let i = 0; i < coords.length; i++) {
    const lng = Math.round(coords[i][0] * 1e6) / 1e6;
    const lat = Math.round(coords[i][1] * 1e6) / 1e6;
    s += `${lng},${lat};`;
  }
  // djb2-ish
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

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

export function buildLitHashSet(litFeatureCollection) {
  const set = new Set();
  const feats = litFeatureCollection?.features || [];
  for (const f of feats) {
    const h = featureGeomHash(f);
    if (h) set.add(h);
  }
  return set;
}

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

export function computeViewportStatsFromRoads({
  boundsBBox, // [w,s,e,n]
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

    // if you ever bake lit directly into roads, this also works
    const litTagged = p?.lit === "yes" || (p?.__hash && litHashSet?.has(p.__hash));
    if (litTagged) litM += len;
  }

  if (totalM <= 0) return null;

  const litKm = litM / 1000;
  const totalKm = totalM / 1000;
  const pctLitOfRoads = Math.round((litM / totalM) * 100);

  return { litKm, totalKm, pctLitOfRoads };
}