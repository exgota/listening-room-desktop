let waveformTheme = null;
let waveformSize = "";

function readWaveformTheme() {
  const style = getComputedStyle(elements.waveform);
  return {
    played: style.getPropertyValue("--waveform-played").trim() || "#315bca",
    rest: style.getPropertyValue("--waveform-rest").trim() || "#8290a3",
    empty: style.getPropertyValue("--waveform-empty").trim() || "#aeb6c2",
  };
}

function drawWaveform() {
  const canvas = elements.waveform,
    bounds = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  if (!bounds.width || !bounds.height) return;
  // While the controls are away during playback nothing shows, so nothing is drawn.
  if (document.body.classList.contains("controls-idle") && document.body.classList.contains("visual-playing")) return;
  const size = `${Math.round(bounds.width * ratio)}x${Math.round(bounds.height * ratio)}`;
  if (size !== waveformSize) {
    waveformSize = size;
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
  }
  waveformTheme ||= readWaveformTheme();
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const progress = Number(elements.seek.value) / 1000,
    peaks = selected?.peaks || [],
    barCount = Math.max(1, Math.floor(bounds.width / 5)),
    center = bounds.height / 2;
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!peaks.length) {
    context.fillStyle = waveformTheme.empty;
    context.fillRect(0, center, bounds.width, 1);
    return;
  }
  for (let index = 0; index < barCount; index++) {
    const start = Math.floor((index * peaks.length) / barCount),
      finish = Math.max(
        start + 1,
        Math.floor(((index + 1) * peaks.length) / barCount),
      );
    let height = 0;
    for (let sample = start; sample < finish; sample++)
      height = Math.max(height, peaks[sample] || 0);
    height = Math.max(3, height * (bounds.height - 22));
    context.fillStyle = index / barCount < progress ? waveformTheme.played : waveformTheme.rest;
    context.beginPath();
    context.roundRect(
      (index * bounds.width) / barCount,
      center - height / 2,
      Math.max(2, bounds.width / barCount - 2),
      height,
      1,
    );
    context.fill();
  }
}

function updatePosition() {
  const duration = Number.isFinite(audio.duration)
    ? audio.duration
    : selected?.duration || 0;
  const position = seekPreview?.position ?? playbackPosition();
  elements.position.textContent = time(position);
  elements.duration.textContent = time(duration);
  elements.seek.value = duration ? (position / duration) * 1000 : 0;
  elements.seek.setAttribute(
    "aria-valuetext",
    `${time(position)} of ${time(duration)}`,
  );
  elements.cursor.style.left = `${Number(elements.seek.value) / 10}%`;
  elements["mini-position"].textContent = elements.position.textContent;
  elements["mini-duration"].textContent = elements.duration.textContent;
  elements["mini-seek"].value = elements.seek.value;
  elements["mini-seek"].setAttribute("aria-valuetext", elements.seek.getAttribute("aria-valuetext"));
  elements["mini-seek"].style.setProperty("--progress", `${Number(elements.seek.value) / 10}%`);
  drawWaveform();
  updateTrackControls();
}

elements.seek.addEventListener("pointermove", (event) => {
  const bounds = elements.seek.getBoundingClientRect(),
    fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    ),
    duration = Number.isFinite(audio.duration)
      ? audio.duration
      : selected?.duration || 0;
  elements["preview-needle"].style.left = `${fraction * 100}%`;
  elements["preview-time"].textContent = time(fraction * duration);
  elements["preview-time"].style.transform =
    fraction < 0.04
      ? "translateX(0)"
      : fraction > 0.96
        ? "translateX(-100%)"
        : "translateX(-50%)";
});
