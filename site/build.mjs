// Inlines the styles, fonts and scripts into one page, served by ../server.py.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const scriptFiles = [
  "data-access.js",
  "player.js",
  "waveform.js",
  "song-model.js",
  "visualizer.js",
  "visual-common.js",
  "visual-rig.js",
  "visual-type.js",
  "visual-pocket.js",
  "visual-plate.js",
  "visualizer-start.js",
  "queue.js",
  "playback-session.js",
  "media-session.js",
  "library.js",
  "navigation.js",
];
// Vendored from npm (see vendor/fonts/README.md), inlined so the page needs no network.
const fonts = [
  { family: "Archivo", file: "archivo-latin-standard-normal.woff2", weight: "100 900", stretch: "62% 125%" },
  { family: "Inter Tight", file: "inter-tight-latin-wght-normal.woff2", weight: "100 900" },
  { family: "Jost", file: "jost-latin-wght-normal.woff2", weight: "100 900" },
  { family: "Instrument Serif", file: "instrument-serif-latin-400-normal.woff2", weight: "400" },
  { family: "Instrument Serif", file: "instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  { family: "IBM Plex Mono", file: "ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
  { family: "IBM Plex Mono", file: "ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
];
const fontFaces = fonts
  .map(
    (font) =>
      `@font-face{font-family:"${font.family}";font-style:${font.style || "normal"};font-weight:${font.weight};` +
      (font.stretch ? `font-stretch:${font.stretch};` : "") +
      `font-display:block;src:url(data:font/woff2;base64,${readFileSync(`vendor/fonts/${font.file}`).toString("base64")}) format("woff2");}`,
  )
  .join("\n");
const styles = fontFaces + "\n" + readFileSync("styles.css", "utf8");
const scripts = scriptFiles.map((filename) => readFileSync(filename, "utf8")).join("\n");
const page = readFileSync("page.html", "utf8")
  .replace("<!-- PAGE_STYLES -->", () => `<style>${styles}</style>`)
  .replace("<!-- PAGE_SCRIPTS -->", () => `<script>${scripts}</script>`)
  .replace(
    "<!-- TAB_ICON -->",
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(readFileSync("assets/tab-icon.svg", "utf8").trim())}" />`,
  );
mkdirSync("dist", { recursive: true });
writeFileSync("dist/page.html", page);
