// Plate: Chladni figures. One square plate stands in the middle of the sheet and sand lies
// on its nodal lines. Each song has its own family of figures (rings for NBLY, hourglass
// bands for Desire, pills for Ophelia, a ruled grid for Outside, columns for American Boy),
// and a figure of its own that only its drops land on. The harmony chooses the figure from
// the family and it re-forms at most once a bar, holding while the voice sings; the voice
// is a second sand, vermilion, one figure per sung phrase; the key word is the one set of
// concentric rings. The bass sets the lines' weight (heavy while a bass note sounds, with a
// release); the kick strikes the plate: it darkens, the striker at its centre jumps and a
// wave runs out to the rim; the snare slaps the plate's frame; the hats tick along its top
// edge at their place in the bar. Sections change the plate: a breakdown clears it to a bare
// X (the only X), a chord passage inverts it, a build contracts the figure bar by bar into
// the centre, the gap shrinks that knot beat by beat, and the drop throws it out into the
// song's drop figure on the exact frame. At the song's turn the sheet goes vermilion, and
// later sections alternate vermilion and ink; the outro drains the sand to the bare knot.
// Every grain is placed in the vertex shader from song time alone: its fixed seed position
// is projected onto the current figure's nodal lines by Newton steps, so a seek anywhere
// lands on the right picture and nothing accumulates.

const plateGrains = 196608; // 384 x 512
const plateVoiceGrains = 65536;

const plateVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeed;
uniform vec4 uModeA;     // figure the sand is leaving: n1 m1 n2 m2 (n1 < 0: rings, m1 of them)
uniform vec4 uModeB;     // figure it is moving to
uniform vec4 uMix;       // x weight of the second mode (A), y (B), z settle 0..1, w symmetry (B)
uniform float uSignA;    // symmetry of figure A
uniform float uScale;    // pattern units per plate half-side
uniform vec4 uRect;      // plate in clip space: x0 y0 x1 y1
uniform vec4 uGather;    // x pull to the centre 0..1, y knot radius, z present 0..1, w line weight
uniform vec4 uRipple[4]; // x age s, y strength, z speed, w unused
uniform float uPointSize;
uniform float uDrain;    // 0..1: the share of grains gone (the outro)
out float vAlpha;
out float vShade;

const float PI = 3.14159265;

// A Chladni figure: two plate modes mixed with a symmetry s (s = 1 gives the diagonals,
// s = -1 closed rings, s = 0 a ruled grid), plus a second pair for character. A negative
// first number means concentric rings instead.
float field(vec2 p, vec4 mode, float second, float s) {
  if (mode.x < 0.0) return cos(mode.y * PI * length(p));
  vec2 a = PI * p;
  float first = cos(mode.x * a.x) * cos(mode.y * a.y) - s * cos(mode.y * a.x) * cos(mode.x * a.y);
  float extra = cos(mode.z * a.x) * cos(mode.w * a.y) - s * cos(mode.w * a.x) * cos(mode.z * a.y);
  return first + second * extra;
}

vec2 gradient(vec2 p, vec4 mode, float second, float s) {
  if (mode.x < 0.0) {
    float r = max(length(p), 1e-4);
    return -mode.y * PI * sin(mode.y * PI * r) * p / r;
  }
  vec2 a = PI * p;
  float n = mode.x, m = mode.y;
  vec2 g1 = PI * vec2(
    -n * sin(n * a.x) * cos(m * a.y) + s * m * sin(m * a.x) * cos(n * a.y),
    -m * cos(n * a.x) * sin(m * a.y) + s * n * cos(m * a.x) * sin(n * a.y));
  n = mode.z; m = mode.w;
  vec2 g2 = PI * vec2(
    -n * sin(n * a.x) * cos(m * a.y) + s * m * sin(m * a.x) * cos(n * a.y),
    -m * cos(n * a.x) * sin(m * a.y) + s * n * cos(m * a.x) * sin(n * a.y));
  return g1 + second * g2;
}

// Newton steps onto f = 0, each clamped so a grain moves to a nearby line, never far.
vec2 settle(vec2 p, vec4 mode, float second, float s, out float residual) {
  for (int i = 0; i < 7; i++) {
    float f = field(p, mode, second, s);
    vec2 g = gradient(p, mode, second, s);
    vec2 step = f * g / (dot(g, g) + 1e-3);
    float len = length(step);
    if (len > 0.03) step *= 0.03 / len;
    p -= step;
  }
  float f = field(p, mode, second, s);
  residual = abs(f) / (length(gradient(p, mode, second, s)) + 1e-3);
  return p;
}

void main() {
  // Pattern space is centred on the plate's centre (where the striker hits and the knot
  // gathers), so every figure is symmetric about it.
  vec2 home = (aSeed.xy * 2.0 - 1.0) * uScale;
  float r1, r2;
  vec2 a = settle(home, uModeA, uMix.x, uSignA, r1);
  vec2 b = settle(home, uModeB, uMix.y, uMix.w, r2);
  // A re-form is a dissolve: each grain leaves the old figure's line for the new one's at its
  // own moment, so every frame shows clean lines (no grains in flight across the plate).
  float s = uMix.z;
  bool onB = fract(aSeed.w * 13.37 + aSeed.x * 7.13 + aSeed.y * 3.71) < s;
  vec2 p = onB ? b : a;
  float residual = onB ? r2 : r1;
  // Line weight: each grain sits off the line by its own amount.
  vec2 grad = onB ? gradient(p, uModeB, uMix.y, uMix.w) : gradient(p, uModeA, uMix.x, uSignA);
  vec2 normal = length(grad) > 1e-4 ? normalize(grad) : vec2(0.0, 1.0);
  p += normal * (aSeed.z - 0.5) * uGather.w;

  vec2 q = p / uScale; // -1..1 across the plate
  // Kick: a wave runs out from the centre to the rim and throws the sand it passes outward.
  for (int i = 0; i < 4; i++) {
    vec4 ripple = uRipple[i];
    if (ripple.y <= 0.0) continue;
    float radius = ripple.x * ripple.z;
    float distance = length(q);
    float band = exp(-pow((distance - radius) / 0.14, 2.0));
    float fade = exp(-ripple.x / 0.5);
    q += (distance > 1e-4 ? q / distance : vec2(0.0)) * band * ripple.y * fade * 0.075;
  }
  // Gather: the figure contracts toward the centre; fully gathered it is a knot of the given
  // radius.
  vec2 knot = vec2(cos(aSeed.w * 6.2831853), sin(aSeed.w * 6.2831853)) * sqrt(aSeed.z) * uGather.y;
  q *= 1.0 - 0.8 * uGather.x;
  q = mix(q, knot, smoothstep(0.9, 1.0, uGather.x));
  // Nothing leaves the plate.
  float outside = step(1.0, max(abs(q.x), abs(q.y)));
  q = clamp(q, -1.0, 1.0);

  vec2 clip = mix(uRect.xy, uRect.zw, q * 0.5 + 0.5);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPointSize * (0.75 + 0.5 * aSeed.w);
  // grains that did not reach a line are faint (real sand leaves the antinodes empty) until
  // the knot closes
  float onLine = 1.0 - smoothstep(0.004, 0.02, residual);
  float drained = step(uDrain, fract(aSeed.w * 7.31 + aSeed.x * 3.17));
  vAlpha = mix(onLine, 1.0, smoothstep(0.9, 1.0, uGather.x)) * uGather.z * (1.0 - outside) * drained;
  vShade = aSeed.z;
}`;

const plateFragmentShader = `#version 300 es
precision highp float;
in float vAlpha;
in float vShade;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25 || vAlpha < 0.02) discard;
  outColor = vec4(uColor * (0.9 + 0.2 * vShade), vAlpha * 0.95);
}`;

const plateGroundShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec3 uGround;
uniform vec3 uPlate;
uniform vec3 uInk;
uniform vec2 uResolution;
uniform vec4 uFrame;  // plate in uv: x0 y0 x1 y1
uniform vec2 uFlash;  // x the plate darkening (or lightening) for a kick, y the frame slap for a snare
void main() {
  vec2 px = 1.0 / uResolution;
  bool inside = vUv.x > uFrame.x && vUv.x < uFrame.z && vUv.y > uFrame.y && vUv.y < uFrame.w;
  vec3 color = inside ? uPlate * (1.0 - uFlash.x) : uGround;
  // an engraved border: a rule round the plate and a hairline outside it; a snare fills the
  // band between them
  vec2 lo = abs(vUv - uFrame.xy) / px, hi = abs(vUv - uFrame.zw) / px;
  bool within = vUv.x > uFrame.x - 16.0 * px.x && vUv.x < uFrame.z + 16.0 * px.x && vUv.y > uFrame.y - 16.0 * px.y && vUv.y < uFrame.w + 16.0 * px.y;
  float edge = min(min(lo.x, hi.x), min(lo.y, hi.y));
  if (within && edge < 2.4) color = mix(color, uInk, 0.9);
  if (within && !inside && edge > 13.0 && edge < 14.5) color = mix(color, uInk, 0.6);
  if (within && !inside && edge <= 13.0) color = mix(color, uInk, 0.9 * uFlash.y);
  // a faint darkening toward the edges of the sheet
  vec2 c = vUv - 0.5;
  color *= 1.0 - 0.05 * dot(c, c) * 2.0;
  outColor = vec4(color, 1.0);
}`;

// Each song's family of figures, simplest first, with its symmetry; the figure its drops land
// on (the first drop and the thumbnail only), its siblings for the other drops and the drop
// sections, a grander one for a main drop that is not the first; and the voice's own three
// figures [n1, m1, n2, m2, second, symmetry], no two songs alike. Figures: see
// tools/render/chladni.py.
const plateSongs = {
  "5ff86d6cd02ebd7308e03df8": { // NBLY: rings and rosettes
    s: -1,
    family: [[1, 3, 2, 3], [2, 3, 1, 4], [1, 4, 2, 5], [3, 4, 1, 2], [2, 5, 1, 3]],
    drop: { mode: [2, 5, 1, 2], second: 0.45, sign: -1 },
    siblings: [[2, 5, 1, 2, -0.45], [2, 5, 1, 2, 0.9], [2, 6, 1, 2, 0.45]],
    grand: [3, 6, 1, 2, 0.45],
    voice: [[1, 2, 1, 3, 0.3, -1], [1, 2, 2, 3, -0.4, -1], [2, 4, 1, 3, 0.3, -1]],
  },
  "1d589940ca458d793a3fad8a": { // Desire: hourglass bands
    s: 0.55,
    family: [[2, 4, 1, 2], [2, 3, 1, 4], [1, 4, 2, 3], [3, 5, 1, 2], [2, 5, 1, 3]],
    drop: { mode: [3, 4, 1, 3], second: 0.5, sign: 0.55 },
    siblings: [[3, 4, 1, 3, -0.5], [3, 5, 1, 3, 0.5], [4, 5, 1, 3, 0.5]],
    grand: [4, 6, 1, 3, 0.5],
    voice: [[1, 3, 3, 1, 0.4, 0], [1, 4, 2, 1, 0.3, 0.3], [1, 3, 2, 2, 0.3, 0.55]],
  },
  f127a026dc751f1528bfb95d: { // The Fate of Ophelia: pills and cushions
    s: -0.5,
    family: [[1, 3, 2, 3], [2, 3, 1, 4], [1, 4, 2, 3], [3, 4, 1, 2], [1, 5, 2, 3]],
    drop: { mode: [2, 4, 1, 1], second: 0.5, sign: -0.5 },
    siblings: [[2, 4, 1, 1, -0.5], [2, 5, 1, 1, 0.5], [3, 4, 1, 1, 0.5]],
    grand: [3, 5, 1, 1, 0.5],
    voice: [[1, 2, 1, 3, 0.3, -0.5], [3, 1, 1, 2, 0.2, -0.5], [1, 3, 1, 4, -0.5, -0.5]],
  },
  "8eee874c702a10807f79706c": { // Outside: a ruled grid
    s: 0,
    family: [[1, 2, 2, 3], [2, 3, 1, 4], [1, 4, 2, 5], [3, 4, 1, 2], [2, 5, 1, 3]],
    drop: { mode: [1, 5, 3, 3], second: 0.3, sign: 0 },
    siblings: [[1, 5, 3, 3, 0.6], [2, 5, 3, 3, 0.3], [2, 6, 3, 3, 0.3]],
    grand: [2, 6, 3, 3, 0.3],
    voice: [[1, 2, 2, 1, 0.6, 0], [2, 2, 1, 3, 0.4, 0], [2, 3, 1, 2, -0.3, 0]],
  },
  "4048d4a6dce44c151690b2b1": { // American Boy: columns and barbells
    s: 0.3,
    family: [[2, 4, 1, 3], [2, 3, 1, 4], [2, 5, 1, 2], [3, 4, 1, 3], [1, 5, 2, 3]],
    drop: { mode: [1, 4, 2, 3], second: 0.55, sign: 0.3 },
    siblings: [[1, 4, 2, 3, 0.95], [1, 5, 2, 3, 0.55], [2, 4, 2, 3, 0.55]],
    grand: [2, 5, 2, 3, 0.55],
    voice: [[3, 1, 1, 2, 0.4, 0.3], [3, 1, 2, 2, 0.3, 0.55], [2, 1, 3, 1, 0.3, 0.3]],
  },
};
const plateDefaultSong = {
  s: -0.5,
  family: [[1, 3, 2, 3], [2, 3, 1, 4], [1, 4, 2, 3], [3, 4, 1, 2], [2, 5, 1, 3]],
  drop: { mode: [2, 4, 1, 1], second: 0.5, sign: -0.5 },
  siblings: [[2, 4, 1, 1, -0.5], [2, 5, 1, 1, 0.5], [3, 4, 1, 1, 0.5]],
  grand: [3, 5, 1, 1, 0.5],
  voice: [[1, 2, 1, 3, 0.3, -0.5], [3, 1, 1, 2, 0.2, -0.5], [1, 3, 1, 4, -0.5, -0.5]],
};
const plateCircle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
// The breakdown's X (bare, then ringed, then with lobes, stepping every four bars), and the
// key word's concentric rings: each used for nothing else.
const plateBreakFigures = [[1, 2], [1, 4], [2, 3], [3, 4]].map(([n, m]) => ({ mode: [n, m, 1, 1], second: 0, sign: 1, start: 0 }));
const plateKeyFigure = { mode: [-1, 4, 0, 0], second: 0, sign: 0, start: 0 };
const plateColors = {
  ivory: { ground: "#efe9dc", plate: "#e7e0d0", sand: "#171513", voice: "#e2401c", ink: "#171513" },
  vermilion: { ground: "#e2401c", plate: "#d93c19", sand: "#171513", voice: "#f4efe4", ink: "#171513" },
  ink: { ground: "#171513", plate: "#211e1b", sand: "#efe9dc", voice: "#e2401c", ink: "#efe9dc" },
  inverted: { ground: "#efe9dc", plate: "#171513", sand: "#efe9dc", voice: "#e2401c", ink: "#171513" },
};

registerVisualizer({
  key: "plate",
  name: "Plate",
  order: 4,
  create() {
    const container = document.createElement("div");
    container.hidden = true;
    const canvas = document.createElement("canvas");
    const overlay = document.createElement("canvas");
    for (const layer of [canvas, overlay]) {
      layer.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
      container.append(layer);
    }
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    const labels = overlay.getContext("2d");
    const sand = compileWebGLProgram(gl, plateVertexShader, plateFragmentShader);
    const ground = compileWebGLProgram(gl, fullscreenVertexShader, plateGroundShader);
    const emptyVertexArray = gl.createVertexArray();

    // Fixed grain seeds: uniform over the plate, with two random attributes each.
    function seedBuffer(count, offset) {
      const data = new Float32Array(count * 4);
      for (let index = 0; index < count; index++) {
        data[index * 4] = hash01(index * 2 + offset);
        data[index * 4 + 1] = hash01(index * 2 + 1 + offset);
        data[index * 4 + 2] = hash01(index * 7 + 3 + offset);
        data[index * 4 + 3] = hash01(index * 13 + 5 + offset);
      }
      const vertexArray = gl.createVertexArray();
      gl.bindVertexArray(vertexArray);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return vertexArray;
    }
    const sandArray = seedBuffer(plateGrains, 11);
    const voiceArray = seedBuffer(plateVoiceGrains, 9001);

    let song = null;
    let scale = 1;
    let themeKey = "";
    let setup = plateDefaultSong;
    const ripples = new Float32Array(16);
    let figures = []; // the black sand: [{start, mode, second, sign}]
    let figureStarts = new Float64Array(0);
    let voices = []; // the voice sand: [{start, end, figure}], one per sung phrase
    let voiceStarts = new Float64Array(0);
    let grounds = []; // [{start, ground}]: "ivory" | "vermilion" | "ink", in time
    let groundStarts = new Float64Array(0);
    let drainStart = Infinity;
    let songEnd = Infinity;
    let backbeats = new SongEvents([]);

    function groundAt(time) {
      const index = lastIndexAtOrBefore(groundStarts, time);
      return index >= 0 ? grounds[index].ground : "ivory";
    }

    // A figure from the song's family for a moment: its place in the family from the
    // section's energy (and one step for the chord's root), the second pair's sign from minor,
    // and a variant that steps it on so a repeated progression or a held chord moves on.
    function harmonyFigure(model, time, variant, sparse) {
      const chordIndex = model.chordIndex(time + 0.05);
      const chord = chordIndex >= 0 ? model.chords[chordIndex] : model.chords[0] || { root: 0, minor: 0 };
      const intensity = model.scene(time + 0.01).intensity;
      const family = setup.family;
      const step = Math.round(intensity * (family.length - 1)) - (sparse ? 1 : 0) + (plateCircle.indexOf(chord.root) % 2) + variant * 2;
      const index = ((step % family.length) + family.length) % family.length;
      const mode = family[Math.max(0, Math.min(family.length - 1, index))];
      return { mode: mode.slice(), second: chord.minor ? -0.3 : 0.3, sign: setup.s, start: time };
    }

    // A voice figure: one of the song's three voice figures, picked by the phrase's most sung
    // pitch class and stepped on phrase by phrase.
    function voiceFigure(model, start, end, order) {
      const weight = new Float32Array(12);
      const notes = model.vocalNotes;
      for (let index = Math.max(0, notes.last(start)); index < notes.length && notes.start[index] < end; index++) {
        if (notes.end[index] < start || notes.strength[index] < 0.2) continue;
        weight[Math.round(notes.pitch[index]) % 12] += Math.min(end, notes.end[index]) - Math.max(start, notes.start[index]);
      }
      let best = 0;
      for (let pitch = 1; pitch < 12; pitch++) if (weight[pitch] > weight[best]) best = pitch;
      const [n1, m1, n2, m2, second, sign] = setup.voice[(plateCircle.indexOf(best) + order) % setup.voice.length];
      return { mode: [n1, m1, n2, m2], second, sign, start };
    }

    function setSong(model) {
      song = model;
      themeKey = "";
      figures = [];
      voices = [];
      grounds = [];
      groundStarts = new Float64Array(0);
      drainStart = songEnd = Infinity;
      figureStarts = new Float64Array(0);
      voiceStarts = new Float64Array(0);
      backbeats = new SongEvents([]);
      if (!model) return;
      setup = plateSongs[model.identifier] || plateDefaultSong;
      const strong = [];
      for (let index = 0; index < model.snares.length; index++) if (model.snares.strength[index] > 0.45) strong.push([model.snares.time[index], model.snares.strength[index]]);
      backbeats = new SongEvents(strong);
      const mix = model.series.mix;
      songEnd = model.duration;
      if (mix) {
        let index = mix.length - 1;
        while (index > 0 && mix[index] < 0.08) index--;
        songEnd = Math.min(model.duration, index / 100 + 0.3);
      }

      // The ground: ivory before the turn (the main drop's section in ink when that drop comes
      // before the turn); from the turn vermilion for sixteen bars (eight when less than 64
      // bars follow the turn), then ink and vermilion by turns, each change at the start of a
      // section of eight bars or more or, failing one within eight bars, on a downbeat; the
      // outro keeps the last colour.
      const turn = model.lateStart;
      const mainTime = model.mainDrop >= 0 ? model.drops[model.mainDrop].time : Infinity;
      const mark = (start, ground) => {
        if (!grounds.length || grounds[grounds.length - 1].ground !== ground) grounds.push({ start, ground });
      };
      for (const scene of model.scenes) {
        if (scene.start >= turn - 0.05) break;
        mark(scene.start, mainTime < turn - 0.05 && scene.start >= mainTime - 0.05 && scene.start < mainTime + 0.05 ? "ink" : "ivory");
      }
      if (!grounds.length) mark(0, "ivory");
      if (turn < model.duration) {
        const bar = model.barPeriod;
        const outro = model.scenes.find((scene, index) => scene.kind === "outro" && model.scenes.slice(index).every((next) => next.kind === "outro"));
        const outroStart = outro ? outro.start : songEnd;
        let colour = "vermilion";
        mark(turn, colour);
        let next = turn + ((model.duration - turn) / bar >= 64 ? 16 : 8) * bar;
        while (next < outroStart - 4 * bar) {
          const scene = model.scenes.find((entry) => entry.start >= next - 0.05 && entry.start < next + 8 * bar && entry.end - entry.start >= 8 * bar - 0.05);
          const at = scene ? scene.start : model.barTime(model.barIndex(next + 0.05));
          if (at >= outroStart - 0.05) break;
          colour = colour === "vermilion" ? "ink" : "vermilion";
          mark(at, colour);
          next = at + 16 * bar;
        }
      }
      groundStarts = Float64Array.from(grounds.map((entry) => entry.start));
      // The drain: from the start of the song's last run of quiet scenes (or its outro).
      for (let index = model.scenes.length - 1; index >= 0; index--) {
        const scene = model.scenes[index];
        if (scene.kind === "outro" || scene.energy < 0.6 * Math.max(...model.scenes.map((entry) => entry.energy))) drainStart = scene.start;
        else break;
      }
      drainStart = Math.max(drainStart, songEnd - 20);

      // The voice: phrases from the sung notes (a new phrase after a 0.4 s rest), split where a
      // sung line begins and every two bars of a long phrase, never more than once a bar.
      const notes = model.vocalNotes;
      const phrases = [];
      for (let index = 0; index < notes.length; index++) {
        if (notes.strength[index] < 0.2) continue;
        const last = phrases[phrases.length - 1];
        if (last && notes.start[index] - last.end < 0.4) {
          last.end = Math.max(last.end, notes.end[index]);
          last.strength = Math.max(last.strength, notes.strength[index]);
        } else phrases.push({ start: notes.start[index], end: notes.end[index], strength: notes.strength[index] });
      }
      // before the first sung word, faint pitch (an instrument read as a voice) is not singing
      const firstWord = model.lyrics.lines.length ? model.lyrics.lines[0].words[0].start : Infinity;
      for (let index = phrases.length - 1; index >= 0; index--) if (phrases[index].end < firstWord - 0.5 && phrases[index].strength < 0.5) phrases.splice(index, 1);
      const lineStarts = model.lyrics.lines.map((line) => line.words[0].start);
      for (const phrase of phrases) {
        if (phrase.end - phrase.start < 0.35) continue;
        const cuts = [phrase.start];
        for (const start of lineStarts) if (start > phrase.start + model.barPeriod && start < phrase.end - 0.5) cuts.push(start);
        cuts.sort((a, b) => a - b);
        const pieces = [];
        for (const cut of cuts) if (!pieces.length || cut - pieces[pieces.length - 1] >= model.barPeriod) pieces.push(cut);
        // a long piece still moves on every two bars
        const filled = [];
        pieces.forEach((start, index) => {
          const end = index + 1 < pieces.length ? pieces[index + 1] : phrase.end;
          filled.push(start);
          for (let at = start + 2 * model.barPeriod; at < end - model.barPeriod; at += 2 * model.barPeriod) filled.push(at);
        });
        filled.forEach((start, index) => {
          const end = index + 1 < filled.length ? filled[index + 1] : phrase.end;
          voices.push({ start, end, joined: index > 0, figure: voiceFigure(model, start, end, voices.length) });
        });
      }
      voiceStarts = Float64Array.from(voices.map((voice) => voice.start));
      const singingAt = (time) => {
        const index = lastIndexAtOrBefore(voiceStarts, time + 0.1);
        return index >= 0 && time < voices[index].end + 0.25;
      };

      // The harmony: a re-form at most every two bars, on the downbeat, never in a build or a
      // gap, and never straight back to the figure before; while the voice sings only every
      // eight bars; in a breakdown the X, stepping every four bars; in a chord passage every
      // chord. The first drop lands on the song's drop figure (its thumbnail), a later main
      // drop on the grander figure, the others on its siblings; each holds four bars, and a
      // drop section then steps through the siblings every four bars.
      const same = (a, b) => a && b && a.mode.join() === b.mode.join() && a.sign === b.sign && Math.sign(a.second) === Math.sign(b.second);
      const push = (figure) => {
        const last = figures[figures.length - 1];
        if (same(last, figure)) return false;
        if (last && figure.start - last.start < 0.05) figures.pop();
        figures.push(figure);
        return true;
      };
      const figureOf = ([n1, m1, n2, m2, second], time) => ({ mode: [n1, m1, n2, m2], second, sign: setup.drop.sign, start: time });
      let heldSince = 0,
        dropHold = -Infinity,
        siblingStep = 0;
      const seen = new Map(); // chord → how often it has come round in this scene
      let seenScene = -1;
      const moments = [];
      for (let bar = 0; bar < model.downbeats.length; bar++) moments.push({ time: model.barTime(bar), kind: "bar" });
      for (const drop of model.drops) moments.push({ time: drop.time, kind: "drop" });
      for (const peak of model.peaks)
        if (peak.kind === "chords")
          for (const chord of model.chords) if (chord.start >= peak.start - 0.05 && chord.start < peak.end) moments.push({ time: chord.start, kind: "chord" });
      moments.sort((a, b) => a.time - b.time);
      figures.push({ ...setup.drop, mode: setup.drop.mode.slice(), start: -Infinity });
      for (const moment of moments) {
        const time = moment.time;
        if (time <= 0.5) continue;
        const sceneIndex = model.sceneIndex(time + 0.01);
        const scene = model.scenes[sceneIndex];
        if (sceneIndex !== seenScene) {
          seen.clear();
          seenScene = sceneIndex;
        }
        const drop = model.dropContext(time + 0.001);
        const sparse = groundAt(time + 0.01) === "vermilion";
        if (moment.kind === "drop") {
          const index = model.drops.findIndex((entry) => Math.abs(entry.time - time) < 0.01);
          let figure;
          if (index <= 0) figure = { ...setup.drop, mode: setup.drop.mode.slice(), start: time };
          else if (index === model.mainDrop) figure = figureOf(setup.grand, time);
          else figure = figureOf(setup.siblings[(index - 1) % setup.siblings.length], time);
          push(figure);
          heldSince = time;
          dropHold = time + 4 * model.barPeriod;
          siblingStep = Math.max(0, index);
          continue;
        }
        if (moment.kind === "chord") {
          if (push(harmonyFigure(model, time, 0, false))) heldSince = time;
          continue;
        }
        // a build re-forms once, on its first downbeat (so it gathers the song's figure, not a
        // breakdown's X), then holds while it contracts
        const buildStart = drop.phase === 1 && time - drop.build.start < model.barPeriod - 0.05;
        if (time < dropHold - 0.05 || (drop.phase === 1 && !buildStart) || drop.phase === 2 || scene.kind === "gap") continue;
        if (buildStart) {
          if (push(harmonyFigure(model, time, 0, false))) heldSince = time;
          continue;
        }
        if (scene.kind === "break") {
          const step = Math.floor(Math.max(0, model.barIndex(time + 0.01) - model.barIndex(scene.start + 0.01)) / 4);
          if (push({ ...plateBreakFigures[step % plateBreakFigures.length], start: time })) heldSince = time;
          continue;
        }
        const held = time - heldSince;
        if (scene.kind === "drop") {
          if (held < 4 * model.barPeriod - 0.05) continue;
          if (push(figureOf(setup.siblings[siblingStep++ % setup.siblings.length], time))) heldSince = time;
          continue;
        }
        if (held < (scene.kind === "outro" || time >= drainStart ? 4 : 2) * model.barPeriod - 0.05) continue;
        if (singingAt(time) && held < 8 * model.barPeriod - 0.05) continue;
        const chordIndex = model.chordIndex(time + 0.05);
        const chordKey = chordIndex >= 0 ? `${model.chords[chordIndex].root}${model.chords[chordIndex].minor}` : "none";
        const count = seen.get(chordKey) || 0;
        const last = figures[figures.length - 1],
          beforeLast = figures[figures.length - 2];
        let next = harmonyFigure(model, time, count, sparse);
        if ((same(next, last) && held >= 4 * model.barPeriod - 0.05) || same(next, beforeLast)) next = harmonyFigure(model, time, count + 1, sparse);
        if (same(next, beforeLast)) next = harmonyFigure(model, time, count + 2, sparse);
        if (!same(next, last)) {
          seen.set(chordKey, count + 1);
          push(next);
          heldSince = time;
        }
      }
      figureStarts = Float64Array.from(figures.map((figure) => figure.start));
    }

    const current = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const previous = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const voiceNow = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const voiceBefore = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const plate = { x0: 0, y0: 0, side: 1 };
    let size = { width: 1, height: 1 };

    function drawSand(vertexArray, count, modeA, modeB, settle, gather, knot, present, color, pointSize, rippleData, weight, drain, scaleFactor = 1) {
      const u = sand.uniforms;
      gl.useProgram(sand.program);
      gl.uniform4f(u.uModeA, modeA.mode[0], modeA.mode[1], modeA.mode[2], modeA.mode[3]);
      gl.uniform4f(u.uModeB, modeB.mode[0], modeB.mode[1], modeB.mode[2], modeB.mode[3]);
      gl.uniform4f(u.uMix, modeA.second, modeB.second, settle, modeB.sign);
      gl.uniform1f(u.uSignA, modeA.sign);
      gl.uniform1f(u.uScale, 0.5 * scaleFactor);
      gl.uniform4f(u.uRect, (plate.x0 / size.width) * 2 - 1, 1 - ((plate.y0 + plate.side) / size.height) * 2, ((plate.x0 + plate.side) / size.width) * 2 - 1, 1 - (plate.y0 / size.height) * 2);
      gl.uniform4f(u.uGather, gather, knot, present, weight);
      gl.uniform4fv(u.uRipple, rippleData);
      gl.uniform1f(u.uPointSize, pointSize);
      gl.uniform1f(u.uDrain, drain);
      gl.uniform3f(u.uColor, color[0], color[1], color[2]);
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      size = { width, height };
      // The plate: a square in the middle of the sheet as tall as it can be, beside the title
      // when the title is short enough to leave it room, under it otherwise.
      const bottom = height * 0.9;
      let top = height * 0.05;
      let side = Math.min(bottom - top, width * 0.9);
      if ((frame.titleRight || 0) + 24 > (width - side) / 2 && (frame.titleBottom || 0) > top) {
        top = Math.max(height * 0.17, (frame.titleBottom || 0) + height * 0.025);
        side = Math.min(bottom - top, width * 0.9);
      }
      plate.x0 = (width - side) / 2;
      plate.y0 = top;
      plate.side = side;

      const sceneIndex = song ? song.sceneIndex(time) : 0;
      const peak = song ? song.peakAt(time) : null;
      const chordPassage = Boolean(peak && peak.kind === "chords");
      const groundName = song ? (chordPassage ? "inverted" : groundAt(time)) : "ivory";
      const colors = plateColors[groundName];
      const key = `${colors.ground}:${colors.ink}`;
      if (key !== themeKey) {
        themeKey = key;
        document.documentElement.style.setProperty("--plate-ground", colors.ground);
        document.documentElement.style.setProperty("--plate-ink", colors.ink);
        waveformTheme = null;
      }

      // Kick: the plate darkens, the striker jumps and waves run to the rim. Snare: the frame.
      let kickHit = 0,
        snareHit = 0;
      if (song && time > 0.1) {
        const kickIndex = song.kicks.last(time);
        kickHit = kickIndex >= 0 ? song.kicks.strength[kickIndex] * hitDecay(song.kicks.since(time), 0.06) : 0;
        const snare = backbeats.last(time);
        snareHit = snare >= 0 ? hitDecay(time - backbeats.time[snare], 0.07) : 0;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(ground.program);
      const groundColor = hexColor(colors.ground),
        plateColor = hexColor(colors.plate),
        inkColor = hexColor(colors.ink);
      gl.uniform3f(ground.uniforms.uGround, groundColor[0], groundColor[1], groundColor[2]);
      gl.uniform3f(ground.uniforms.uPlate, plateColor[0], plateColor[1], plateColor[2]);
      gl.uniform3f(ground.uniforms.uInk, inkColor[0], inkColor[1], inkColor[2]);
      gl.uniform2f(ground.uniforms.uResolution, canvas.width, canvas.height);
      gl.uniform4f(ground.uniforms.uFrame, plate.x0 / width, 1 - (plate.y0 + side) / height, (plate.x0 + side) / width, 1 - plate.y0 / height);
      gl.uniform2f(ground.uniforms.uFlash, groundName === "ink" || groundName === "inverted" ? -1.2 * kickHit : 0.22 * kickHit, snareHit);
      gl.bindVertexArray(emptyVertexArray);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!song) {
        drawLabels(time, width, height, null, colors, 0, frame);
        return;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const drop = song.dropContext(time);

      // Harmony: the figure, migrating from the previous one over 0.25 s.
      const figureIndex = Math.max(0, lastIndexAtOrBefore(figureStarts, time));
      Object.assign(current, figures[figureIndex]);
      Object.assign(previous, figures[Math.max(0, figureIndex - 1)]);
      const settle = figureIndex > 0 ? easeInOutCubic((time - current.start) / 0.25) : 1;

      // Build: the figure contracts a step on every downbeat. Gap: a knot that shrinks each
      // beat. A drop with no hole: its last beat is the knot. The drop throws it out.
      let gather = 0,
        knot = 0.3;
      if (drop.phase === 1) {
        const startBar = song.barIndex(drop.build.start + 0.01);
        const endBar = Math.max(startBar + 1, song.barIndex(drop.build.end - 0.01) + 1);
        const bar = song.barPosition(time);
        const done = Math.floor(bar) - startBar + easeOutCubic(clamp01(fract(bar) / 0.2));
        gather = 0.88 * clamp01(done / (endBar - startBar));
      }
      if (drop.phase === 2) {
        const beatsLeft = Math.ceil((drop.drop.time - time) / song.beatPeriod - 1e-6);
        gather = 1;
        knot = 0.03 + 0.035 * Math.max(0, beatsLeft);
      }
      let lastBeat = false;
      const nextDrop = drop.phase === 3 ? song.drops[drop.index + 1] : drop.drop;
      if (nextDrop && nextDrop.gapStart >= nextDrop.time - 0.05) {
        const lead = nextDrop.time - time;
        if (lead > 0 && lead <= song.beatPeriod) {
          gather = Math.max(gather, easeOutCubic(1 - lead / song.beatPeriod) * 0.12 + 0.88);
          knot = 0.065;
          lastBeat = true;
        }
      }
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      if (leadIn >= 0 && drop.phase !== 2) {
        gather = 1;
        knot = 0.065;
      }
      // The drop throws the knot out into the drop figure over 0.18 s, from the knot's size.
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      if (sinceDrop < 0.18) {
        const burst = easeOutCubic(sinceDrop / 0.18);
        gather = 1 - burst;
        knot = mixValue(0.065, 0.3, burst);
      }

      // Kick waves: the last four strikes run out from the centre to the plate's rim.
      let rippleIndex = song.kicks.last(time);
      for (let slot = 0; slot < 4; slot++) {
        const age = rippleIndex >= 0 ? time - song.kicks.time[rippleIndex] : Infinity;
        const alive = age < 1.4 && gather < 0.5 && time > 0.1;
        ripples[slot * 4] = alive ? age : 0;
        ripples[slot * 4 + 1] = alive ? song.kicks.strength[rippleIndex] * 2.4 : 0;
        ripples[slot * 4 + 2] = 2.6;
        ripples[slot * 4 + 3] = 0;
        rippleIndex--;
      }
      if (sinceDrop < 1.4) {
        ripples[0] = sinceDrop;
        ripples[1] = 3.2;
      }
      // Bass: the lines are heavy while a bass note sounds and let go over 0.2 s after it
      // (short gaps and the kick's sidechain dips are bridged), so the bass line reads, not a
      // flicker.
      let heavy = 0;
      {
        const notes = song.bassNotes;
        let index = notes.last(time);
        while (index >= 0 && notes.strength[index] <= 0.3) index--;
        if (index >= 0) {
          const attack = easeOutCubic(clamp01((time - notes.start[index]) / 0.06));
          const hold = notes.end[index] + 0.15;
          heavy = time <= hold ? attack : attack * (1 - easeInOutCubic(clamp01((time - hold) / 0.2)));
        }
      }
      // a drop lands in heavy lines for its first two beats, bass or not
      if (drop.phase === 3 && drop.since < 2 * song.beatPeriod) heavy = Math.max(heavy, 1 - easeInCubic(drop.since / (2 * song.beatPeriod)));
      const weight = 0.025 + 0.02 * heavy;
      const pointSize = Math.max(1.5, 2.3 * (canvas.height / 1080)) * (1 + 0.4 * heavy);
      // Outro: the sand drains away to the bare knot.
      const drain = time > drainStart ? clamp01((time - drainStart) / Math.max(1, songEnd - drainStart)) : 0;

      // Voice: its sand in the figure of the sung phrase; the key word's rings take the plate.
      const voiceIndex = lastIndexAtOrBefore(voiceStarts, time + 0.1);
      let voicePresence = 0;
      if (voiceIndex >= 0) {
        const voice = voices[voiceIndex];
        voicePresence = Math.min(voice.joined ? 1 : clamp01((time - voice.start + 0.1) / 0.2), clamp01((voice.end + 0.25 - time) / 0.25));
      }
      // the first frame shows the song's drop figure and the voice to come
      const firstVoice = voices.length ? voices[0] : null;
      if (firstVoice && time < 0.5 && firstVoice.start > time) voicePresence = Math.max(voicePresence, 0.85 * (1 - time / 0.5));
      let keyMoment = 0,
        keyStart = 0;
      if (song.anchor.kind === "word") {
        const index = lastIndexAtOrBefore(song.anchorStarts, time);
        if (index >= 0) {
          const moment = song.anchor.moments[index];
          keyStart = moment.start;
          const hold = Math.max(moment.end, moment.start + 0.6);
          keyMoment = Math.max(0, Math.min(easeOutCubic(clamp01((time - moment.start) / 0.12)), 1 - easeInOutCubic(clamp01((time - hold) / 0.2))));
        }
      }
      // a hole (and the last beat before a drop with none) is the knot alone, unless the key
      // word is sung into it; a drop's four-bar hold belongs to the black sand (the voice is
      // away for its first 0.3 s, then at half); the voice recedes as a build contracts
      const inHole = drop.phase === 2 || leadIn >= 0 || lastBeat;
      if (inHole) voicePresence = 0;
      const holding = drop.phase === 3 && drop.since < 4 * song.barPeriod;
      if (holding) voicePresence *= drop.since < 0.3 ? 0 : 0.5;
      if (drop.phase === 1) voicePresence *= 1 - clamp01(gather);

      const sandColor = hexColor(colors.sand),
        voiceColor = hexColor(colors.voice);
      // the black sand steps back while the voice sings, and almost leaves for the key word,
      // except in a drop's hold
      const sandPresence = holding ? 1 : (1 - 0.55 * voicePresence) * (1 - 0.8 * keyMoment);
      drawSand(sandArray, plateGrains, previous, current, settle, gather, knot, sandPresence, sandColor, pointSize, ripples, weight, drain);
      if (keyMoment > 0.01) {
        const before = lastIndexAtOrBefore(voiceStarts, keyStart - 0.01);
        Object.assign(voiceBefore, before >= 0 ? voices[before].figure : plateKeyFigure);
        const voiceSettle = easeOutCubic(clamp01((time - keyStart) / 0.2));
        // (in a build the rings keep their size and fade instead of being crushed)
        drawSand(voiceArray, plateVoiceGrains, voiceBefore, plateKeyFigure, voiceSettle, inHole ? 0.6 : 0, 0.3, keyMoment * (drop.phase === 1 ? 1 - 0.7 * clamp01(gather) : 1), voiceColor, pointSize * 1.5, ripples, 0.03, drain, 1);
      } else if (voicePresence > 0.01 && voices.length) {
        const index = Math.max(0, voiceIndex);
        Object.assign(voiceNow, voices[index].figure);
        Object.assign(voiceBefore, voices[Math.max(0, index - 1)].figure);
        const voiceSettle = voices[index].joined ? easeInOutCubic(clamp01((time - voiceNow.start) / 0.25)) : 1;
        drawSand(voiceArray, plateVoiceGrains, voices[index].joined ? voiceBefore : voiceNow, voiceNow, voiceSettle, gather, knot * 1.4, voicePresence, voiceColor, pointSize * 1.35, ripples, 0.03, drain, 0.6);
      }
      drawLabels(time, width, height, drop, colors, kickHit, frame);
    }

    // The striker at the plate's centre, the hats along its top edge, and captions as on an
    // engraved plate: figure number, mode, harmony, bar and time.
    function drawLabels(time, width, height, drop, colors, kickHit, frame) {
      labels.setTransform(scale, 0, 0, scale, 0, 0);
      labels.clearRect(0, 0, width, height);
      if (!song) return;
      const unit = height / 1080;
      const gathered = drop && (drop.phase === 2 || (drop.phase === 1 && drop.progress > 0.9));
      // Kick: a boss at the plate's centre that jumps on every kick (hidden while paused,
      // where the play button stands).
      if (!gathered && frame.playing !== false) {
        const cx = plate.x0 + plate.side / 2,
          cy = plate.y0 + plate.side / 2;
        const radius = plate.side * (0.018 + 0.052 * kickHit);
        labels.fillStyle = colors.sand;
        labels.beginPath();
        labels.arc(cx, cy, radius, 0, Math.PI * 2);
        labels.fill();
        labels.fillStyle = colors.plate;
        labels.beginPath();
        labels.arc(cx, cy, radius * 0.36, 0, Math.PI * 2);
        labels.fill();
      }
      // Hats: ticks hanging from the top rule at their place in the bar (the last bar, the
      // older ones fainter), over a faint rule of sixteenths; swing shows as ticks off the rule.
      if (frame.playing !== false) {
        const left = plate.x0 + 8 * unit,
          span = plate.side - 16 * unit,
          top = plate.y0 + 3 * unit;
        const tick = plate.side * 0.065;
        labels.fillStyle = colors.sand;
        labels.globalAlpha = 0.3;
        for (let step = 0; step < 16; step++) labels.fillRect(left + (step / 16) * span - 2 * unit, top, 4 * unit, tick * (step % 4 === 0 ? 0.5 : 0.28));
        let index = song.hats.last(time);
        while (index >= 0) {
          const age = time - song.hats.time[index];
          if (age > song.barPeriod) break;
          if (song.hats.strength[index] >= 0.25) {
            const at = fract(song.barPosition(song.hats.time[index]));
            labels.globalAlpha = 0.3 + 0.7 * Math.exp(-age / (song.beatPeriod * 0.8));
            labels.fillRect(left + at * span - 6 * unit, top, 12 * unit, tick);
          }
          index--;
        }
        labels.globalAlpha = 1;
      }
      labels.fillStyle = colors.ink;
      const chordIndex = song.chordIndex(time);
      const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
      const chord = chordIndex >= 0 ? song.chords[chordIndex] : null;
      const figureNumber = Math.max(0, lastIndexAtOrBefore(figureStarts, time)) + 1;
      const right = plate.x0 + plate.side,
        below = plate.y0 + plate.side + 30 * unit;
      labels.font = `italic 400 ${Math.round(34 * unit)}px "Instrument Serif", serif`;
      labels.textAlign = "right";
      labels.fillText(`Fig. ${figureNumber}`, right, below + 14 * unit);
      labels.textAlign = "left";
      labels.font = `400 ${Math.round(14 * unit)}px "IBM Plex Mono", monospace`;
      const harmony = chord ? `${names[chord.root]}${chord.minor ? " MINOR" : " MAJOR"}` : "";
      const bar = Math.max(0, Math.floor(song.barPosition(time)) + 1);
      const beat = Math.floor(fract(song.barPosition(time)) * 4) + 1;
      const mode = current.mode[0] < 0 ? "RINGS" : `(${current.mode[0]}, ${current.mode[1]})`;
      labels.fillText(`MODE ${mode}   ${harmony}`, plate.x0, below);
      labels.fillText(`BAR ${String(bar).padStart(3, "0")}.${beat}   ${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, "0")}`, plate.x0, below + 18 * unit);
    }

    return {
      canvas: container,
      setSong,
      themeFor() {
        themeKey = "";
        return { "--plate-ground": plateColors.ivory.ground, "--plate-ink": plateColors.ivory.ink };
      },
      setActive(on) {
        container.hidden = !on;
      },
      resize(width, height, ratio) {
        const [w, h] = canvasPixels(width, height, Math.min(ratio, 2), 1920 * 1080);
        canvas.width = w;
        canvas.height = h;
        const [lw, lh, ls] = canvasPixels(width, height, Math.min(ratio, 2), 2560 * 1440);
        overlay.width = lw;
        overlay.height = lh;
        scale = ls;
      },
      render,
      debug: () => ({ figures, voices, grounds, drainStart }),
    };
  },
});
