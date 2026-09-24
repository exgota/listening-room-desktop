// Acceptance: the page end to end in headless Chromium, with real audio (MP3 copies from
// test_server.py, since headless Chromium has no AAC decoder).
//
//   python3 tools/render/test_server.py --port 8081 --page site/dist/page.html --mp3 &
//   node tools/render/acceptance.mjs --port 8081 --out /tmp/acceptance
//
// Checks: no console errors; keys 1–4 switch visualizers and the choice survives a reload;
// every song plays under every visualizer, the frame changes while playing, a mid-song seek
// lands and playback continues; title and credits show only the song title and original
// artist; while playing the play button and the controls are away and return on pointer
// move; Space pauses; the same song time always draws the same picture (after seeks in any
// order); the first frame of every visualizer on every song is drawn (saved to --out); the
// library, queue and saved tracks still work.
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] && !all[index + 1].startsWith("--") ? all[index + 1] : "true"]);
    return pairs;
  }, []),
);
const port = args.port || 8081;
const out = args.out || "/tmp/acceptance";
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
const SONGS = {
  "5ff86d6cd02ebd7308e03df8": { title: "NBLY", artist: "Flume" },
  "1d589940ca458d793a3fad8a": { title: "Desire", artist: "Olly Alexander" },
  f127a026dc751f1528bfb95d: { title: "The Fate of Ophelia", artist: "Taylor Swift" },
  "8eee874c702a10807f79706c": { title: "Outside", artist: "Calvin Harris" },
  "4048d4a6dce44c151690b2b1": { title: "American Boy", artist: "Estelle ft. Kanye West" },
};
const VARIANTS = ["rig", "type", "pocket", "plate"];

const results = [];
const errors = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 0.5 },
  protocolTimeout: 240000,
});
const page = (await browser.pages())[0];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  const failure = request.failure()?.errorText || "";
  // Media range requests are cancelled when a source changes; that is not an error.
  if (!/ERR_ABORTED/.test(failure)) errors.push(`requestfailed: ${request.url()} ${failure}`);
});

async function frameHash() {
  const data = await page.screenshot({ encoding: "binary", clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  return createHash("sha1").update(data).digest("hex");
}
async function state() {
  return page.evaluate(() => ({
    visual: document.documentElement.dataset.visual,
    stored: localStorage.getItem("listening-room.visualizer.v1"),
    playing: !audio.paused && !audio.ended,
    time: audio.currentTime,
    duration: audio.duration,
    title: document.querySelector("#title").textContent,
    credits: document.querySelector("#credits").textContent,
    playButtonVisible: getComputedStyle(document.querySelector("#player-view .play-orbit")).visibility !== "hidden",
    transportOpacity: Number(getComputedStyle(document.querySelector("#player-view .transport")).opacity),
    waveformOpacity: Number(getComputedStyle(document.querySelector("#player-view .waveform")).opacity),
    idle: document.body.classList.contains("controls-idle"),
    selected: selected?.identifier,
  }));
}

// ---- load, and keys 1–4 with persistence
await page.goto(`${base}/`, { waitUntil: "load" });
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/track/5ff86d6cd02ebd7308e03df8`, { waitUntil: "load" });
await page.waitForFunction(() => window.visualizerDebug);
await page.evaluate(() => window.visualizerDebug.ready());
await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important}" });
check("page loads without errors", errors.length === 0, errors.join(" | "));
check("default visualizer is Rig", (await state()).visual === "rig");
for (const [index, key] of VARIANTS.entries()) {
  await page.keyboard.press(String(index + 1));
  await sleep(150);
  const now = await state();
  check(`key ${index + 1} selects ${key}`, now.visual === key && now.stored === key, `${now.visual}/${now.stored}`);
}
await page.keyboard.press("2");
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.visualizerDebug);
await page.evaluate(() => window.visualizerDebug.ready());
await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important}" });
check("choice survives a reload", (await state()).visual === "type");
await page.focus("#library-link");
await page.evaluate(() => document.activeElement.blur());

// ---- determinism: a time draws the same picture however you got there
for (const key of VARIANTS) {
  await page.evaluate((k) => window.visualizerDebug.select(k), key);
  const probe = 138.5;
  await page.evaluate((t) => window.visualizerDebug.renderAt(t), probe);
  const first = await frameHash();
  for (const t of [250, 10, 137.9, 300, 138.49]) await page.evaluate((x) => window.visualizerDebug.renderAt(x), t);
  await page.evaluate((t) => window.visualizerDebug.renderAt(t), probe);
  const second = await frameHash();
  check(`${key}: same song time, same frame after seeks`, first === second);
}
await page.evaluate(() => window.visualizerDebug.release());

// ---- first frames of every visualizer on every song (paused, as the thumbnail)
for (const [identifier, song] of Object.entries(SONGS)) {
  await page.goto(`${base}/track/${identifier}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.visualizerDebug);
  await page.evaluate(() => window.visualizerDebug.ready());
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important}" });
  for (const key of VARIANTS) {
    await page.evaluate((k) => window.visualizerDebug.select(k), key);
    await page.evaluate(() => window.visualizerDebug.renderAt(0, { playing: false }));
    const path = `${out}/first-${key}-${song.title.replace(/\W+/g, "-")}.png`;
    await page.screenshot({ path });
    const stats = await page.evaluate(() => {
      const canvas = document.querySelector("#visualizer .visual-canvas:not([hidden]) canvas, #visualizer canvas.visual-canvas:not([hidden])");
      return Boolean(canvas);
    });
    check(`first frame drawn: ${key} / ${song.title}`, stats, path);
  }
  await page.evaluate(() => window.visualizerDebug.release());
}

// ---- play every song under every visualizer; seek mid-song; chrome behaviour
let combination = 0;
for (const [identifier, song] of Object.entries(SONGS)) {
  const key = VARIANTS[combination % VARIANTS.length];
  for (const variant of [key, VARIANTS[(combination + 1) % 4], VARIANTS[(combination + 2) % 4], VARIANTS[(combination + 3) % 4]]) {
    await page.goto(`${base}/track/${identifier}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.visualizerDebug);
    await page.evaluate(() => window.visualizerDebug.ready());
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important}" });
    await page.keyboard.press(String(VARIANTS.indexOf(variant) + 1));
    await page.mouse.move(960, 540);
    await page.click("#play");
    await page.waitForFunction(() => !audio.paused && audio.currentTime > 0.3, { timeout: 20000 }).catch(() => {});
    await page.mouse.move(960, 540); // no movement: the pointer stays still
    let now = await state();
    check(`${variant} / ${song.title}: plays`, now.playing && now.time > 0.3, `t=${now.time.toFixed(2)}`);
    check(`${variant} / ${song.title}: title and original artist only`, now.title === song.title && now.credits === song.artist, `${now.title} · ${now.credits}`);
    check(`${variant} / ${song.title}: play button hidden while playing`, !now.playButtonVisible);
    check(`${variant} / ${song.title}: controls away while playing`, now.idle && now.transportOpacity === 0 && now.waveformOpacity === 0, `idle=${now.idle} opacity=${now.transportOpacity}`);
    const before = await frameHash();
    await sleep(700);
    const after = await frameHash();
    check(`${variant} / ${song.title}: picture moves while playing`, before !== after);
    // seek mid-song through the waveform control, as a pointer would
    await page.mouse.move(700, 1000);
    await page.mouse.move(800, 1000);
    now = await state();
    check(`${variant} / ${song.title}: controls return on pointer move`, !now.idle && now.transportOpacity > 0.9);
    const bounds = await page.evaluate(() => {
      const box = document.querySelector("#seek").getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    // The click and the check of where it landed happen in the page, back to back, so a slow
    // software renderer cannot make the song run on between them.
    const target = now.duration / 2;
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height / 2);
    const landed = await page.evaluate(() => audio.currentTime);
    const playedOn = await page
      .waitForFunction((from) => !audio.paused && audio.currentTime > from + 0.3, { timeout: 20000 }, landed)
      .then(() => true, () => false);
    check(`${variant} / ${song.title}: mid-song seek lands and plays on`, Math.abs(landed - target) < 3 && playedOn, `landed ${landed.toFixed(1)} for ${target.toFixed(1)}`);
    await page.waitForFunction(() => document.body.classList.contains("controls-idle"), { timeout: 8000 }).catch(() => {});
    now = await state();
    check(`${variant} / ${song.title}: controls step aside again`, now.idle && now.transportOpacity === 0);
    await page.keyboard.press("Space");
    await sleep(300);
    now = await state();
    check(`${variant} / ${song.title}: Space pauses, play button returns`, !now.playing && now.playButtonVisible);
    if (variant !== key) continue;
    await page.screenshot({ path: `${out}/playing-${variant}-${song.title.replace(/\W+/g, "-")}.png` });
  }
  combination++;
}

// ---- library, queue and saved tracks still work
await page.goto(`${base}/library`, { waitUntil: "load" });
await page.waitForSelector(".library-track");
const rows = await page.$$eval(".library-track", (list) => list.length);
check("library lists the five songs", rows === 5, `${rows}`);
await page.click(".library-track:nth-child(2) .library-save");
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("listening-room.saved-tracks.v1") || "[]").length);
check("saving a track works", saved === 1);
await page.click(".library-track:nth-child(3) .library-play-next");
const queued = await page.$eval("#queue-count", (element) => element.textContent);
check("play next queues a track", queued === "1", queued);
await page.click(".library-track:nth-child(1) .library-track-link");
await page.waitForFunction(() => !audio.paused, { timeout: 15000 }).catch(() => {});
check("playing from the library works", await page.evaluate(() => !audio.paused));
await page.click("#mini-queue");
check("queue dialog opens", await page.$eval("#queue-dialog", (dialog) => dialog.open));
await page.click("#queue-close");
await page.click("#mini-return");
await sleep(400);
check("mini player returns to the player", await page.evaluate(() => !document.querySelector("#player-view").hidden));

const failed = results.filter((result) => !result.ok);
check("no console errors during the run", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" | "));
writeFileSync(`${out}/acceptance.json`, JSON.stringify({ results, errors: [...new Set(errors)] }, null, 1));
console.log(`\n${results.length - failed.length - (errors.length ? 1 : 0)}/${results.length} passed`);
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
