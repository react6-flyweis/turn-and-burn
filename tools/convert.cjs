// Converts the decoded .fig document into JSON screen trees + SVG/image assets for the React prototype player.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { msg } = require("./decode.cjs");

const OUT = process.argv[2] || "public/proto";
const IMG_SRC = process.env.FIG_IMAGES || "figma-export/images";
fs.mkdirSync(path.join(OUT, "screens"), { recursive: true });
fs.mkdirSync(path.join(OUT, "svg"), { recursive: true });
fs.mkdirSync(path.join(OUT, "img"), { recursive: true });

const gid = (x) => x.sessionID + ":" + x.localID;
const nodes = new Map();
const kids = new Map();
for (const n of msg.nodeChanges) {
  nodes.set(gid(n.guid), n);
  if (n.parentIndex) {
    const p = gid(n.parentIndex.guid);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
}
for (const arr of kids.values()) arr.sort((a, b) => (a.parentIndex.position < b.parentIndex.position ? -1 : 1));
const blobs = msg.blobs.map((b) => Buffer.from(b.bytes));
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------- helpers ----------
function pathOf(i) {
  const b = blobs[i];
  if (!b) return "";
  let o = 0;
  const out = [];
  const f = () => {
    const v = b.readFloatLE(o);
    o += 4;
    return r3(v);
  };
  while (o < b.length) {
    const c = b[o++];
    if (c === 0) out.push("Z");
    else if (c === 1) out.push("M" + f() + " " + f());
    else if (c === 2) out.push("L" + f() + " " + f());
    else if (c === 3) out.push("Q" + [f(), f(), f(), f()].join(" "));
    else if (c === 4) out.push("C" + [f(), f(), f(), f(), f(), f()].join(" "));
    else break;
  }
  return out.join("");
}
const rgba = (c, op = 1) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${r3((c.a ?? 1) * op)})`;
const vis = (arr) => (arr || []).filter((p) => p.visible !== false);
const hashHex = (h) => Buffer.from(h.data || h).toString("hex");

const usedImages = new Map(); // hash -> filename
function imageUrl(paint) {
  const h = hashHex(paint.image.hash);
  if (!usedImages.has(h)) {
    const src = path.join(IMG_SRC, h);
    if (!fs.existsSync(src)) return null;
    const head = fs.readFileSync(src).subarray(0, 4);
    const ext = head[0] === 0x89 ? "png" : head[0] === 0xff ? "jpg" : head[0] === 0x47 ? "gif" : "bin";
    usedImages.set(h, `${h}.${ext}`);
  }
  return "img/" + usedImages.get(h);
}

const svgFiles = new Map();
function saveSvg(content) {
  const h = crypto.createHash("sha1").update(content).digest("hex").slice(0, 16);
  if (!svgFiles.has(h)) {
    svgFiles.set(h, true);
    fs.writeFileSync(path.join(OUT, "svg", h + ".svg"), content);
  }
  return "svg/" + h + ".svg";
}

// ---------- override scopes ----------
// scope: Map<string path relative to current symbol, override object>
function own(scope, n) {
  const o = scope && scope.get(gid(n.guid));
  return o ? { ...n, ...o } : n;
}
function enterInstance(scope, inst, eff) {
  const next = new Map();
  const add = (list) => {
    for (const o of list || []) {
      const ids = o.guidPath?.guids;
      if (!ids?.length) continue;
      const k = ids.map(gid).join("/");
      const { guidPath, ...rest } = o;
      next.set(k, { ...(next.get(k) || {}), ...rest });
    }
  };
  add(eff.symbolData?.symbolOverrides);
  add(eff.derivedSymbolData);
  if (scope) {
    const pre = gid(inst.guid) + "/";
    for (const [k, v] of scope) if (k.startsWith(pre)) next.set(k.slice(pre.length), { ...(next.get(k.slice(pre.length)) || {}), ...v });
  }
  return next;
}
function symbolOf(eff) {
  const id = eff.overriddenSymbolID || eff.symbolData?.symbolID;
  return id ? nodes.get(gid(id)) : null;
}
function childrenOf(eff) {
  if (eff.type === "INSTANCE") {
    const s = symbolOf(eff);
    return s ? kids.get(gid(s.guid)) || [] : [];
  }
  return kids.get(gid(eff.guid)) || [];
}
function childScope(scope, n, eff) {
  return eff.type === "INSTANCE" ? enterInstance(scope, n, eff) : scope;
}

// ---------- SVG rendering of vector-only subtrees ----------
const SHAPES = new Set(["VECTOR", "STAR", "LINE", "REGULAR_POLYGON", "BOOLEAN_OPERATION", "ELLIPSE", "ROUNDED_RECTANGLE", "RECTANGLE", "BRUSH"]);
function rectPath(w, h, rad) {
  const r = Math.min(rad || 0, w / 2, h / 2);
  if (!r) return `M0 0H${r3(w)}V${r3(h)}H0Z`;
  return `M${r} 0H${r3(w - r)}A${r} ${r} 0 0 1 ${r3(w)} ${r}V${r3(h - r)}A${r} ${r} 0 0 1 ${r3(w - r)} ${r3(h)}H${r}A${r} ${r} 0 0 1 0 ${r3(h - r)}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}
let svgUid = 0;
function svgPaint(p, defs, w, h) {
  if (p.type === "SOLID") return rgba(p.color, p.opacity ?? 1);
  if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL") {
    const id = "g" + svgUid++;
    const t = p.transform;
    const inv = invert(t);
    const stops = (p.stops || []).map((s) => `<stop offset="${r3(s.position)}" stop-color="${rgba(s.color, p.opacity ?? 1)}"/>`).join("");
    if (p.type === "GRADIENT_LINEAR") {
      const a = apply(inv, 0, 0.5), b = apply(inv, 1, 0.5);
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r3(a[0] * w)}" y1="${r3(a[1] * h)}" x2="${r3(b[0] * w)}" y2="${r3(b[1] * h)}">${stops}</linearGradient>`);
    } else {
      const c = apply(inv, 0.5, 0.5), e = apply(inv, 1, 0.5);
      const rr = Math.hypot((e[0] - c[0]) * w, (e[1] - c[1]) * h);
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r3(c[0] * w)}" cy="${r3(c[1] * h)}" r="${r3(rr)}">${stops}</radialGradient>`);
    }
    return `url(#${id})`;
  }
  return null;
}
function invert(t) {
  if (!t) return { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const det = t.m00 * t.m11 - t.m01 * t.m10 || 1;
  return {
    m00: t.m11 / det, m01: -t.m01 / det, m02: (t.m01 * t.m12 - t.m11 * t.m02) / det,
    m10: -t.m10 / det, m11: t.m00 / det, m12: (t.m10 * t.m02 - t.m00 * t.m12) / det,
  };
}
const apply = (t, x, y) => [t.m00 * x + t.m01 * y + t.m02, t.m10 * x + t.m11 * y + t.m12];

function svgNode(n, scope, defs, isRoot) {
  const e = own(scope, n);
  if (e.visible === false || e.mask) return "";
  const w = e.size?.x || 0, h = e.size?.y || 0;
  let body = "";
  let fg = (e.fillGeometry || []).map((x) => ({ d: pathOf(x.commandsBlob), rule: x.windingRule }));
  if (!fg.length && ["FRAME", "INSTANCE", "SYMBOL", "RECTANGLE", "ROUNDED_RECTANGLE"].includes(e.type)) fg = [{ d: rectPath(w, h, e.cornerRadius), rule: "NONZERO" }];
  if (!fg.length && e.type === "ELLIPSE") fg = [{ d: `M${w / 2} 0A${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h}A${w / 2} ${h / 2} 0 1 1 ${w / 2} 0Z`, rule: "NONZERO" }];
  let fills = vis(e.fillPaints);
  if (e.type === "INSTANCE" && !e.fillPaints) fills = vis(symbolOf(e)?.fillPaints);
  for (const p of fills) {
    const paint = svgPaint(p, defs, w, h);
    if (!paint) continue;
    for (const x of fg) body += `<path d="${x.d}" fill="${paint}"${x.rule === "ODD" ? ' fill-rule="evenodd"' : ""}/>`;
  }
  if (e.strokeGeometry?.length && (e.strokeWeight ?? 1) > 0)
    for (const p of vis(e.strokePaints)) {
      const paint = svgPaint(p, defs, w, h);
      if (!paint) continue;
      for (const x of e.strokeGeometry) body += `<path d="${pathOf(x.commandsBlob)}" fill="${paint}"/>`;
    }
  let inner = "";
  if (e.type !== "BOOLEAN_OPERATION") {
    const cs = childScope(scope, n, e);
    for (const c of childrenOf(e)) inner += svgNode(c, cs, defs, false);
  }
  if (inner && ["FRAME", "INSTANCE", "SYMBOL"].includes(e.type) && e.frameMaskDisabled === false && !e.resizeToFit && !isRoot) {
    const id = "c" + svgUid++;
    defs.push(`<clipPath id="${id}"><path d="${rectPath(w, h, e.cornerRadius)}"/></clipPath>`);
    inner = `<g clip-path="url(#${id})">${inner}</g>`;
  }
  let all = body + inner;
  const sh = vis(e.effects).filter((x) => x.type === "DROP_SHADOW");
  if (sh.length && all) {
    const id = "f" + svgUid++;
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${sh.map((x) => `<feDropShadow dx="${r3(x.offset.x)}" dy="${r3(x.offset.y)}" stdDeviation="${r3(x.radius / 2)}" flood-color="${rgba(x.color)}"/>`).join("")}</filter>`);
    all = `<g filter="url(#${id})">${all}</g>`;
  }
  if (!all) return "";
  const t = e.transform;
  const tr = isRoot ? "" : ` transform="matrix(${[t.m00, t.m10, t.m01, t.m11, t.m02, t.m12].map(r3).join(" ")})"`;
  const op = (e.opacity ?? 1) < 1 ? ` opacity="${r3(e.opacity)}"` : "";
  return `<g${tr}${op}>${all}</g>`;
}

// how far drawing can spill outside the box (shadows, outside strokes)
function spill(n, scope, depth = 0) {
  const e = own(scope, n);
  if (e.visible === false || depth > 30) return 0;
  let m = 0;
  for (const x of vis(e.effects)) if (x.type === "DROP_SHADOW") m = Math.max(m, x.radius * 1.5 + Math.max(Math.abs(x.offset.x), Math.abs(x.offset.y)) + (x.spread || 0));
  if (vis(e.strokePaints).length) m = Math.max(m, e.strokeWeight || 0);
  const cs = childScope(scope, n, e);
  for (const c of childrenOf(e)) {
    const ce = own(cs, c);
    const t = ce.transform;
    let out = 0;
    if (t && ce.size) {
      out = Math.max(0, -t.m02, -t.m12, t.m02 + ce.size.x - (e.size?.x || 0), t.m12 + ce.size.y - (e.size?.y || 0));
    }
    const inner = spill(c, cs, depth + 1);
    if (e.frameMaskDisabled === false && !e.resizeToFit && ["FRAME", "INSTANCE", "SYMBOL"].includes(e.type)) continue;
    m = Math.max(m, inner + out);
  }
  return m;
}
function svgDoc(inner, defs, w, h, P) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(w + 2 * P)}" height="${r3(h + 2 * P)}" viewBox="${-P} ${-P} ${r3(w + 2 * P || 0.01)} ${r3(h + 2 * P || 0.01)}" fill="none">${defs.length ? "<defs>" + defs.join("") + "</defs>" : ""}${inner}</svg>`;
}

// Is a subtree purely vector graphics (no text, images, interactions)? Then it becomes one SVG.
const pureCache = new Map();
function isPureVector(n, scope, depth = 0) {
  const e = own(scope, n);
  if (e.visible === false) return true;
  if (e.type === "TEXT") return false;
  if (e.prototypeInteractions?.length && depth > 0) return false;
  if (vis(e.fillPaints).some((p) => p.type === "IMAGE")) return false;
  if (vis(e.effects).some((x) => x.type === "BACKGROUND_BLUR" || x.type === "FOREGROUND_BLUR")) return false;
  if (e.type === "INSTANCE") {
    const s = symbolOf(e);
    if (!s) return true;
    if (s.prototypeInteractions?.length) return false;
  }
  const cs = childScope(scope, n, e);
  for (const c of childrenOf(e)) if (!isPureVector(c, cs, depth + 1)) return false;
  return true;
}
function hasVector(n, scope) {
  const e = own(scope, n);
  if (e.visible === false) return false;
  if (["VECTOR", "STAR", "LINE", "REGULAR_POLYGON", "BOOLEAN_OPERATION", "BRUSH"].includes(e.type)) return true;
  const cs = childScope(scope, n, e);
  return childrenOf(e).some((c) => hasVector(c, cs));
}

// ---------- CSS for boxes ----------
function cornerCss(e, s) {
  if (e.type === "ELLIPSE") return void (s.borderRadius = "50%");
  if (e.rectangleCornerRadiiIndependent) {
    const v = [e.rectangleTopLeftCornerRadius, e.rectangleTopRightCornerRadius, e.rectangleBottomRightCornerRadius, e.rectangleBottomLeftCornerRadius].map((x) => r3(x || 0));
    if (v.some(Boolean)) s.borderRadius = v.map((x) => x + "px").join(" ");
  } else if (e.cornerRadius) s.borderRadius = r3(e.cornerRadius) + "px";
}
function gradientCss(p, w, h) {
  const inv = invert(p.transform);
  const stops = (p.stops || []);
  if (p.type === "GRADIENT_RADIAL") {
    const c = apply(inv, 0.5, 0.5);
    return `radial-gradient(ellipse at ${r3(c[0] * 100)}% ${r3(c[1] * 100)}%, ${stops.map((s) => `${rgba(s.color, p.opacity ?? 1)} ${r3(s.position * 100)}%`).join(", ")})`;
  }
  const a = apply(inv, 0, 0.5), b = apply(inv, 1, 0.5);
  const ax = a[0] * w, ay = a[1] * h, bx = b[0] * w, by = b[1] * h;
  const dx = bx - ax, dy = by - ay;
  const ang = Math.atan2(dx, -dy);
  const L = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang)) || 1;
  const dir = [Math.sin(ang), -Math.cos(ang)];
  const cx = w / 2, cy = h / 2;
  const pos = (t) => {
    const px = ax + dx * t, py = ay + dy * t;
    return ((px - cx) * dir[0] + (py - cy) * dir[1]) / L + 0.5;
  };
  return `linear-gradient(${r3((ang * 180) / Math.PI)}deg, ${stops.map((s) => `${rgba(s.color, p.opacity ?? 1)} ${r3(pos(s.position) * 100)}%`).join(", ")})`;
}
function boxCss(e, s, w, h) {
  const fills = vis(e.fillPaints);
  const layers = [];
  for (const p of fills.slice().reverse()) {
    if (p.type === "SOLID") layers.push({ img: `linear-gradient(${rgba(p.color, p.opacity ?? 1)},${rgba(p.color, p.opacity ?? 1)})`, solid: rgba(p.color, p.opacity ?? 1) });
    else if (p.type.startsWith("GRADIENT")) layers.push({ img: gradientCss(p, w, h) });
    else if (p.type === "IMAGE") {
      const url = imageUrl(p);
      if (!url) continue;
      const L = { img: `url(${url})`, op: p.opacity ?? 1 };
      if (p.imageScaleMode === "FIT") Object.assign(L, { size: "contain", pos: "center" });
      else if (p.imageScaleMode === "STRETCH" && p.transform) {
        const t = p.transform;
        L.size = `${r3(w / t.m00)}px ${r3(h / t.m11)}px`;
        L.pos = `${r3((-t.m02 / t.m00) * w)}px ${r3((-t.m12 / t.m11) * h)}px`;
      } else if (p.imageScaleMode === "TILE") Object.assign(L, { size: "auto", repeat: "repeat" });
      else Object.assign(L, { size: "cover", pos: "center" });
      layers.push(L);
    }
  }
  if (layers.length === 1 && layers[0].solid) {
    s.background = layers[0].solid;
  } else if (layers.length) {
    // single image with opacity < 1 is handled by an extra layer element in the player
    s.backgroundImage = layers.map((l) => l.img).join(", ");
    s.backgroundSize = layers.map((l) => l.size || "100% 100%").join(", ");
    s.backgroundPosition = layers.map((l) => l.pos || "0 0").join(", ");
    s.backgroundRepeat = layers.map((l) => l.repeat || "no-repeat").join(", ");
  }
  cornerCss(e, s);
  const shadows = [];
  const strokes = vis(e.strokePaints).filter((p) => p.type === "SOLID");
  if (strokes.length && (e.strokeWeight || e.borderStrokeWeightsIndependent)) {
    const c = rgba(strokes[0].color, strokes[0].opacity ?? 1);
    if (e.borderStrokeWeightsIndependent) {
      const [t, r, b, l] = [e.borderTopWeight, e.borderRightWeight, e.borderBottomWeight, e.borderLeftWeight].map((x) => r3(x || 0));
      if (t) shadows.push(`inset 0 ${t}px 0 0 ${c}`);
      if (b) shadows.push(`inset 0 -${b}px 0 0 ${c}`);
      if (l) shadows.push(`inset ${l}px 0 0 0 ${c}`);
      if (r) shadows.push(`inset -${r}px 0 0 0 ${c}`);
    } else {
      const sw = r3(e.strokeWeight);
      if (e.strokeAlign === "OUTSIDE") shadows.push(`0 0 0 ${sw}px ${c}`);
      else if (e.strokeAlign === "CENTER") shadows.push(`inset 0 0 0 ${r3(sw / 2)}px ${c}`, `0 0 0 ${r3(sw / 2)}px ${c}`);
      else shadows.push(`inset 0 0 0 ${sw}px ${c}`);
      if (e.dashPattern?.length) {
        shadows.length = 0;
        s.outline = `${sw}px dashed ${c}`;
        s.outlineOffset = `-${sw}px`;
      }
    }
  }
  for (const x of vis(e.effects)) {
    if (x.type === "DROP_SHADOW") shadows.push(`${r3(x.offset.x)}px ${r3(x.offset.y)}px ${r3(x.radius)}px ${r3(x.spread || 0)}px ${rgba(x.color)}`);
    else if (x.type === "INNER_SHADOW") shadows.push(`inset ${r3(x.offset.x)}px ${r3(x.offset.y)}px ${r3(x.radius)}px ${r3(x.spread || 0)}px ${rgba(x.color)}`);
    else if (x.type === "BACKGROUND_BLUR") s.backdropFilter = `blur(${r3(x.radius / 2)}px)`;
    else if (x.type === "FOREGROUND_BLUR") s.filter = `blur(${r3(x.radius / 2)}px)`;
  }
  if (shadows.length) s.boxShadow = shadows.join(", ");
}

// ---------- text ----------
const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
const fontsUsed = new Set();
function fontCss(st, o) {
  const fam = st.fontName?.family;
  if (fam) {
    const style = (st.fontName.style || "Regular").toLowerCase().replace(/[\s-]/g, "");
    const italic = style.includes("italic");
    const wkey = style.replace("italic", "") || "regular";
    o.fontFamily = `"${fam}"`;
    o.fontWeight = WEIGHTS[wkey] || 400;
    if (italic) o.fontStyle = "italic";
    fontsUsed.add(fam + "|" + o.fontWeight + (italic ? "i" : ""));
  }
  if (st.fontSize) o.fontSize = r3(st.fontSize) + "px";
  const lh = st.lineHeight;
  if (lh && st.fontSize) {
    if (lh.units === "PIXELS") o.lineHeight = r3(lh.value) + "px";
    else if (lh.units === "PERCENT") o.lineHeight = lh.value === 100 ? "normal" : r3((lh.value / 100) * st.fontSize) + "px";
    else if (lh.units === "RAW") o.lineHeight = r3(lh.value * st.fontSize) + "px";
  }
  const ls = st.letterSpacing;
  if (ls && ls.value) o.letterSpacing = ls.units === "PERCENT" ? r3(ls.value / 100) + "em" : r3(ls.value) + "px";
  const dec = st.textDecoration;
  if (dec === "UNDERLINE") o.textDecoration = "underline";
  else if (dec === "STRIKETHROUGH") o.textDecoration = "line-through";
  const tc = st.textCase;
  if (tc === "UPPER") o.textTransform = "uppercase";
  else if (tc === "LOWER") o.textTransform = "lowercase";
  else if (tc === "TITLE") o.textTransform = "capitalize";
  const f = vis(st.fillPaints)[0];
  if (f?.type === "SOLID") o.color = rgba(f.color, f.opacity ?? 1);
  else if (f?.type?.startsWith("GRADIENT")) o.color = rgba(f.stops?.[0]?.color || { r: 0, g: 0, b: 0 });
  return o;
}
function textNode(e, base) {
  const td = e.textData || {};
  const chars = td.characters ?? "";
  const s = fontCss(e, {});
  const al = e.textAlignHorizontal;
  s.textAlign = al === "CENTER" ? "center" : al === "RIGHT" ? "right" : al === "JUSTIFIED" ? "justify" : "left";
  const va = e.textAlignVertical;
  s.justifyContent = va === "CENTER" ? "center" : va === "BOTTOM" ? "flex-end" : "flex-start";
  if (e.textAutoResize === "WIDTH_AND_HEIGHT") s.whiteSpace = "pre";
  else s.whiteSpace = "pre-wrap";
  if (e.textTruncation === "ENDING") {
    s.overflow = "hidden";
    if ((e.maxLines || 1) <= 1) Object.assign(s, { whiteSpace: "nowrap", textOverflow: "ellipsis" });
  }
  if (e.fontFeatures) {}
  // runs
  const ids = td.characterStyleIDs || [];
  const table = new Map((td.styleOverrideTable || []).map((x) => [x.styleID, x]));
  let runs = null;
  if (ids.length && table.size) {
    runs = [];
    const arr = [...chars];
    let cur = null, buf = "";
    for (let i = 0; i < arr.length; i++) {
      const sid = ids[i] ?? 0;
      if (sid !== cur) {
        if (buf) runs.push([buf, cur]);
        buf = "";
        cur = sid;
      }
      buf += arr[i];
    }
    if (buf) runs.push([buf, cur]);
    runs = runs.map(([t, sid]) => {
      const st = sid && table.get(sid);
      return st ? [t, fontCss(st, {})] : [t];
    });
    if (runs.length === 1 && runs[0].length === 1) runs = null;
  }
  return { ...base, k: "t", s: { ...base.s, ...s }, tx: runs ? undefined : chars, r: runs || undefined };
}

// ---------- interactions ----------
const screenTargets = new Set();
function mapInteractions(list) {
  const out = [];
  for (const it of list || []) {
    if (it.isDeleted) continue;
    const ev = it.event?.interactionType;
    if (!ev) continue;
    const acts = [];
    for (const a of it.actions || []) {
      const nav = a.navigationType, con = a.connectionType;
      const to = a.transitionNodeID && a.transitionNodeID.sessionID !== 4294967295 ? gid(a.transitionNodeID) : null;
      if (con === "BACK") acts.push({ a: "back" });
      else if (con === "CLOSE" && nav !== "NAVIGATE" && nav !== "OVERLAY") acts.push({ a: "close" });
      else if (nav === "NAVIGATE" && to) { acts.push({ a: con === "CLOSE" ? "closeNav" : "nav", to }); screenTargets.add(to); }
      else if (nav === "OVERLAY" && to) {
        const x = { a: "overlay", to };
        if (a.overlayRelativePosition) x.p = [r3(a.overlayRelativePosition.x), r3(a.overlayRelativePosition.y)];
        acts.push(x);
        screenTargets.add(to);
      } else if (nav === "SWAP" && to) { acts.push({ a: "swap", to }); screenTargets.add(to); }
      else if (nav === "SWAP_STATE" && to) acts.push({ a: "state", to });
      else if (nav === "SCROLL_TO" && to) acts.push({ a: "scroll", to });
      else if (con === "URL" && a.connectionURL) acts.push({ a: "url", url: a.connectionURL });
    }
    if (!acts.length) continue;
    const x = { e: ev, x: acts };
    if (ev === "AFTER_TIMEOUT") x.ms = Math.round((it.event.transitionTimeout || 0.8) * 1000);
    out.push(x);
  }
  return out.length ? out : undefined;
}

// variants reachable by SWAP_STATE from a symbol (same component set)
function setOf(sym) {
  return sym?.parentIndex ? gid(sym.parentIndex.guid) : null;
}
function collectStateTargets(n, scope, acc, depth = 0) {
  if (depth > 40) return;
  const e = own(scope, n);
  for (const it of e.prototypeInteractions || []) for (const a of it.actions || []) if (a.navigationType === "SWAP_STATE" && a.transitionNodeID) acc.add(gid(a.transitionNodeID));
  const cs = childScope(scope, n, e);
  for (const c of childrenOf(e)) {
    const ce = own(cs, c);
    if (ce.type === "INSTANCE") {
      for (const it of ce.prototypeInteractions || []) for (const a of it.actions || []) if (a.navigationType === "SWAP_STATE" && a.transitionNodeID) acc.add(gid(a.transitionNodeID));
      continue; // nested instances manage their own states
    }
    collectStateTargets(c, cs, acc, depth + 1);
  }
}

// ---------- main conversion ----------
let nodeCount = 0;
function convert(n, scope, depth, isRoot, idPath) {
  const e = own(scope, n);
  if (e.visible === false) return null;
  if (e.mask) return null;
  if (!e.size) return null;
  nodeCount++;
  const w = e.size.x, h = e.size.y;
  const t = e.transform || { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const s = {};
  const base = { id: idPath, w: r3(w), h: r3(h), s };
  if (!isRoot) {
    if (t.m00 === 1 && t.m01 === 0 && t.m10 === 0 && t.m11 === 1) { base.x = r3(t.m02); base.y = r3(t.m12); }
    else base.m = [t.m00, t.m10, t.m01, t.m11, t.m02, t.m12].map(r3);
  }
  if ((e.opacity ?? 1) < 1) s.opacity = r3(e.opacity);
  if (e.blendMode && !["PASS_THROUGH", "NORMAL"].includes(e.blendMode)) s.mixBlendMode = e.blendMode.toLowerCase().replace("_", "-");
  const ia = mapInteractions(e.type === "INSTANCE" && !e.prototypeInteractions ? symbolOf(e)?.prototypeInteractions : e.prototypeInteractions);
  if (ia) base.ia = ia;

  if (e.type === "TEXT") return textNode(e, base);

  // pure vector subtree -> svg file
  if (!ia && !isRoot && (SHAPES.has(e.type) || ((e.type === "FRAME" || e.type === "INSTANCE" || e.type === "SYMBOL") && hasVector(n, scope))) && isPureVector(n, scope)) {
    const defs = [];
    svgUid = 0;
    const inner = svgNode(n, scope, defs, true);
    if (!inner) return null;
    const P = Math.ceil(spill(n, scope) + 1);
    const svg = svgDoc(inner.replace(/^<g opacity="[^"]+">/, "<g>"), defs, w, h, P);
    return { ...base, k: "s", pd: P, src: saveSvg(svg) };
  }

  if (["VECTOR", "STAR", "LINE", "REGULAR_POLYGON", "BOOLEAN_OPERATION", "BRUSH"].includes(e.type)) {
    // vector with interactions: still an svg, but interactive
    const defs = [];
    svgUid = 0;
    const inner = svgNode(n, scope, defs, true);
    const P = Math.ceil(spill(n, scope) + 1);
    const svg = svgDoc(inner.replace(/^<g opacity="[^"]+">/, "<g>"), defs, w, h, P);
    return { ...base, k: "s", pd: P, src: saveSvg(svg) };
  }

  // box
  let boxSrc = e;
  if (e.type === "INSTANCE") {
    const sym = symbolOf(e);
    if (sym) {
      // instance inherits visual props from its symbol unless overridden
      boxSrc = { ...sym, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => v !== undefined && !["guid", "parentIndex", "symbolData", "derivedSymbolData", "name", "type"].includes(k))) };
    }
  }
  boxCss(boxSrc, s, w, h);
  if (["FRAME", "INSTANCE", "SYMBOL"].includes(e.type) && boxSrc.frameMaskDisabled === false && !boxSrc.resizeToFit) s.overflow = "hidden";
  const node = { ...base, k: "b" };

  const buildKids = (eff, sc) => {
    const out = [];
    for (const c of childrenOf(eff)) {
      const r = convert(c, sc, depth + 1, false, idPath + "/" + gid(c.guid));
      if (r) out.push(r);
    }
    return out;
  };

  if (e.type === "INSTANCE") {
    const sym = symbolOf(e);
    const cs = enterInstance(scope, n, e);
    node.c = buildKids(e, cs);
    // interactive variant states
    const targets = new Set();
    for (const it of e.prototypeInteractions || []) for (const a of it.actions || []) if (a.navigationType === "SWAP_STATE" && a.transitionNodeID) targets.add(gid(a.transitionNodeID));
    if (sym) collectStateTargets(sym, null, targets);
    const set = setOf(sym);
    const frontier = [...targets].filter((x) => x !== gid(sym?.guid || { sessionID: 0, localID: 0 }));
    const states = {};
    const seen = new Set([sym ? gid(sym.guid) : ""]);
    while (frontier.length && Object.keys(states).length < 8 && depth < 60) {
      const tid = frontier.shift();
      if (seen.has(tid)) continue;
      seen.add(tid);
      const tsym = nodes.get(tid);
      if (!tsym || tsym.type !== "SYMBOL" || setOf(tsym) !== set) continue;
      // render the instance as if it used the target variant, keeping instance overrides
      const swapped = { ...e, overriddenSymbolID: tsym.guid, derivedSymbolData: undefined };
      const ss = enterInstance(scope, n, swapped);
      const vs = {};
      boxCss({ ...tsym, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => ["opacity"].includes(k))) }, vs, tsym.size?.x || w, tsym.size?.y || h);
      if (tsym.frameMaskDisabled === false) vs.overflow = "hidden";
      states[tid] = { s: vs, w: r3(tsym.size?.x || w), h: r3(tsym.size?.y || h), c: buildKids(swapped, ss), ia: mapInteractions(tsym.prototypeInteractions) };
      const more = new Set();
      collectStateTargets(tsym, null, more);
      for (const m of more) if (!seen.has(m)) frontier.push(m);
    }
    if (Object.keys(states).length) {
      node.v = { init: gid(sym.guid), st: states, set };
      if (!node.ia) node.ia = mapInteractions(sym.prototypeInteractions);
    }
    return node;
  }
  node.c = buildKids(e, scope);
  if (!node.c.length) delete node.c;
  return node;
}

// ---------- which frames to export ----------
const page = kids.get("0:1") || [];
const screens = new Map();
const queue = [];
for (const n of page) if (n.type === "FRAME" && /^MacBook/.test(n.name)) queue.push(gid(n.guid));
queue.unshift("3:2");
const done = new Set();
while (queue.length) {
  const id = queue.shift();
  if (done.has(id)) continue;
  done.add(id);
  const n = nodes.get(id);
  if (!n || n.type === "SYMBOL") continue;
  const before = new Set(screenTargets);
  const tree = convert(n, null, 0, true, id);
  const meta = {
    id, name: n.name, w: r3(n.size.x), h: r3(n.size.y), tree,
    overlay: n.overlayPositionType ? { pos: n.overlayPositionType, bg: n.overlayBackgroundType === "SOLID_COLOR" && n.overlayBackgroundColor ? rgba(n.overlayBackgroundColor) : null, outside: n.overlayBackgroundInteraction === "CLOSE_ON_CLICK_OUTSIDE" } : undefined,
  };
  fs.writeFileSync(path.join(OUT, "screens", id.replace(":", "-") + ".json"), JSON.stringify(meta));
  screens.set(id, { id, name: n.name, w: meta.w, h: meta.h });
  for (const t of screenTargets) if (!before.has(t) && !done.has(t)) queue.push(t);
}

// copy images
for (const [h, f] of usedImages) fs.copyFileSync(path.join(IMG_SRC, h), path.join(OUT, "img", f));
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ start: "3:2", screens: [...screens.values()], fonts: [...fontsUsed] }, null, 1));
console.log("screens", screens.size, "nodes", nodeCount, "svgs", svgFiles.size, "images", usedImages.size);
