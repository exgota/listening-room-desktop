const playbackSessionStorageKey = "listening-room.playback-session.v1";

function readPlaybackSession() {
  try {
    const session = JSON.parse(localStorage.getItem(playbackSessionStorageKey));
    if (session?.version !== 1 || !/^[a-f0-9]{24}$/.test(session.trackIdentifier) ||
        !Number.isFinite(session.position) || session.position < 0) return null;
    return session;
  } catch (error) {
    return null;
  }
}

function savePlaybackSession() {
  if (!selected) return;
  const position = playbackPosition();
  if (!Number.isFinite(position) || position < 0) return;
  try {
    localStorage.setItem(playbackSessionStorageKey, JSON.stringify({
      version: 1,
      trackIdentifier: selected.identifier,
      position: Math.min(position, selected.duration),
    }));
  } catch (error) {
    // Resume is optional when browser storage is unavailable.
  }
}

window.addEventListener("pagehide", savePlaybackSession);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) savePlaybackSession();
});
