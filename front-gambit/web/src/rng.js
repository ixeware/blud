export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Board world coordinates (tile = 4 units, board centered at origin, white home at +z)
export const TILE = 4;
export function sqToWorld(i) {
  const r = Math.floor(i / 8), c = i % 8;
  return { x: (c - 3.5) * TILE, z: (3.5 - r) * TILE };
}
export function worldToSq(x, z) {
  const c = Math.floor(x / TILE + 4), r = Math.floor(4 - z / TILE);
  if (r < 0 || r > 7 || c < 0 || c > 7) return -1;
  return r * 8 + c;
}
