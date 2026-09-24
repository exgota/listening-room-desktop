async function requestTracks() {
  const response = await fetch("/api/tracks", { cache: "no-store" });
  if (!response.ok) throw Error();
  return response.json();
}

async function requestPlaybackCopy(address, signal) {
  const response = await fetch(address, { signal, cache: "no-store" });
  if (!response.ok) throw Error();
  return response.json();
}

async function requestBandAnalysis(address, signal) {
  const response = await fetch(address, { signal });
  if (!response.ok) throw Error("Analysis unavailable");
  const analysis = await response.json();
  if (
    analysis.version !== 1 ||
    analysis.band_count !== 40 ||
    !Number.isInteger(analysis.frame_count) ||
    analysis.frame_count < 1 ||
    !(analysis.frame_rate > 0)
  )
    throw Error("Invalid analysis");
  const samples = Uint8Array.from(atob(analysis.data), (character) =>
    character.charCodeAt(0),
  );
  if (samples.length !== analysis.frame_count * 40)
    throw Error("Incomplete analysis");
  const envelopes = {};
  for (const name of ["energy", "bass", "onset"]) {
    const values = Uint8Array.from(atob(analysis[name]), (character) =>
      character.charCodeAt(0),
    );
    if (values.length !== analysis.frame_count)
      throw Error("Incomplete analysis envelope");
    envelopes[name] = values;
  }
  return { ...analysis, samples, envelopes };
}
