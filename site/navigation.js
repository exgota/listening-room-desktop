let currentView = ["/", "/library"].includes(location.pathname) ? "library" : "player";

function updateRoute(historyMode) {
  if (historyMode === "none") return;
  const path = currentView === "library" ? "/library" : selected?.link || "/";
  const replace = historyMode === "replace" || location.pathname === path;
  history[replace ? "replaceState" : "pushState"](
    { trackIdentifier: selected?.identifier }, "", path,
  );
}

function renderCurrentView(focus = false) {
  const libraryVisible = currentView === "library";
  cancelSeekPreview();
  if (elements.notice.dataset.kind === "route" &&
      (libraryVisible || location.pathname === "/" || requestedIdentifier() === selected?.identifier))
    showNotice("");
  elements["player-view"].hidden = libraryVisible;
  elements["library-view"].hidden = !libraryVisible;
  elements["player-link"].hidden = !libraryVisible || !selected;
  if (selected) elements["player-link"].href = selected.link;
  document.title = libraryVisible
    ? "Library · Listening room"
    : selected
      ? `${selected.title}${selected.artist ? ` · ${selected.artist}` : ""}${selected.remix ? ` (${selected.remix})` : ""}`
      : "Listening room";
  if (audio.paused) stopVisualizer();
  else startVisualizer();
  updatePosition();
  if (focus) {
    (libraryVisible ? elements["library-title"] : elements.title).focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function followNavigation(event, action) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  action();
}

function openTrack(track) {
  currentView = "player";
  selectTrack(track);
  renderCurrentView(true);
}

elements["library-link"].addEventListener("click", (event) => followNavigation(event, () => {
  currentView = "library";
  updateRoute("push");
  renderCurrentView(true);
}));
for (const link of [elements["player-link"], elements["mini-return"]]) {
  link.addEventListener("click", (event) => followNavigation(event, () => {
    if (selected) openTrack(selected);
  }));
}

function selectTrack(
  track,
  historyMode = "push",
  continuePlayback = playbackRequested || !audio.paused,
  options = {},
) {
  seekPreview = null;
  if (selected && (selected.identifier !== track.identifier || options.restart))
    savePlaybackSession();
  recordTrackSelection(track, options);
  if (selected?.identifier === track.identifier) {
    if (options.restart) {
      seekPlayback(0);
      if (continuePlayback) resumePlayback();
      else pausePlayback();
      savePlaybackSession();
    }
    updatePlaybackNavigation();
    updateRoute(historyMode);
    renderCurrentView();
    return;
  }
  selectionVersion++;
  fallbackController?.abort();
  fallbackController = null;
  playbackRequested = false;
  fallbackLoading = false;
  usingFallback = prefersPlaybackCopy && Boolean(track.playback_url);
  audio.pause();
  selected = track;
  pendingSeek = options.position ?? 0;
  showNotice("");
  audio.src = usingFallback ? track.playback_url : track.url;
  audio.load();
  setPlaybackBusy(false);
  elements.title.textContent = track.title;
  elements.title.setAttribute("aria-label", track.title);
  // The player names the original artist only; the library keeps the full credit.
  elements.credits.textContent = track.artist || track.remix || "";
  elements["file-meta"].textContent = size(track.size);
  elements.quality.textContent = track.quality || "Original audio";
  elements.download.href = track.url + "?download=1";
  elements.download.setAttribute("download", track.name);
  elements["download-label"].textContent = "Download";
  elements.duration.textContent = time(track.duration);
  elements.play.disabled = false;
  elements["mini-play"].disabled = false;
  elements.seek.disabled = true;
  elements["mini-seek"].disabled = true;
  elements.position.textContent = "0:00";
  elements.seek.value = 0;
  elements.cursor.style.left = "0%";
  elements["mini-title"].textContent = track.title;
  elements["mini-credits"].textContent = track.artist || track.remix || "";
  elements["mini-return"].href = track.link;
  elements["mini-return"].setAttribute("aria-label", `Return to ${track.title}`);
  setPlaybackState();
  updateRoute(historyMode);
  setMediaSessionTrack(track);
  prepareVisualizer(track, selectionVersion);
  updateLibraryPlaybackState();
  renderCurrentView();
  if (!usingFallback && !audio.canPlayType(track.mime))
    useStreamingCopy(selectionVersion);
  if (continuePlayback) resumePlayback();
  savePlaybackSession();
}

async function loadTracks() {
  try {
    tracks = await requestTracks();
    elements.empty.querySelector("h1").textContent = "Nothing here yet.";
    elements.empty.querySelector("p").textContent = "";
    elements.empty.hidden = tracks.length > 0;
    elements.content.hidden = tracks.length === 0;
    renderLibrary();
    if (tracks.length) {
      const session = readPlaybackSession();
      const sharedTrack = location.pathname.startsWith("/track/");
      const requested = requestedIdentifier();
      const identifier = sharedTrack ? requested : session?.trackIdentifier ||
        (currentView === "library" ? history.state?.trackIdentifier : null);
      const track =
        tracks.find((value) => value.identifier === identifier) || tracks[0];
      const missingTrack =
        sharedTrack && requested !== track.identifier;
      const position = !missingTrack && session?.trackIdentifier === track.identifier
        ? Math.min(session.position, track.duration) : 0;
      selectTrack(track, location.pathname === "/" ? "none" : "replace", false, { position });
      if (missingTrack) showNotice("That file is no longer shared.", "route");
    } else {
      audio.pause();
      selected = null;
      document.title = "Listening room";
    }
  } catch (error) {
    elements.empty.hidden = false;
    elements.empty.querySelector("h1").textContent = "This room is offline.";
    elements.empty.querySelector("p").textContent =
      "Reload the page to try again.";
    elements.content.hidden = true;
  }
}

window.addEventListener("popstate", () => {
  currentView = ["/", "/library"].includes(location.pathname) ? "library" : "player";
  if (currentView === "library") {
    renderCurrentView(true);
    return;
  }
  const track =
    tracks.find((value) => value.identifier === requestedIdentifier()) ||
    tracks[0];
  if (track && track !== selected) selectTrack(track, "none");
  renderCurrentView(true);
  if (location.pathname.startsWith("/track/") && requestedIdentifier() !== track?.identifier)
    showNotice("That file is no longer shared.", "route");
});

const playerResizeObserver = new ResizeObserver(() => {
  drawWaveform();
  drawVisualizer();
});
playerResizeObserver.observe(elements.waveform);
playerResizeObserver.observe(elements.visualizer);
loadTracks();
