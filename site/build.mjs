// Inlines the styles and scripts into one page, served by ../server.py.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const scriptFiles = [
  "data-access.js",
  "player.js",
  "waveform.js",
  "visualizer.js",
  "queue.js",
  "playback-session.js",
  "media-session.js",
  "library.js",
  "navigation.js",
];
const styles = readFileSync("styles.css", "utf8");
const scripts = scriptFiles.map((filename) => readFileSync(filename, "utf8")).join("\n");
const page = readFileSync("page.html", "utf8")
  .replace("<!-- PAGE_STYLES -->", `<style>${styles}</style>`)
  .replace("<!-- PAGE_SCRIPTS -->", `<script>${scripts}</script>`)
  .replace(
    "<!-- TAB_ICON -->",
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(readFileSync("assets/tab-icon.svg", "utf8").trim())}" />`,
  );
mkdirSync("dist", { recursive: true });
writeFileSync("dist/page.html", page);
