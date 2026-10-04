import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionCtx, Node, findStateOwner } from "./Node";
import { loadIndex, loadScreen } from "./data";
import Overview from "./Overview";

const OVERVIEW = "overview";
const toHash = (id) => "#/" + id.replace(":", "-");
const fromHash = () => {
  if (location.hash === "#/" + OVERVIEW) return OVERVIEW;
  const m = location.hash.match(/^#\/(\d+)-(\d+)/);
  return m ? `${m[1]}:${m[2]}` : null;
};

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

function overlayPosition(meta, action, triggerRect, scale, vp) {
  const w = meta.w * scale;
  const h = meta.h * scale;
  if (action.p && triggerRect) return { left: triggerRect.left + action.p[0] * scale, top: triggerRect.top + action.p[1] * scale };
  switch (meta.overlay?.pos) {
    case "TOP_LEFT":
      return { left: 0, top: 0 };
    case "TOP_CENTER":
      return { left: (vp.w - w) / 2, top: 0 };
    case "TOP_RIGHT":
      return { left: vp.w - w, top: 0 };
    case "BOTTOM_LEFT":
      return { left: 0, top: vp.h - h };
    case "BOTTOM_CENTER":
      return { left: (vp.w - w) / 2, top: vp.h - h };
    case "BOTTOM_RIGHT":
      return { left: vp.w - w, top: vp.h - h };
    default:
      return { left: (vp.w - w) / 2, top: Math.max(0, (vp.h - h) / 2) };
  }
}

export default function Player() {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState(null);
  const [screenId, setScreenId] = useState(null);
  const [screen, setScreen] = useState(null);
  const [overlays, setOverlays] = useState([]); // {key, meta, pos}
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const vp = useViewport();
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  useEffect(() => {
    loadIndex()
      .then((idx) => {
        setIndex(idx);
        setScreenId(fromHash() || window.__PROTO_START__ || idx.start);
      })
      .catch((e) => setError(e.message));
  }, []);

  // keep the URL hash in sync so the browser back button and refresh work
  useEffect(() => {
    const on = () => {
      const id = fromHash();
      if (id && id !== screenId) {
        setOverlays([]);
        setScreenId(id);
      }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [screenId]);

  useEffect(() => {
    if (!screenId) return;
    if (screenId === OVERVIEW) {
      setScreen(null);
      window.scrollTo(0, 0);
      if (fromHash() !== OVERVIEW) history.pushState(null, "", toHash(OVERVIEW));
      return;
    }
    let alive = true;
    loadScreen(screenId)
      .then((s) => {
        if (!alive) return;
        setScreen(s);
        window.scrollTo(0, 0);
        if (fromHash() !== screenId) history.pushState(null, "", toHash(screenId));
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [screenId]);

  const scale = screen ? Math.min(1, vp.w / screen.w) : 1;

  const navigate = useCallback((to) => {
    setOverlays([]);
    setScreenId(to);
  }, []);

  const openOverlay = useCallback(
    async (to, action, el, replaceTop) => {
      const meta = await loadScreen(to);
      if (!meta) return;
      const rect = el?.getBoundingClientRect();
      const pos = replaceTop && overlaysRef.current.length
        ? overlaysRef.current[overlaysRef.current.length - 1].pos
        : overlayPosition(meta, action, rect, scale, { w: window.innerWidth, h: window.innerHeight });
      const entry = { key: to + "@" + Date.now(), meta, pos };
      setOverlays((list) => (replaceTop ? [...list.slice(0, -1), entry] : [...list, entry]));
      return entry.key;
    },
    [scale]
  );

  const closeTop = useCallback(() => setOverlays((l) => l.slice(0, -1)), []);

  const run = useCallback(
    (acts, { el, states, hover } = {}) => {
      const undo = [];
      for (const a of acts) {
        switch (a.a) {
          case "nav":
            navigate(a.to);
            break;
          case "closeNav":
            navigate(a.to);
            break;
          case "overlay": {
            const p = openOverlay(a.to, a, el, false);
            if (hover) undo.push(() => p.then((key) => setOverlays((l) => l.filter((o) => o.key !== key))));
            break;
          }
          case "swap":
            openOverlay(a.to, a, el, true);
            break;
          case "close":
            if (overlaysRef.current.length) closeTop();
            else history.back();
            break;
          case "back":
            if (overlaysRef.current.length) closeTop();
            else history.back();
            break;
          case "state": {
            const owner = findStateOwner(states, a.to);
            if (owner) {
              const prev = owner.get();
              owner.set(a.to);
              if (hover) undo.push(() => owner.set(prev));
            }
            break;
          }
          case "scroll": {
            const target = document.querySelector(`[data-nid$="/${a.to}"]`);
            target?.scrollIntoView({ behavior: "smooth", block: "start" });
            break;
          }
          case "url":
            window.open(a.url, "_blank", "noopener");
            break;
          default:
        }
      }
      return undo;
    },
    [navigate, openOverlay, closeTop]
  );

  // Like Figma: clicking somewhere that isn't clickable briefly highlights the hotspots
  const onBackgroundClick = (e) => {
    if (e.target.closest("[data-hotspot]") || e.target.closest(".proto-ui")) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 500);
  };

  const mainScreens = useMemo(() => (index ? index.screens.filter((s) => /^MacBook/.test(s.name)) : []), [index]);

  if (error) return <div className="proto-message">Couldn't load the prototype: {error}</div>;
  if (screenId === OVERVIEW && index)
    return <Overview items={index.overview || []} onOpen={(id) => navigate(id)} onStart={() => navigate(index.start)} />;
  if (!screen) return <div className="proto-message">Loading prototype…</div>;

  return (
    <ActionCtx.Provider value={run}>
      <div className={`proto-root${flash ? " show-hotspots" : ""}`} onClick={onBackgroundClick}>
        <div className="proto-stage" style={{ width: screen.w * scale, height: screen.h * scale }}>
          <div className="proto-screen" style={{ width: screen.w, height: screen.h, transform: `scale(${scale})` }}>
            <Node key={screen.id} n={screen.tree} />
          </div>
        </div>

        {overlays.map((o) => (
          <div key={o.key} className="proto-overlay-layer">
            <div
              className="proto-backdrop"
              style={{ background: o.meta.overlay?.bg || "transparent" }}
              onClick={(e) => {
                e.stopPropagation();
                if (o.meta.overlay?.outside !== false) setOverlays((l) => l.filter((x) => x.key !== o.key));
              }}
            />
            <div
              className="proto-overlay"
              style={{ left: o.pos.left, top: o.pos.top, width: o.meta.w, height: o.meta.h, transform: `scale(${scale})` }}
              onClick={(e) => e.stopPropagation()}
            >
              <Node n={o.meta.tree} />
            </div>
          </div>
        ))}

        <div className="proto-ui">
          <button type="button" className="proto-btn" onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? "Close" : "All screens"}
          </button>
          <button type="button" className="proto-btn" onClick={() => navigate(index.start)}>
            Restart
          </button>
          <button type="button" className="proto-btn" onClick={() => navigate(OVERVIEW)}>
            Overview
          </button>
          {menuOpen && (
            <div className="proto-menu">
              {(index.overview || mainScreens).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === screenId ? "is-current" : ""}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(s.id);
                  }}
                >
                  {s.title ? `${s.num ? s.num + ". " : ""}${s.title}` : s.name.replace('MacBook Pro 14" - ', "Screen ")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </ActionCtx.Provider>
  );
}
