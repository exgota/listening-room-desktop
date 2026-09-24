const savedTracksStorageKey = "listening-room.saved-tracks.v1";
let savedTrackIdentifiers = readSavedTracks();
let libraryFilter = "all";
let librarySelecting = false;
const selectedTrackIdentifiers = new Set();

function readSavedTracks() {
  try {
    const identifiers = JSON.parse(localStorage.getItem(savedTracksStorageKey) || "[]");
    return new Set(Array.isArray(identifiers)
      ? identifiers.filter((identifier) => /^[a-f0-9]{24}$/.test(identifier)) : []);
  } catch (error) {
    return new Set();
  }
}

function normalizedSearch(value) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

function visibleLibraryTracks() {
  const words = normalizedSearch(elements["library-search"].value).trim().split(/\s+/).filter(Boolean);
  return tracks.filter((track) => {
    if (libraryFilter === "saved" && !savedTrackIdentifiers.has(track.identifier)) return false;
    const text = normalizedSearch([track.title, track.artist, track.remix].filter(Boolean).join(" "));
    return words.every((word) => text.includes(word));
  });
}

function updateLibraryPlaybackState() {
  for (const row of elements["library-track-list"].children) {
    const current = row.dataset.identifier === selected?.identifier;
    row.querySelector(".library-track-link").setAttribute("aria-current", String(current));
    row.querySelector(".library-current-indicator").hidden = !current || audio.paused || audio.ended;
  }
}

function updateLibrarySelection() {
  const visible = visibleLibraryTracks();
  const chosen = tracks.filter((track) => selectedTrackIdentifiers.has(track.identifier));
  elements["library-selection-count"].textContent = librarySelecting ? `${chosen.length} selected` : "";
  elements["library-select"].textContent = librarySelecting ? "Cancel" : "Select";
  elements["library-select"].disabled = !librarySelecting && visible.length === 0;
  elements["library-select-all"].hidden = !librarySelecting || visible.length === 0;
  elements["library-select-all"].textContent = visible.length && visible.every((track) => selectedTrackIdentifiers.has(track.identifier))
    ? "Deselect all" : "Select all";
  elements["library-download"].hidden = chosen.length === 0;
  elements["library-download-error"].hidden = true;
  if (!chosen.length) {
    elements["library-download-link"].removeAttribute("href");
    return;
  }
  const link = elements["library-download-link"];
  if (chosen.length === 1) {
    link.href = chosen[0].url + "?download=1";
    link.download = chosen[0].name;
  } else {
    const parameters = new URLSearchParams();
    for (const track of chosen) parameters.append("track", track.identifier);
    link.href = `/download?${parameters}`;
    link.download = "listening-room.zip";
  }
  elements["library-download-label"].textContent = `Download ${chosen.length} ${chosen.length === 1 ? "track" : "tracks"}`;
  elements["library-download-size"].textContent = size(chosen.reduce((total, track) => total + track.size, 0));
}

// The server refuses an archive before sending any bytes, so a HEAD request finds the
// reason first. Following a link that answers with an error would save the error as a zip.
elements["library-download-link"].addEventListener("click", async (event) => {
  const link = elements["library-download-link"];
  if (!link.getAttribute("href")?.startsWith("/download?")) return;
  event.preventDefault();
  const address = link.href;
  let message = "";
  try {
    const response = await fetch(address, { method: "HEAD", cache: "no-store" });
    if (!response.ok)
      message = response.status === 404
        ? "A selected track is no longer available. Reload the library."
        : response.status === 413
          ? "This download is too large. Select fewer tracks."
          : "These tracks could not be combined. Reload the library and try again.";
  } catch (error) {
    message = "The download could not start. Check the connection and try again.";
  }
  if (link.href !== address) return;
  elements["library-download-error"].textContent = message;
  elements["library-download-error"].hidden = !message;
  if (!message) location.assign(address);
});

// Choosing a row plays it without leaving the library. The mini-player opens the full player.
function playTrackInLibrary(track) {
  if (selected?.identifier !== track.identifier) selectTrack(track, "replace", true);
  else if (!playbackRequested && audio.paused) resumePlayback();
}

function toggleSavedTrack(track) {
  if (savedTrackIdentifiers.has(track.identifier)) savedTrackIdentifiers.delete(track.identifier);
  else savedTrackIdentifiers.add(track.identifier);
  try {
    localStorage.setItem(savedTracksStorageKey, JSON.stringify([...savedTrackIdentifiers]));
    elements["library-storage-notice"].hidden = true;
  } catch (error) {
    elements["library-storage-notice"].textContent = "Saved for this visit. Browser storage is unavailable.";
    elements["library-storage-notice"].hidden = false;
  }
  renderLibrary();
}

function renderLibrary() {
  const focusedElement = document.activeElement;
  const focusedRow = focusedElement?.closest(".library-track");
  const focusedIdentifier = focusedRow?.dataset.identifier;
  const focusedControl = focusedElement?.matches("input[type=checkbox]")
    ? "input" : focusedElement?.matches(".library-save") ? ".library-save"
      : focusedElement?.matches(".library-play-next") ? ".library-play-next" : ".library-track-link";
  const visible = visibleLibraryTracks();
  const visibleIdentifiers = new Set(visible.map((track) => track.identifier));
  for (const identifier of selectedTrackIdentifiers)
    if (!visibleIdentifiers.has(identifier)) selectedTrackIdentifiers.delete(identifier);
  elements["library-track-list"].replaceChildren();
  for (const track of visible) {
    const row = document.createElement("div");
    row.className = "library-track";
    row.dataset.identifier = track.identifier;
    const link = document.createElement(librarySelecting ? "label" : "a");
    link.className = "library-track-link";
    if (librarySelecting) {
      const control = document.createElement("label");
      control.className = "library-selection-control";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `library-selection-${track.identifier}`;
      checkbox.setAttribute("aria-label", `Select ${track.title}`);
      checkbox.checked = selectedTrackIdentifiers.has(track.identifier);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedTrackIdentifiers.add(track.identifier);
        else selectedTrackIdentifiers.delete(track.identifier);
        updateLibrarySelection();
      });
      const mark = document.createElement("span");
      mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      control.append(checkbox, mark);
      row.append(control);
      link.htmlFor = checkbox.id;
    } else {
      link.href = track.link;
      link.addEventListener("click", (event) => followNavigation(event, () => playTrackInLibrary(track)));
    }
    const description = document.createElement("span");
    description.className = "track-description";
    const heading = document.createElement("span");
    heading.className = "library-track-heading";
    const title = document.createElement("span");
    title.textContent = track.title;
    const indicator = document.createElement("span");
    indicator.className = "library-current-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4"/></svg>';
    heading.append(title, indicator);
    const credits = document.createElement("small");
    credits.className = "track-credits";
    credits.textContent = [track.artist, track.remix].filter(Boolean).join(" · ");
    description.append(heading, credits);
    const detail = document.createElement("span");
    detail.className = "track-detail";
    detail.textContent = time(track.duration);
    link.append(description, detail);
    row.append(link);
    if (!librarySelecting) {
      const actions = document.createElement("span");
      actions.className = "library-track-actions";
      const playNext = document.createElement("button");
      playNext.className = "library-play-next icon-button";
      playNext.setAttribute("aria-label", `Play ${track.title} next`);
      playNext.title = "Play next";
      playNext.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h9M4 18h9m5-7v10m-5-5h10"/></svg>';
      playNext.addEventListener("click", () => queueTrackNext(track));
      const save = document.createElement("button");
      save.className = "library-save";
      const saved = savedTrackIdentifiers.has(track.identifier);
      save.setAttribute("aria-label", saved ? `Remove ${track.title} from saved` : `Save ${track.title}`);
      save.setAttribute("aria-pressed", String(saved));
      save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z"/></svg>';
      save.addEventListener("click", () => toggleSavedTrack(track));
      actions.append(playNext, save);
      row.append(actions);
    }
    elements["library-track-list"].append(row);
  }
  elements["library-empty"].hidden = visible.length > 0;
  elements["library-empty"].textContent = elements["library-search"].value.trim()
    ? "No tracks found."
    : libraryFilter === "saved" ? "No saved tracks yet. Use the bookmark beside a track to save it." : "No tracks yet.";
  updateLibraryPlaybackState();
  updateLibrarySelection();
  if (focusedIdentifier) {
    const replacement = elements["library-track-list"].querySelector(`[data-identifier="${focusedIdentifier}"] ${focusedControl}`);
    (replacement || elements[`library-${libraryFilter}`]).focus({ preventScroll: true });
  }
}

function setLibraryFilter(filter) {
  libraryFilter = filter;
  selectedTrackIdentifiers.clear();
  for (const name of ["all", "saved"]) {
    const button = elements[`library-${name}`];
    button.setAttribute("aria-selected", String(name === filter));
    button.tabIndex = name === filter ? 0 : -1;
  }
  elements["library-results"].setAttribute("aria-labelledby", `library-${filter}`);
  renderLibrary();
}

for (const filter of ["all", "saved"]) {
  elements[`library-${filter}`].addEventListener("click", () => setLibraryFilter(filter));
  elements[`library-${filter}`].addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "all" : event.key === "End" ? "saved" : filter === "all" ? "saved" : "all";
    setLibraryFilter(next);
    elements[`library-${next}`].focus();
  });
}
elements["library-search"].addEventListener("input", () => {
  selectedTrackIdentifiers.clear();
  renderLibrary();
});
elements["library-select"].addEventListener("click", () => {
  librarySelecting = !librarySelecting;
  selectedTrackIdentifiers.clear();
  renderLibrary();
});
elements["library-select-all"].addEventListener("click", () => {
  const visible = visibleLibraryTracks();
  const allSelected = visible.every((track) => selectedTrackIdentifiers.has(track.identifier));
  for (const track of visible) {
    if (allSelected) selectedTrackIdentifiers.delete(track.identifier);
    else selectedTrackIdentifiers.add(track.identifier);
  }
  renderLibrary();
});
window.addEventListener("storage", (event) => {
  if (event.key !== savedTracksStorageKey && event.key !== null) return;
  savedTrackIdentifiers = readSavedTracks();
  renderLibrary();
});
