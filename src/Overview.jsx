import { useEffect, useRef, useState } from "react";
import { Node } from "./Node";
import { loadScreen } from "./data";

const GROUPS = [
  { id: "guest", title: "Visitor (logged out)", note: "Starting point of the prototype" },
  { id: "renter", title: "Renter (logged in)" },
  { id: "host", title: "Host" },
  { id: "popups", title: "Pop-ups & overlays" },
];

const THUMB_W = 300;
const VIEW_H = 945; // top of each screen, 16:10 like a laptop viewport

// Renders a screen only once its card scrolls into view
function Thumb({ item }) {
  const ref = useRef(null);
  const [screen, setScreen] = useState(null);
  useEffect(() => {
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          loadScreen(item.id).then(setScreen);
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item.id]);

  const popup = item.group === "popups";
  const boxH = popup ? 220 : (THUMB_W * VIEW_H) / 1512;
  const scale = popup ? Math.min(THUMB_W / item.w, boxH / item.h) : THUMB_W / item.w;
  return (
    <div ref={ref} className="ov-thumb" style={{ height: boxH, background: popup ? "#d9d9d9" : "#fff" }}>
      {screen && (
        <div
          className="ov-thumb-inner"
          style={{
            width: item.w,
            height: popup ? item.h : Math.min(item.h, VIEW_H),
            transform: `scale(${scale})`,
            left: popup ? (THUMB_W - item.w * scale) / 2 : 0,
            top: popup ? (boxH - item.h * scale) / 2 : 0,
          }}
        >
          <Node n={screen.tree} />
        </div>
      )}
    </div>
  );
}

export default function Overview({ items, onOpen, onStart }) {
  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <h1>Turn and Burn: all screens</h1>
          <p>
            {items.filter((i) => i.group !== "popups").length} screens and {items.filter((i) => i.group === "popups").length} pop-ups,
            in the order the prototype reaches them. Click any screen to open it in the clickable prototype.
          </p>
        </div>
        <button type="button" className="ov-start" onClick={onStart}>
          Start prototype from Home
        </button>
      </header>

      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id} className="ov-group">
            <h2>
              {g.title} <span>{list.length}</span>
            </h2>
            <div className="ov-grid">
              {list.map((item) => (
                <button key={item.id} type="button" className="ov-card" onClick={() => onOpen(item.id)}>
                  <Thumb item={item} />
                  <div className="ov-meta">
                    <strong>{item.title}</strong>
                    <span>
                      {item.num ? `Screen ${item.num}` : "Pop-up"}
                      {item.links ? ` · ${item.links} link${item.links > 1 ? "s" : ""}` : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
