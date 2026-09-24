// Main-thread cost of drawing one frame, per visualizer and song, in headless Chromium.
//
//   python3 tools/render/test_server.py --port 8081 --page site/dist/page.html --mp3 &
//   node tools/render/frametime.mjs --port 8081 [--frames 150] [--scale 1]
//
// Each frame is one call of the page's own drawVisualizer at a song time spread evenly over
// the song (so every section is sampled), timed with performance.now() around the call. This
// is script and command-recording time only: WebGL work and canvas rasterisation run later,
// on the GPU process (here a software GPU, so it is not measured). Reports the median, the
// 95th percentile and the worst frame.
import puppeteer from "puppeteer";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : "true"]);
    return pairs;
  }, []),
);
const port = args.port || 8081;
const frames = Number(args.frames || 150);
const scale = Number(args.scale || 1);
const SONGS = {
  nbly: "5ff86d6cd02ebd7308e03df8",
  desire: "1d589940ca458d793a3fad8a",
  ophelia: "f127a026dc751f1528bfb95d",
  outside: "8eee874c702a10807f79706c",
  americanboy: "4048d4a6dce44c151690b2b1",
};
const VARIANTS = (args.variants || "rig,type,pocket,plate").split(",");

const browser = await puppeteer.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: scale },
  protocolTimeout: 600000,
});
const page = (await browser.pages())[0];
const rows = [];
for (const variant of VARIANTS) {
  const all = [];
  for (const [name, id] of Object.entries(SONGS)) {
    await page.goto(`http://localhost:${port}/track/${id}?visual=${variant}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.visualizerDebug, { timeout: 20000 });
    await page.evaluate(() => window.visualizerDebug.ready());
    await page.evaluate(() => window.visualizerDebug.renderAt(0));
    const times = await page.evaluate(async (count) => {
      /* global visualizerDebugTime:writable, visualizerSong, drawVisualizer */
      const length = visualizerSong?.duration || 200;
      const result = [];
      for (let index = 0; index < count; index++) {
        // a frame between draws, as in playback, so the GPU queue drains and cannot stall the
        // timed call
        await new Promise((resolve) => requestAnimationFrame(resolve));
        visualizerDebugTime = ((index + 0.5) / count) * length;
        const start = performance.now();
        drawVisualizer(start);
        result.push(performance.now() - start);
      }
      return result;
    }, frames);
    all.push(...times);
    rows.push({ variant, song: name, ...stats(times) });
  }
  rows.push({ variant, song: "all", ...stats(all) });
}
await browser.close();

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p95: at(0.95), worst: sorted[sorted.length - 1] };
}
console.log("variant  song         median   p95     worst   (ms of main-thread script per frame)");
for (const row of rows) console.log(`${row.variant.padEnd(8)} ${row.song.padEnd(12)} ${row.median.toFixed(2).padStart(6)}  ${row.p95.toFixed(2).padStart(6)}  ${row.worst.toFixed(2).padStart(6)}`);
