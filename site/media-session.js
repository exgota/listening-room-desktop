let mediaSessionNavigation = "";

function setMediaSessionNavigation(canGoBack, canGoNext) {
  if (!navigator.mediaSession) return;
  const availability = `${canGoBack}:${canGoNext}`;
  if (availability === mediaSessionNavigation) return;
  mediaSessionNavigation = availability;
  for (const [action, handler] of [
    ["previoustrack", canGoBack ? previousPlaybackTrack : null],
    ["nexttrack", canGoNext ? () => nextPlaybackTrack() : null],
  ]) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {}
  }
}

function setMediaSessionTrack(track) {
  updatePlaybackNavigation();
  if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || "",
    album: track.remix || "",
    artwork: [512, 1024].map((size) => ({
      src: new URL(`/artwork/cover-${size}.png?v=1`, location.origin).href,
      sizes: `${size}x${size}`,
      type: "image/png",
    })),
  });
  const actions = {
    play: resumePlayback,
    pause: pausePlayback,
    seekto: (detail) => seekPlayback(detail.seekTime),
    seekbackward: (detail) =>
      seekPlayback(audio.currentTime - (detail.seekOffset || 10)),
    seekforward: (detail) =>
      seekPlayback(audio.currentTime + (detail.seekOffset || 10)),
  };
  for (const [action, handler] of Object.entries(actions)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {}
  }
  updateMediaSessionState();
}

function seekPlayback(position) {
  if (!selected || !Number.isFinite(position)) return;
  seekPreview = null;
  const duration = Number.isFinite(audio.duration) ? audio.duration : selected.duration;
  pendingSeek = Math.max(0, Math.min(position, duration));
  if (!fallbackLoading && sourceIsCurrent() && Number.isFinite(audio.duration)) {
    visualizerSeekStarted();
    audio.currentTime = pendingSeek;
    pendingSeek = null;
  }
  updatePosition();
  updateMediaSessionPosition();
}

function updateMediaSessionState() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
}

function updateMediaSessionPosition() {
  if (
    !navigator.mediaSession?.setPositionState ||
    !Number.isFinite(audio.duration) ||
    audio.duration <= 0
  )
    return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch (error) {}
}
