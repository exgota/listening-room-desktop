// The visualizer slot. The player calls five functions; this file keeps the frame loop,
// a song clock, the choice of visualizer (keys 1–4, remembered), and the playing chrome.
// Each visualizer (visual-*.js) registers itself with registerVisualizer() and draws a
// picture that is a function of song time and the song's analysis only.
//
//   prepareVisualizer(track, version)  a track was selected; `track.performance_url`
//                                      and `track.analysis_url` point at its data
//   visualizerSeekStarted()            a seek began; the time is about to jump
//   drawVisualizer(timestamp)          draw now (resize, seek, selection)
//   startVisualizer()                  audio started or resumed
//   stopVisualizer()                   audio paused, ended or the page hid
//
// A visualizer is { key, name, theme, create(stage) } where create returns
// { canvas, setSong(model), resize(width, height, ratio), render(time, frame), setActive(on) }.

let visualizerFrame = 0;
let visualizerTrack = null;
let visualizerSong = null;
let visualizerDebugTime = null;
const visualizerChoiceKey = "listening-room.visualizer.v1";
const visualizerDefault = "rig";
const visualizerDefinitions = [];
const visualizerInstances = new Map();
let visualizerActive = null;
let visualizerSize = { width: 0, height: 0, ratio: 1 };
const visualizerClock = { reported: -1, time: 0, now: 0 };
const visualizerFrameInfo = { time: 0, now: 0, playing: false, width: 0, height: 0, ratio: 1, song: null, titleBottom: 0 };
let visualizerTitleBottom = 0;
let visualizerReadyResolve;
const visualizerReady = new Promise((resolve) => (visualizerReadyResolve = resolve));

function registerVisualizer(definition) {
  visualizerDefinitions.push(definition);
  visualizerDefinitions.sort((first, second) => first.order - second.order);
}

function readVisualizerChoice() {
  const requested = new URLSearchParams(location.search).get("visual");
  if (requested) return requested;
  try {
    return localStorage.getItem(visualizerChoiceKey) || visualizerDefault;
  } catch (error) {
    return visualizerDefault;
  }
}

function visualizerInstance(key) {
  const definition = visualizerDefinitions.find((entry) => entry.key === key) || visualizerDefinitions.find((entry) => entry.key === visualizerDefault);
  if (!definition) return null;
  if (!visualizerInstances.has(definition.key)) {
    const instance = definition.create(elements.visualizer);
    instance.definition = definition;
    instance.canvas.classList.add("visual-canvas");
    elements.visualizer.prepend(instance.canvas);
    if (visualizerSize.width) instance.resize(visualizerSize.width, visualizerSize.height, visualizerSize.ratio);
    instance.setSong(visualizerSong);
    visualizerInstances.set(definition.key, instance);
  }
  return visualizerInstances.get(definition.key);
}

// A visualizer may colour the page per song (themeFor returns CSS custom properties).
let visualizerThemeKeys = [];
function applyVisualizerTheme() {
  const root = document.documentElement;
  for (const key of visualizerThemeKeys) root.style.removeProperty(key);
  visualizerThemeKeys = [];
  const properties = visualizerActive?.themeFor?.(visualizerSong) || {};
  for (const [key, value] of Object.entries(properties)) {
    root.style.setProperty(key, value);
    visualizerThemeKeys.push(key);
  }
  waveformTheme = null;
}

function selectVisualizer(key, remember = true) {
  const instance = visualizerInstance(key);
  if (!instance) return;
  if (remember) {
    try {
      localStorage.setItem(visualizerChoiceKey, instance.definition.key);
    } catch (error) {}
  }
  if (instance === visualizerActive) return;
  visualizerActive?.setActive(false);
  visualizerActive = instance;
  instance.setActive(true);
  document.documentElement.dataset.visual = instance.definition.key;
  applyVisualizerTheme();
  drawVisualizer();
  drawWaveform();
}

function measureVisualizer() {
  const intro = document.querySelector("#player-view > .intro");
  const stageTop = elements.visualizer.getBoundingClientRect().top;
  visualizerTitleBottom = intro ? Math.max(0, intro.getBoundingClientRect().bottom - stageTop) : 0;
  const bounds = elements.visualizer.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  if (bounds.width === visualizerSize.width && bounds.height === visualizerSize.height && ratio === visualizerSize.ratio) return;
  visualizerSize = { width: bounds.width, height: bounds.height, ratio };
  for (const instance of visualizerInstances.values()) instance.resize(bounds.width, bounds.height, ratio);
}

// Song time for this frame. Between the element's own updates the clock runs on the frame
// timestamp, never more than a quarter second past the last reported position.
function visualizerSongTime(now) {
  if (visualizerDebugTime !== null) return visualizerDebugTime;
  const reported = playbackPosition();
  if (audio.paused || audio.ended || reported !== visualizerClock.reported) {
    visualizerClock.reported = reported;
    visualizerClock.time = reported;
    visualizerClock.now = now;
    return reported;
  }
  const elapsed = ((now - visualizerClock.now) / 1000) * (audio.playbackRate || 1);
  return visualizerClock.time + Math.min(Math.max(0, elapsed), 0.25);
}

function prepareVisualizer(track, version) {
  visualizerTrack = track;
  visualizerSize = { width: 0, height: 0, ratio: 1 };
  visualizerSong = null;
  for (const instance of visualizerInstances.values()) instance.setSong(null);
  applyVisualizerTheme();
  drawVisualizer();
  loadSongModel(track)
    .then((model) => {
      if (version !== selectionVersion || visualizerTrack !== track) return;
      visualizerSong = model;
      for (const instance of visualizerInstances.values()) instance.setSong(model);
      applyVisualizerTheme();
      drawVisualizer();
      drawWaveform();
      visualizerReadyResolve?.(true);
      // Warm the next track in the library so its first frame is ready too.
      const next = adjacentTrack(1);
      if (next) setTimeout(() => loadSongModel(next).catch(() => {}), 1500);
    })
    .catch(() => visualizerReadyResolve?.(false));
}

function visualizerSeekStarted() {
  visualizerClock.reported = -1;
}

function drawVisualizer(timestamp = performance.now()) {
  if (!visualizerActive) return;
  if (!visualizerSize.width) measureVisualizer();
  if (!visualizerSize.width || !visualizerSize.height) return;
  const frame = visualizerFrameInfo;
  frame.now = timestamp;
  frame.time = visualizerSongTime(timestamp);
  frame.playing = visualizerDebugTime !== null ? document.body.classList.contains("visual-playing") : !audio.paused && !audio.ended;
  frame.width = visualizerSize.width;
  frame.height = visualizerSize.height;
  frame.ratio = visualizerSize.ratio;
  frame.song = visualizerSong;
  frame.titleBottom = visualizerTitleBottom;
  visualizerActive.render(frame.time, frame);
}

function visualizerFrameLoop(timestamp) {
  if (audio.paused || audio.ended || document.hidden) {
    stopVisualizer();
    return;
  }
  drawVisualizer(timestamp);
  updatePosition();
  visualizerFrame = requestAnimationFrame(visualizerFrameLoop);
}

function startVisualizer() {
  cancelAnimationFrame(visualizerFrame);
  const playing = !audio.paused && !audio.ended;
  document.body.classList.toggle("visual-playing", playing);
  if (playing && !document.body.classList.contains("visual-playing-started")) {
    document.body.classList.add("visual-playing-started", "controls-idle");
  }
  drawVisualizer();
  if (!audio.paused && !audio.ended && !document.hidden) visualizerFrame = requestAnimationFrame(visualizerFrameLoop);
}

function stopVisualizer() {
  cancelAnimationFrame(visualizerFrame);
  visualizerFrame = 0;
  if (audio.paused || audio.ended) {
    document.body.classList.remove("visual-playing", "visual-playing-started", "controls-idle");
    clearTimeout(controlsIdleTimer);
  }
  drawVisualizer();
  drawWaveform();
}

document.addEventListener("visibilitychange", () => (document.hidden || audio.paused ? stopVisualizer() : startVisualizer()));

// ---- playing chrome: the play button leaves while audio plays; the controls step aside
// until the pointer moves or focus enters them.

let controlsIdleTimer = 0;

function showControls() {
  if (!document.body.classList.contains("controls-idle")) {
    clearTimeout(controlsIdleTimer);
  } else {
    document.body.classList.remove("controls-idle");
    drawWaveform();
  }
  clearTimeout(controlsIdleTimer);
  if (document.body.classList.contains("visual-playing")) {
    controlsIdleTimer = setTimeout(() => {
      if (!document.body.classList.contains("visual-playing")) return;
      // Keyboard focus in the controls keeps them; a mouse click that left focus there does not.
      if (document.querySelector("#player-view .waveform :focus-visible, #player-view .transport :focus-visible, #player-view .download-row :focus-visible, .header :focus-visible"))
        return;
      document.body.classList.add("controls-idle");
    }, 2600);
  }
}

let lastPointer = null;
document.addEventListener("pointermove", (event) => {
  // Browsers send a pointermove when the page scrolls or re-lays out under a still pointer.
  if (lastPointer && Math.abs(event.clientX - lastPointer[0]) < 2 && Math.abs(event.clientY - lastPointer[1]) < 2) return;
  lastPointer = [event.clientX, event.clientY];
  showControls();
});
document.addEventListener("focusin", (event) => {
  if (event.target.closest?.("#player-view, .header") && event.target.matches?.(":focus-visible")) showControls();
});

// Clicking the picture pauses or resumes, since the play button is away while audio plays.
elements.visualizer.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  if (!selected) return;
  if (playbackRequested || !audio.paused) pausePlayback();
  else resumePlayback();
});

function typingInto(target) {
  return target?.closest?.("input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=''], [contenteditable=true]");
}

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
  const position = ["1", "2", "3", "4"].indexOf(event.key);
  if (position >= 0 && visualizerDefinitions[position]) {
    event.preventDefault();
    selectVisualizer(visualizerDefinitions[position].key);
    return;
  }
  // Space plays and pauses, except where it already means something (buttons, links, typing).
  if (event.key === " " && !event.target.closest?.("button, a, dialog, input:not([type=range])") && currentView === "player" && selected) {
    event.preventDefault();
    if (playbackRequested || !audio.paused) pausePlayback();
    else resumePlayback();
  }
});

const visualizerResizeObserver = new ResizeObserver(() => {
  measureVisualizer();
  drawVisualizer();
});
visualizerResizeObserver.observe(elements.visualizer);

// Review hooks for headless rendering (tools/render): draw any song time exactly, with
// the chrome as it looks while playing, without audio.
window.visualizerDebug = {
  ready: () => Promise.all([visualizerReady, visualFontsReady]),
  keys: () => visualizerDefinitions.map((definition) => definition.key),
  select: (key) => selectVisualizer(key, false),
  renderAt(songTime, { playing = true, idle = true } = {}) {
    visualizerDebugTime = songTime;
    document.body.classList.toggle("visual-playing", playing);
    document.body.classList.toggle("controls-idle", playing && idle);
    const duration = selected?.duration || 1;
    elements.seek.value = (songTime / duration) * 1000;
    elements.position.textContent = time(songTime);
    elements.cursor.style.left = `${(songTime / duration) * 100}%`;
    measureVisualizer();
    drawVisualizer(performance.now());
    drawWaveform();
    return true;
  },
  release() {
    visualizerDebugTime = null;
    document.body.classList.remove("visual-playing", "controls-idle");
    drawVisualizer();
  },
};

function startVisualizers() {
  selectVisualizer(readVisualizerChoice(), false);
}
