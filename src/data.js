// Loads screens exported from the Figma file.
// In the normal build they are fetched from /public/proto. A single-file build can
// instead embed everything on window.__PROTO__ (screens) and window.__PROTO_ASSETS__ (images/icons).

const BASE = "proto/";
const cache = new Map();

export async function loadIndex() {
  if (window.__PROTO__) return window.__PROTO__.index;
  const res = await fetch(BASE + "index.json");
  if (!res.ok) throw new Error("Could not load prototype index");
  return res.json();
}

export function loadScreen(id) {
  if (window.__PROTO__) return Promise.resolve(window.__PROTO__.screens[id]);
  if (!cache.has(id)) {
    cache.set(
      id,
      fetch(`${BASE}screens/${id.replace(":", "-")}.json`).then((r) => {
        if (!r.ok) throw new Error("Missing screen " + id);
        return r.json();
      })
    );
  }
  return cache.get(id);
}

export function assetUrl(src) {
  return window.__PROTO_ASSETS__?.[src] ?? BASE + src;
}

// background-image values reference "img/<file>"; resolve them to real URLs
export function resolveCss(style) {
  if (!style.backgroundImage || !style.backgroundImage.includes("url(")) return style;
  return {
    ...style,
    backgroundImage: style.backgroundImage.replace(/url\(([^)]+)\)/g, (_, u) => `url("${assetUrl(u)}")`),
  };
}
