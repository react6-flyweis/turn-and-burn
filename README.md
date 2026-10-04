# Turn and Burn: clickable prototype (React)

Every screen and pop-up from the Figma file "Turn and Burn (Car Rental)", wired up like the Figma prototype:
60 screens, 25 pop-ups, ~800 page links, ~100 pop-up links and ~2,200 hover/click state changes.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The prototype starts on the home screen, exactly like the Figma prototype link.

- Click buttons and links to move between screens, the same way as in Figma.
- Click anywhere that isn't clickable and the clickable areas flash blue (like Figma).
- **Overview** (bottom-left, or `#/overview`) shows every screen as a thumbnail, grouped by flow; click one to open it.
- **All screens** jumps straight to any screen; **Restart** returns to the home screen.
- The browser back button works, and each screen has its own URL (e.g. `#/48-2687`).

To publish it as a website: `npm run build`, then upload the `dist/` folder to any static host.

## How it's built

- `public/proto/screens/*.json`: one file per screen/pop-up, generated from the Figma file (layout, text, styles, links, states)
- `public/proto/svg/`, `public/proto/img/`: all icons and images from the design (images resized to the size they're shown at)
- `src/Player.jsx`: navigation, pop-ups (overlays), history, screen scaling
- `src/Node.jsx`: draws each layer and handles clicks, hovers and component state changes

## Updating from Figma

The screens were generated from a "Save local copy" export of the Figma file. If the design changes:

1. In Figma: File → Save local copy, then unzip it (it contains `canvas.fig` and an `images/` folder).
2. Put it in a `figma-export/` folder at the project root (or set FIG_CANVAS and FIG_IMAGES to its canvas.fig and images/ paths).
3. Run `node tools/convert.cjs public/proto` (Node 22.15 or newer).

## Note

This is a visual, clickable prototype: it behaves like the Figma prototype, but form fields don't accept typing and
nothing is saved. Turning screens into fully working pages (real inputs, data from a backend) is the next step.
The `home-page-react/` folder in the zip shows what that looks like for the home page.
