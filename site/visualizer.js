// The visualizer slot. The player calls these five functions; today they draw
// nothing and only keep the frame loop that advances the time and waveform
// while audio plays. A visualizer draws into #visualizer, the full-window stage
// behind the title and controls.
//
//   prepareVisualizer(track, version)  a track was selected; `track.performance_url`
//                                      and `track.analysis_url` point at its data
//   visualizerSeekStarted()            a seek began; the time is about to jump
//   drawVisualizer(timestamp)          draw now (resize, seek, selection)
//   startVisualizer()                  audio started or resumed
//   stopVisualizer()                   audio paused, ended or the page hid

let visualizerFrame = 0;
let visualizerTrack = null;

function prepareVisualizer(track, version) {
  visualizerTrack = track;
  drawVisualizer();
}

function visualizerSeekStarted() {}

function drawVisualizer(timestamp = performance.now()) {}

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
  drawVisualizer();
  if (!audio.paused && !audio.ended && !document.hidden) visualizerFrame = requestAnimationFrame(visualizerFrameLoop);
}

function stopVisualizer() {
  cancelAnimationFrame(visualizerFrame);
  visualizerFrame = 0;
  drawVisualizer();
  drawWaveform();
}

document.addEventListener("visibilitychange", () => (document.hidden || audio.paused ? stopVisualizer() : startVisualizer()));
