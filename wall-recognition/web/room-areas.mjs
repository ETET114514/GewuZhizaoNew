// Regions are the effective floor polygons: solid walls have already been removed.
// Each polygon is [outer ring, ...holes]; a merged room may have several polygons.
function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3 || ring.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return null;
  const [ox, oy] = ring[0];
  let twiceArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    twiceArea += (a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy);
  }
  return Math.abs(twiceArea) / 2;
}

export function roomAreaM2(room, scaleMmPerPx) {
  if (!Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) return null;
  const polygons = room?.polygons_px ?? (room?.rings_px ? [room.rings_px] : []);
  if (!Array.isArray(polygons) || !polygons.length) return null;
  let area = 0;
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !rings.length) return null;
    const areas = rings.map(ringArea);
    if (areas.some(a => a === null || !Number.isFinite(a) || a <= 0)) return null;
    const part = areas[0] - areas.slice(1).reduce((sum, a) => sum + a, 0);
    if (part <= 0) return null;
    area += part;
  }
  const result = area * (scaleMmPerPx / 1000) ** 2;
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function formatRoomArea(area) {
  if (!Number.isFinite(area) || area <= 0) return '—';
  return area < 0.01 ? '<0.01 m²' : `${area.toFixed(2)} m²`;
}
