// Paths and caches for generated pixel-art assets.
const cache = new Map();
export const A = {
  icon: (id) => `assets/icons/${id}.png`,
  ab: (id) => `assets/ab/${id}.png`,
  unit: (t) => `assets/icons/unit_${t}.png`,
  por: (t) => `assets/por/${t}.png`,
  card: (id) => `assets/cards/${id}.png`,
  ev: (id) => `assets/ev/${id}.png`,
  bg: (id) => `assets/bg/${id}.png`,
};

export function img(src) {
  if (!cache.has(src)) {
    const im = new Image();
    im.src = src;
    cache.set(src, im);
  }
  return cache.get(src);
}

export function preload(list) {
  return Promise.all(list.map((src) => new Promise((res) => {
    const im = img(src);
    if (im.complete) res(); else { im.onload = res; im.onerror = res; }
  })));
}

export const ico = (src, cls = '') => `<img class="px ${cls}" src="${src}" alt="">`;
