import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { assetUrl, resolveCss } from "./data";

// Runs prototype actions (navigate, overlay, back, close...) — provided by the Player
export const ActionCtx = createContext(null);
// Chain of interactive component instances, so "change to" can find the instance that owns a variant
const StateCtx = createContext(null);

// Like Figma, only layers with interactions catch the mouse; everything else lets clicks through
const live = (h) => (h && (h.onClick || h.onMouseEnter) ? "auto" : "none");

function frameStyle(n, extra) {
  const st = {
    position: "absolute",
    pointerEvents: "none",
    left: 0,
    top: 0,
    width: n.w,
    height: n.h,
    ...resolveCss(n.s || {}),
    ...extra,
  };
  if (n.m) {
    st.transform = `matrix(${n.m.join(",")})`;
    st.transformOrigin = "0 0";
  } else {
    st.left = n.x ?? 0;
    st.top = n.y ?? 0;
  }
  return st;
}

function useInteractions(ia, elRef) {
  const run = useContext(ActionCtx);
  const states = useContext(StateCtx);
  const hoverUndo = useRef(null);
  const props = {};
  if (!ia || !run) return props;

  const exec = (acts, opts = {}) => run(acts, { el: elRef.current, states, ...opts });

  const click = ia.filter((i) => i.e === "ON_CLICK" || i.e === "ON_PRESS");
  const hover = ia.filter((i) => i.e === "ON_HOVER");
  if (click.length) {
    props.onClick = (ev) => {
      ev.stopPropagation();
      // a hover state swap would otherwise be undone on mouse leave
      hoverUndo.current = null;
      click.forEach((i) => exec(i.x));
    };
    props["data-hotspot"] = "1";
  }
  if (hover.length) {
    props.onMouseEnter = () => {
      const undo = [];
      hover.forEach((i) => undo.push(...(exec(i.x, { hover: true }) || [])));
      hoverUndo.current = undo;
    };
    props.onMouseLeave = () => {
      const undo = hoverUndo.current;
      hoverUndo.current = null;
      if (undo) undo.forEach((fn) => fn());
    };
  }
  return props;
}

function useTimeouts(ia, elRef) {
  const run = useContext(ActionCtx);
  const states = useContext(StateCtx);
  useEffect(() => {
    if (!ia || !run) return;
    const timers = ia
      .filter((i) => i.e === "AFTER_TIMEOUT")
      .map((i) => setTimeout(() => run(i.x, { el: elRef.current, states }), i.ms || 800));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function Children({ list }) {
  if (!list) return null;
  return list.map((c) => <Node key={c.id} n={c} />);
}

function Text({ n, handlers, elRef }) {
  const style = frameStyle(n, { display: "flex", flexDirection: "column", pointerEvents: live(handlers) });
  return (
    <div ref={elRef} style={style} {...handlers}>
      <div style={{ width: "100%" }}>
        {n.r
          ? n.r.map((run, i) => (
              <span key={i} style={run[1]}>
                {run[0]}
              </span>
            ))
          : n.tx}
      </div>
    </div>
  );
}

function Svg({ n, handlers, elRef }) {
  const pad = n.pd || 0;
  const style = frameStyle(n, { pointerEvents: live(handlers) });
  return (
    <div ref={elRef} style={style} {...handlers}>
      <img
        src={assetUrl(n.src)}
        alt=""
        draggable={false}
        style={{ position: "absolute", left: -pad, top: -pad, width: n.w + pad * 2, height: n.h + pad * 2, maxWidth: "none" }}
      />
    </div>
  );
}

function VariantInstance({ n }) {
  const [cur, setCur] = useState(n.v.init);
  const parent = useContext(StateCtx);
  const elRef = useRef(null);
  const view = cur === n.v.init ? n : { ...n, ...n.v.st[cur], id: n.id, x: n.x, y: n.y, m: n.m };
  const ctx = useRef(null);
  ctx.current = {
    parent,
    owns: (to) => to === n.v.init || !!n.v.st[to],
    get: () => cur,
    set: setCur,
  };
  const handlers = useInteractions(view.ia, elRef);
  return (
    <StateCtx.Provider value={ctx.current}>
      <div ref={elRef} style={frameStyle(view, { transition: "background-color .3s, box-shadow .3s", pointerEvents: live(handlers) })} {...handlers}>
        <Children list={view.c} />
      </div>
    </StateCtx.Provider>
  );
}

export const Node = memo(function Node({ n }) {
  const elRef = useRef(null);
  const handlers = useInteractions(n.v ? null : n.ia, elRef);
  useTimeouts(n.ia, elRef);
  if (n.v) return <VariantInstance n={n} />;
  if (n.k === "t") return <Text n={n} handlers={handlers} elRef={elRef} />;
  if (n.k === "s") return <Svg n={n} handlers={handlers} elRef={elRef} />;
  return (
    <div ref={elRef} style={frameStyle(n, { pointerEvents: live(handlers) })} {...handlers} data-nid={n.id}>
      <Children list={n.c} />
    </div>
  );
});

// Find the nearest component instance that has the requested variant
export function findStateOwner(states, to) {
  let s = states;
  while (s) {
    if (s.owns(to)) return s;
    s = s.parent;
  }
  return null;
}
