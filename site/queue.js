const playbackQueue = [];
const playbackHistory = [];

// Manual track changes wrap around the library; the end of a song does not.
function adjacentTrack(offset, wrap = true) {
  const position = tracks.findIndex((track) => track.identifier === selected?.identifier);
  if (wrap && position >= 0 && tracks.length > 1)
    return tracks[(position + offset + tracks.length) % tracks.length];
  return tracks[position + offset] || null;
}

function playbackPosition() {
  return pendingSeek ?? audio.currentTime ?? 0;
}

function queuedTracks() {
  return playbackQueue.map((identifier) => tracks.find((track) => track.identifier === identifier))
    .filter(Boolean);
}

function previousTrackCandidate() {
  for (let index = playbackHistory.length - 1; index >= 0; index--) {
    const track = tracks.find((entry) => entry.identifier === playbackHistory[index]);
    if (track) return track;
  }
  return adjacentTrack(-1);
}

function recordTrackSelection(track, options = {}) {
  if (selected && options.recordHistory !== false &&
      (selected.identifier !== track.identifier || options.restart)) {
    playbackHistory.push(selected.identifier);
  }
}

function queueTrackNext(track) {
  playbackQueue.unshift(track.identifier);
  elements["queue-status"].textContent = `${track.title} will play next.`;
  updatePlaybackNavigation();
}

function nextPlaybackTrack(continuePlayback = playbackRequested || !audio.paused, wrap = true) {
  let track = null;
  while (playbackQueue.length && !track) {
    const identifier = playbackQueue.shift();
    track = tracks.find((entry) => entry.identifier === identifier);
  }
  if (track) selectTrack(track, "replace", continuePlayback, { restart: true });
  else {
    track = adjacentTrack(1, wrap);
    if (track) selectTrack(track, "replace", continuePlayback);
  }
  updatePlaybackNavigation();
  return Boolean(track);
}

function previousPlaybackTrack() {
  if (playbackPosition() > 3) {
    seekPlayback(0);
    return;
  }
  let track = null;
  while (playbackHistory.length && !track) {
    const identifier = playbackHistory.pop();
    track = tracks.find((entry) => entry.identifier === identifier);
  }
  track ||= adjacentTrack(-1);
  if (track) selectTrack(track, "replace", playbackRequested || !audio.paused,
    { recordHistory: false, restart: true });
}

function updateTrackControls() {
  const canGoBack = Boolean(selected && (playbackPosition() > 3 || previousTrackCandidate()));
  const canGoNext = Boolean(queuedTracks().length || adjacentTrack(1));
  elements["previous-track"].disabled = !canGoBack;
  elements["next-track"].disabled = !canGoNext;
  setMediaSessionNavigation(canGoBack, canGoNext);
}

function updatePlaybackNavigation() {
  updateTrackControls();
  renderQueue();
}

function renderQueue() {
  const entries = queuedTracks();
  elements["queue-count"].textContent = entries.length ? String(entries.length) : "";
  elements["mini-queue"].setAttribute("aria-label",
    entries.length ? `Open queue, ${entries.length} ${entries.length === 1 ? "track" : "tracks"}` : "Open queue");
  elements["queue-empty"].hidden = entries.length > 0;
  elements["queue-clear"].hidden = entries.length === 0;
  elements["queue-list"].replaceChildren();
  playbackQueue.forEach((identifier, index) => {
    const track = tracks.find((entry) => entry.identifier === identifier);
    if (!track) return;
    const row = document.createElement("li");
    const description = document.createElement("span");
    const title = document.createElement("span");
    title.className = "queue-track-title";
    title.textContent = track.title;
    const credits = document.createElement("span");
    credits.className = "queue-track-credits";
    credits.textContent = [track.artist, track.remix].filter(Boolean).join(" · ");
    description.append(title, credits);
    const remove = document.createElement("button");
    remove.className = "icon-button queue-remove";
    remove.setAttribute("aria-label", `Remove ${track.title} from queue`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    remove.addEventListener("click", () => {
      playbackQueue.splice(index, 1);
      updatePlaybackNavigation();
      const remaining = elements["queue-list"].querySelectorAll("button");
      (remaining[Math.min(index, remaining.length - 1)] || elements["queue-close"]).focus();
    });
    row.append(description, remove);
    elements["queue-list"].append(row);
  });
  const lastTrack = entries.at(-1) || selected;
  const lastIndex = tracks.findIndex((track) => track.identifier === lastTrack?.identifier);
  const next = tracks[lastIndex + 1];
  elements["queue-library"].hidden = !next;
  elements["queue-library-title"].textContent = next?.title || "";
}

elements["previous-track"].addEventListener("click", previousPlaybackTrack);
elements["next-track"].addEventListener("click", () => nextPlaybackTrack());
elements["mini-queue"].addEventListener("click", () => {
  renderQueue();
  elements["queue-dialog"].showModal();
});
elements["queue-close"].addEventListener("click", () => elements["queue-dialog"].close());
elements["queue-dialog"].addEventListener("click", (event) => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
});
elements["queue-dialog"].addEventListener("close", () => elements["mini-queue"].focus());
elements["queue-clear"].addEventListener("click", () => {
  playbackQueue.length = 0;
  updatePlaybackNavigation();
  elements["queue-close"].focus();
});
