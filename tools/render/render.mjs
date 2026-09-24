// Renders exact song times of the built page to PNG files, headless, for review.
//
//   node render.mjs --song nbly --variant rig --out /tmp/frames --from 0 --to 60 --fps 2
//   node render.mjs --song desire --variant type --out dir --times 167.4,167.683,168
//   options: --scale 0.5 (device pixel ratio; 0.5 renders 960x540 of the 1920x1080 page)
//            --paused (the page as it looks before play, with the play button and controls)
//            --controls (playing, but with the controls shown)
//            --pages 2 (parallel pages)  --port 8080  --prefix name
// Needs the server running (python3 server.py) and the page built (cd site && node build.mjs).
import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";

const SONGS = {
  nbly: "5ff86d6cd02ebd7308e03df8",
  desire: "1d589940ca458d793a3fad8a",
  ophelia: "f127a026dc751f1528bfb95d",
  outside: "8eee874c702a10807f79706c",
  americanboy: "4048d4a6dce44c151690b2b1",
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : "true"]);
    return pairs;
  }, []),
);
const song = SONGS[args.song] || args.song;
const variant = args.variant || "rig";
const out = args.out || "frames";
const scale = Number(args.scale || 1);
const port = args.port || 8080;
const prefix = args.prefix || `${args.song}-${variant}`;
let times = [];
if (args.times) times = args.times.split(",").map(Number);
else {
  const from = Number(args.from || 0), to = Number(args.to || 10), fps = Number(args.fps || 2);
  for (let index = 0; from + index / fps <= to + 1e-9; index++) times.push(Math.round((from + index / fps) * 1000) / 1000);
}
mkdirSync(out, { recursive: true });

// One browser per worker: background tabs of a shared browser are throttled and stall.
const browsers = [];
async function launch() {
  const browser = await puppeteer.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--force-color-profile=srgb"],
    defaultViewport: { width: Number(args.width || 1920), height: Number(args.height || 1080), deviceScaleFactor: scale },
    protocolTimeout: 240000,
  });
  browsers.push(browser);
  return browser;
}
const errors = [];
async function openPage() {
  const browser = await launch();
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`http://localhost:${port}/track/${song}?visual=${variant}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.visualizerDebug, { timeout: 20000 });
  await page.evaluate(() => window.visualizerDebug.ready());
  // Headless Chromium cannot decode the AAC mix; silence the notice so it is not in frames.
  await page.addStyleTag({ content: "#notice{display:none!important} *,*::before,*::after{transition:none!important}" });
  return page;
}
const pageCount = Math.max(1, Math.min(Number(args.pages || 1), times.length));
const pages = await Promise.all(Array.from({ length: pageCount }, openPage));
const playing = args.paused !== "true";
const idle = args.controls !== "true";
const started = Date.now();
await Promise.all(
  pages.map(async (page, pageIndex) => {
    for (let index = pageIndex; index < times.length; index += pageCount) {
      const time = times[index];
      await page.evaluate((t, p, i) => window.visualizerDebug.renderAt(t, { playing: p, idle: i }), time, playing, idle);
      const name = `${out}/${prefix}_${String(Math.floor(time)).padStart(4, "0")}${(time % 1).toFixed(3).slice(1)}.png`;
      await page.screenshot({ path: name });
    }
  }),
);
console.log(`${times.length} frames in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${out}`);
if (errors.length) console.log("page errors:\n" + [...new Set(errors)].join("\n"));
await Promise.all(browsers.map((browser) => browser.close()));
