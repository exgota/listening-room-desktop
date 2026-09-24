const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [
    element.id,
    element,
  ]),
);

const audio = elements.audio;
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const prefersPlaybackCopy = isIOS || /Android|Mobile/.test(navigator.userAgent);
let volumeLevel = 1;
let volumeMuted = false;
elements.volume.closest(".volume").hidden = isIOS;
if (navigator.audioSession) {
  try {
    navigator.audioSession.type = "playback";
  } catch (error) {}
}

const playIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="triangle" d="M7 4.5v15L20 12Z"/></svg>';

const pauseIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>';

let tracks = [],
  selected = null,
  selectionVersion = 0,
  playbackRequested = false,
  pendingSeek = null,
  fallbackLoading = false,
  usingFallback = false,
  fallbackController = null;
let seekPreview = null;

function requestedIdentifier() {
  return location.pathname.match(/^\/track\/([a-f0-9]{24})$/)?.[1] || null;
}

function sourceIsCurrent() {
  return (
    selected && audio.currentSrc === new URL(audio.src, location.href).href
  );
}

async function playSelected(version = selectionVersion) {
  if (version !== selectionVersion || !playbackRequested) return;
  const source = audio.src;
  try {
    await audio.play();
    if (version === selectionVersion && source === audio.src) showNotice("");
  } catch (error) {
    if (
      version !== selectionVersion ||
      source !== audio.src ||
      error.name === "AbortError"
    )
      return;
    if (
      error.name === "NotSupportedError" ||
      [3, 4].includes(audio.error?.code)
    ) {
      await useStreamingCopy(version);
      return;
    }
    playbackRequested = false;
    setPlaybackBusy(false);
    setPlaybackState();
    showNotice(
      error.name === "NotAllowedError"
        ? "Tap play to continue."
        : "Playback stopped. Try play again.",
    );
  }
}

async function useStreamingCopy(version = selectionVersion) {
  if (version !== selectionVersion || !selected || fallbackLoading) return;
  if (usingFallback) {
    playbackRequested = false;
    setPlaybackBusy(false);
    setPlaybackState();
    showNotice("Audio could not play. Download the file to listen.");
    return;
  }
  fallbackLoading = true;
  usingFallback = true;
  pendingSeek = pendingSeek ?? audio.currentTime ?? 0;
  audio.pause();
  setPlaybackBusy(true);
  setPlaybackState();
  const controller = new AbortController();
  fallbackController = controller;
  try {
    const result = await requestPlaybackCopy(
      selected.streaming,
      controller.signal,
    );
    if (version !== selectionVersion) return;
    fallbackLoading = false;
    audio.src = result.url;
    audio.load();
    if (playbackRequested) await playSelected(version);
    else setPlaybackBusy(false);
  } catch (error) {
    if (version !== selectionVersion || error.name === "AbortError") return;
    fallbackLoading = false;
    usingFallback = false;
    playbackRequested = false;
    setPlaybackBusy(false);
    setPlaybackState();
    showNotice("Audio could not load. Try again or download the file.");
  }
}

elements.play.innerHTML = playIcon;

function time(value) {
  value = Math.max(0, Math.floor(value || 0));
  return value >= 3600
    ? `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function size(value) {
  return value >= 1e9
    ? `${(value / 1e9).toFixed(2)} GB`
    : `${(value / 1e6).toFixed(1)} MB`;
}

function showNotice(message, kind = "playback") {
  elements.notice.textContent = message;
  elements.notice.dataset.kind = message ? kind : "";
  elements.notice.hidden = !message;
}

function setPlaybackState() {
  const playing = playbackRequested || (!audio.paused && !audio.ended);
  for (const button of [elements.play, elements["mini-play"]]) {
    button.innerHTML = playing ? pauseIcon : playIcon;
    button.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  elements["mini-player"].classList.toggle("is-playing", playing);
  updateLibraryPlaybackState();
}

function setPlaybackBusy(busy) {
  for (const button of [elements.play, elements["mini-play"]]) {
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }
}

function pausePlayback() {
  playbackRequested = false;
  audio.pause();
  savePlaybackSession();
  setPlaybackBusy(false);
  setPlaybackState();
  updateMediaSessionState();
}

async function resumePlayback() {
  if (!selected) return;
  playbackRequested = true;
  setPlaybackState();
  if (fallbackLoading) {
    setPlaybackBusy(true);
    return;
  }
  if (audio.error && usingFallback) {
    usingFallback = false;
    await useStreamingCopy(selectionVersion);
    return;
  }
  await playSelected(selectionVersion);
}

for (const button of [elements.play, elements["mini-play"]]) {
  button.addEventListener("click", () => {
    if (playbackRequested || !audio.paused) pausePlayback();
    else resumePlayback();
  });
}

function previewSeekFromControl(event) {
  const duration = Number.isFinite(audio.duration)
    ? audio.duration
    : selected?.duration || 0;
  if (!duration) return;
  seekPreview = {
    control: event.currentTarget,
    position: (Number(event.currentTarget.value) / 1000) * duration,
    selectionVersion,
  };
  updatePosition();
}

function commitSeekFromControl(event) {
  if (!seekPreview || seekPreview.control !== event.currentTarget) return;
  const preview = seekPreview;
  seekPreview = null;
  if (preview.selectionVersion === selectionVersion) seekPlayback(preview.position);
  else updatePosition();
}

function cancelSeekPreview() {
  if (!seekPreview) return;
  seekPreview = null;
  updatePosition();
}

for (const control of [elements.seek, elements["mini-seek"]]) {
  control.addEventListener("input", previewSeekFromControl);
  control.addEventListener("change", commitSeekFromControl);
  control.addEventListener("pointerup", commitSeekFromControl);
  control.addEventListener("pointercancel", cancelSeekPreview);
  control.addEventListener("blur", cancelSeekPreview);
}

// Touch range inputs move only when their small thumb is dragged. The mini seeker instead
// follows the finger from anywhere on its bar and commits on release, like the waveform.
const miniSeek = elements["mini-seek"];
miniSeek.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
miniSeek.addEventListener("pointerdown", (event) => {
  if (miniSeek.disabled || event.pointerType === "mouse") return;
  miniSeek.setPointerCapture(event.pointerId);
  const follow = (pointerEvent) => {
    const bounds = miniSeek.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (pointerEvent.clientX - bounds.left) / bounds.width));
    miniSeek.value = String(Math.round(fraction * Number(miniSeek.max)));
    miniSeek.dispatchEvent(new Event("input"));
  };
  const finish = () => {
    miniSeek.removeEventListener("pointermove", follow);
    miniSeek.removeEventListener("pointerup", finish);
    miniSeek.removeEventListener("pointercancel", finish);
  };
  follow(event);
  miniSeek.addEventListener("pointermove", follow);
  miniSeek.addEventListener("pointerup", finish);
  miniSeek.addEventListener("pointercancel", finish);
});

function applyVolume() {
  audio.volume = volumeLevel;
  audio.muted = volumeMuted;
  const silent = volumeMuted || volumeLevel === 0;
  elements.mute.setAttribute("aria-label", silent ? "Unmute" : "Mute");
  elements.mute.setAttribute("aria-pressed", String(silent));
  elements.volume.value = volumeMuted ? 0 : volumeLevel;
  elements.mute.innerHTML = silent
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
}

elements.volume.addEventListener("input", () => {
  volumeLevel = Number(elements.volume.value);
  volumeMuted = false;
  applyVolume();
});

elements.mute.addEventListener("click", () => {
  if (volumeLevel === 0) {
    volumeLevel = 1;
    volumeMuted = false;
  } else volumeMuted = !volumeMuted;
  applyVolume();
});

audio.addEventListener("loadedmetadata", () => {
  if (!sourceIsCurrent()) return;
  elements.seek.disabled = !Number.isFinite(audio.duration);
  elements["mini-seek"].disabled = elements.seek.disabled;
  if (pendingSeek !== null && Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(pendingSeek, audio.duration);
    pendingSeek = null;
  }
  updatePosition();
  updateMediaSessionPosition();
});

audio.addEventListener("timeupdate", () => {
  updatePosition();
  updateMediaSessionPosition();
});
audio.addEventListener("play", () => {
  if (!sourceIsCurrent()) return;
  playbackRequested = true;
  setPlaybackState();
  document.querySelector(".player").classList.add("is-playing");
  startVisualizer();
  updateMediaSessionState();
});
audio.addEventListener("pause", () => {
  if (!fallbackLoading && !audio.error && audio.paused)
    playbackRequested = false;
  setPlaybackBusy(false);
  setPlaybackState();
  document.querySelector(".player").classList.remove("is-playing");
  stopVisualizer();
  updateMediaSessionState();
  if (!fallbackLoading && audio.paused && sourceIsCurrent()) savePlaybackSession();
});
audio.addEventListener("ended", () => {
  if (!sourceIsCurrent() || !audio.ended) return;
  playbackRequested = false;
  const shouldAdvance = queuedTracks().length > 0 || prefersPlaybackCopy;
  if (!shouldAdvance || !nextPlaybackTrack(true, false)) {
    setPlaybackState();
    updateMediaSessionState();
  }
});

audio.addEventListener("waiting", () => {
  if (!audio.paused) {
    setPlaybackBusy(true);
  }
});
audio.addEventListener("playing", () => {
  setPlaybackBusy(false);
  setPlaybackState();
});

audio.addEventListener("error", () => {
  if (!sourceIsCurrent()) return;
  if ([3, 4].includes(audio.error?.code)) {
    useStreamingCopy(selectionVersion);
    return;
  }
  playbackRequested = false;
  setPlaybackBusy(false);
  setPlaybackState();
  showNotice("Audio could not load. Reload the page to try again.");
});

// iOS Safari applies :active only when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });
