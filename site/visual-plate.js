// Plate: Chladni figures. One square plate stands in the middle of the sheet and sand lies
// on its nodal lines. The harmony chooses the figure, and it re-forms at most once a bar,
// never while the voice sings; the voice is a second sand, vermilion, one figure per sung
// line; the bass sets the lines' weight (thin, or heavy while a bass note sounds); the kick
// strikes the plate: the striker at its centre jumps, a wave runs out to its edge and the
// plate darkens for an instant. Sections change the plate: a breakdown clears it to the
// simplest figure and leaves the voice; a chord passage inverts it; a build contracts the
// figure bar by bar into the centre; the gap shrinks that knot beat by beat; the drop throws
// it out into the new figure on the exact frame. At the song's turn the sheet goes vermilion,
// and later sections alternate vermilion and ink; the outro drains the sand away.
// Every grain is placed in the vertex shader from song time alone: its fixed seed position
// is projected onto the current figure's nodal lines by Newton steps, so a seek anywhere
// lands on the right picture and nothing accumulates.

const plateGrains = 196608; // 384 x 512
const plateVoiceGrains = 65536;

const plateVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeed;
uniform vec4 uModeA;     // figure the sand is leaving: n1 m1 n2 m2
uniform vec4 uModeB;     // figure it is moving to
uniform vec4 uMix;       // x weight of the second mode (A), y (B), z settle 0..1, w sign (B)
uniform float uSignA;    // sign of figure A
uniform float uScale;    // pattern units per plate half-side
uniform vec4 uRect;      // plate in clip space: x0 y0 x1 y1
uniform vec4 uGather;    // x pull to the centre 0..1, y knot radius, z present 0..1, w line weight
uniform vec4 uRipple[4]; // x age s, y strength, z speed, w unused
uniform float uPointSize;
uniform float uDrain;    // 0..1: the share of grains gone (the outro)
out float vAlpha;
out float vShade;

const float PI = 3.14159265;

float field(vec2 p, vec4 mode, float second, float sign) {
  vec2 a = PI * p;
  float first = cos(mode.x * a.x) * cos(mode.y * a.y) - sign * cos(mode.y * a.x) * cos(mode.x * a.y);
  float extra = cos(mode.z * a.x) * cos(mode.w * a.y) - sign * cos(mode.w * a.x) * cos(mode.z * a.y);
  return first + second * extra;
}

vec2 gradient(vec2 p, vec4 mode, float second, float sign) {
  vec2 a = PI * p;
  float n = mode.x, m = mode.y;
  vec2 g1 = PI * vec2(
    -n * sin(n * a.x) * cos(m * a.y) + sign * m * sin(m * a.x) * cos(n * a.y),
    -m * cos(n * a.x) * sin(m * a.y) + sign * n * cos(m * a.x) * sin(n * a.y));
  n = mode.z; m = mode.w;
  vec2 g2 = PI * vec2(
    -n * sin(n * a.x) * cos(m * a.y) + sign * m * sin(m * a.x) * cos(n * a.y),
    -m * cos(n * a.x) * sin(m * a.y) + sign * n * cos(m * a.x) * sin(n * a.y));
  return g1 + second * g2;
}

// Newton steps onto f = 0, each clamped so a grain moves to a nearby line, never far.
vec2 settle(vec2 p, vec4 mode, float second, float sign, out float residual) {
  for (int i = 0; i < 7; i++) {
    float f = field(p, mode, second, sign);
    vec2 g = gradient(p, mode, second, sign);
    vec2 step = f * g / (dot(g, g) + 1e-3);
    float len = length(step);
    if (len > 0.03) step *= 0.03 / len;
    p -= step;
  }
  float f = field(p, mode, second, sign);
  residual = abs(f) / (length(gradient(p, mode, second, sign)) + 1e-3);
  return p;
}

void main() {
  // Pattern space is centred on the plate's centre (where the striker hits and the knot
  // gathers), so every figure is symmetric about it.
  vec2 home = (aSeed.xy * 2.0 - 1.0) * uScale;
  float r1, r2;
  vec2 a = settle(home, uModeA, uMix.x, uSignA, r1);
  vec2 b = settle(home, uModeB, uMix.y, uMix.w, r2);
  float s = uMix.z;
  vec2 p = mix(a, b, s);
  float residual = mix(r1, r2, s);
  // Line weight: each grain sits off the line by its own amount.
  vec2 grad = gradient(p, uModeB, uMix.y, uMix.w);
  vec2 normal = length(grad) > 1e-4 ? normalize(grad) : vec2(0.0, 1.0);
  p += normal * (aSeed.z - 0.5) * uGather.w;

  vec2 q = p / uScale; // -1..1 across the plate
  // Kick: a wave runs out from the centre to the edge and throws the sand it passes outward.
  for (int i = 0; i < 4; i++) {
    vec4 ripple = uRipple[i];
    if (ripple.y <= 0.0) continue;
    float radius = ripple.x * ripple.z;
    float distance = length(q);
    float band = exp(-pow((distance - radius) / 0.12, 2.0));
    float fade = exp(-ripple.x / 0.35);
    q += (distance > 1e-4 ? q / distance : vec2(0.0)) * band * ripple.y * fade * 0.06;
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
  // grains that did not reach a line are faint (real sand leaves the antinodes empty); in
  // mid-migration they dim, so a re-form is a quick fade across, not a grey smear
  float onLine = 1.0 - smoothstep(0.004, 0.02, residual);
  float flight = 1.0 - 0.75 * 4.0 * s * (1.0 - s);
  float drained = step(uDrain, fract(aSeed.w * 7.31 + aSeed.x * 3.17));
  vAlpha = mix(onLine * flight, 1.0, uGather.x) * uGather.z * (1.0 - outside) * drained;
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
uniform vec4 uFrame; // plate in uv: x0 y0 x1 y1
uniform float uFlash; // the plate darkening (or lightening) for a kick
void main() {
  vec2 px = 1.0 / uResolution;
  bool inside = vUv.x > uFrame.x && vUv.x < uFrame.z && vUv.y > uFrame.y && vUv.y < uFrame.w;
  vec3 color = inside ? uPlate * (1.0 - uFlash) : uGround;
  // an engraved border: a rule round the plate, and a hairline just outside it
  vec2 lo = abs(vUv - uFrame.xy) / px, hi = abs(vUv - uFrame.zw) / px;
  bool within = vUv.x > uFrame.x - 12.0 * px.x && vUv.x < uFrame.z + 12.0 * px.x && vUv.y > uFrame.y - 12.0 * px.y && vUv.y < uFrame.w + 12.0 * px.y;
  float edge = min(min(lo.x, hi.x), min(lo.y, hi.y));
  if (within && edge < 2.2) color = mix(color, uInk, 0.9);
  if (within && !inside && edge > 8.0 && edge < 9.3) color = mix(color, uInk, 0.6);
  // a faint darkening toward the edges of the sheet
  vec2 c = vUv - 0.5;
  color *= 1.0 - 0.05 * dot(c, c) * 2.0;
  outColor = vec4(color, 1.0);
}`;

// Mode pairs by complexity; harmony and energy pick among them.
const plateModes = [
  [1, 2], [1, 3], [2, 3], [1, 4], [2, 5], [3, 4], [1, 5], [3, 5], [2, 7], [4, 5],
];
const plateCircle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
// The voice's figures: simple and bold, and none of them a ring (rings are the key word's).
const plateVoiceModes = [[1, 2], [2, 3], [1, 4], [2, 5], [3, 4]];
// The key word's own figure, used for nothing else: rings about the centre.
const plateKeyFigure = { mode: [1, 3, 3, 1], second: 1, sign: -1, start: 0 };
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
    const ripples = new Float32Array(16);
    let figures = []; // the black sand: [{start, mode, second, sign}]
    let figureStarts = new Float64Array(0);
    let voices = []; // the voice sand: [{start, end, figure}], one per sung line
    let voiceStarts = new Float64Array(0);
    let grounds = []; // per scene: "ivory" | "vermilion" | "ink"
    let outroStart = Infinity;

    // A figure for the harmony at a moment: complexity from the section's energy (capped),
    // the family from the root around the circle of fifths, the sign from minor; a variant
    // steps to the neighbouring complexity so a held chord visibly changes.
    function harmonyFigure(model, time, variant, sparse) {
      const chordIndex = model.chordIndex(time + 0.05);
      const chord = chordIndex >= 0 ? model.chords[chordIndex] : model.chords[0] || { root: 0, minor: 0 };
      const intensity = model.scene(time + 0.01).intensity;
      const circle = plateCircle.indexOf(chord.root);
      const base = Math.max(0, Math.min(7, Math.round(1 + intensity * 5) - (sparse ? 2 : 0) + (circle % 2) + (variant % 2)));
      const [n, m] = plateModes[base];
      const [n2, m2] = plateModes[(circle + variant * 3) % 4];
      return { mode: [n, m, n2, m2], second: 0.3, sign: chord.minor ? -1 : 1, start: time };
    }

    function voiceFigure(model, start, end, line) {
      // the line's most sung pitch class picks a simple figure, and each line moves it on one
      // (a voice that stays on one note still changes figure line by line)
      const weight = new Float32Array(12);
      let octave = 0,
        total = 0;
      const notes = model.vocalNotes;
      for (let index = Math.max(0, notes.last(start)); index < notes.length && notes.start[index] < end; index++) {
        if (notes.end[index] < start || notes.strength[index] < 0.2) continue;
        const span = Math.min(end, notes.end[index]) - Math.max(start, notes.start[index]);
        weight[Math.round(notes.pitch[index]) % 12] += span;
        octave += notes.pitch[index] * span;
        total += span;
      }
      let best = 0;
      for (let pitch = 1; pitch < 12; pitch++) if (weight[pitch] > weight[best]) best = pitch;
      const register = total > 0 ? Math.floor((octave / total - 48) / 12) : 0;
      const [n, m] = plateVoiceModes[(plateCircle.indexOf(best) + Math.max(0, register) + line) % plateVoiceModes.length];
      return { mode: [n, m, m, n + 1], second: 0.2, sign: line % 2 ? -1 : 1, start };
    }

    function setSong(model) {
      song = model;
      themeKey = "";
      figures = [];
      voices = [];
      grounds = [];
      outroStart = Infinity;
      figureStarts = new Float64Array(0);
      voiceStarts = new Float64Array(0);
      if (!model) return;

      // The ground per scene: ivory before the turn; from it, vermilion, then ink and
      // vermilion by turns, section by section.
      let late = 0;
      model.scenes.forEach((scene) => {
        if (scene.start < model.lateStart - 0.05) grounds.push("ivory");
        else grounds.push(late++ % 2 === 0 ? "vermilion" : "ink");
      });
      for (let index = model.scenes.length - 1; index >= 0 && model.scenes[index].kind === "outro"; index--) outroStart = model.scenes[index].start;

      // The voice: one figure per sung line, a new one at most once a bar (a line that
      // follows too soon carries the last one on).
      let lastChange = -Infinity;
      for (const line of model.lyrics.lines) {
        const start = line.words[0].start,
          end = line.words[line.words.length - 1].end;
        if (end - start < 0.3) continue;
        const previous = voices[voices.length - 1];
        if (previous && start - previous.end < 0.5 && start - lastChange < model.barPeriod) {
          previous.end = Math.max(previous.end, end);
          continue;
        }
        voices.push({ start, end, figure: voiceFigure(model, start, end, voices.length) });
        lastChange = start;
      }
      voiceStarts = Float64Array.from(voices.map((voice) => voice.start));
      const singingAt = (time) => {
        const index = lastIndexAtOrBefore(voiceStarts, time + 0.1);
        return index >= 0 && time < voices[index].end + 0.25;
      };

      // The harmony: a re-form at most once a bar, on the downbeat, never while the voice
      // sings, never in a build or a gap; in a breakdown the simplest figure; every drop lands
      // on a new figure; in a chord passage every chord re-forms it.
      const same = (a, b) => a && b && a.mode.join() === b.mode.join() && a.sign === b.sign;
      const push = (figure) => {
        const last = figures[figures.length - 1];
        if (same(last, figure)) return;
        if (last && figure.start - last.start < 0.05) figures.pop();
        figures.push(figure);
      };
      let variant = 0,
        heldSince = 0;
      const moments = [];
      for (let bar = 0; bar < model.downbeats.length; bar++) moments.push({ time: model.barTime(bar), kind: "bar" });
      for (const drop of model.drops) moments.push({ time: drop.time, kind: "drop" });
      for (const peak of model.peaks)
        if (peak.kind === "chords")
          for (const chord of model.chords) if (chord.start >= peak.start - 0.05 && chord.start < peak.end) moments.push({ time: chord.start, kind: "chord" });
      moments.sort((a, b) => a.time - b.time);
      figures.push({ ...harmonyFigure(model, Math.max(0, model.chords[0]?.start ?? 0), 0, false), start: -Infinity });
      for (const moment of moments) {
        const time = moment.time;
        if (time <= 0) continue;
        const scene = model.scene(time + 0.01);
        const drop = model.dropContext(time + 0.001);
        const sparse = grounds[model.sceneIndex(time + 0.01)] === "vermilion";
        const last = figures[figures.length - 1];
        if (moment.kind === "drop") {
          variant++;
          push(harmonyFigure(model, time, variant, sparse));
          heldSince = time;
          continue;
        }
        if (moment.kind === "chord") {
          push(harmonyFigure(model, time, variant, false));
          heldSince = time;
          continue;
        }
        if (drop.phase === 1 || drop.phase === 2 || scene.kind === "gap") continue;
        if (scene.kind === "break") {
          push({ mode: [1, 2, 1, 3], second: 0, sign: 1, start: time });
          heldSince = time;
          continue;
        }
        if (singingAt(time)) continue;
        let next = harmonyFigure(model, time, variant, sparse);
        if (same(next, last) && time - heldSince >= 4 * model.barPeriod - 0.05) {
          variant++;
          next = harmonyFigure(model, time, variant, sparse);
        }
        if (!same(next, last)) {
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
      // The plate: a square in the middle of the sheet, under the title, above the captions.
      const top = Math.max(height * 0.17, (frame.titleBottom || 0) + height * 0.025);
      const side = Math.min(height * 0.9 - top, width * 0.9);
      plate.x0 = (width - side) / 2;
      plate.y0 = top;
      plate.side = side;

      const sceneIndex = song ? song.sceneIndex(time) : 0;
      const peak = song ? song.peakAt(time) : null;
      const chordPassage = Boolean(peak && peak.kind === "chords");
      const groundName = song ? (chordPassage ? "inverted" : grounds[sceneIndex] || "ivory") : "ivory";
      const colors = plateColors[groundName];
      const key = `${colors.ground}:${colors.ink}`;
      if (key !== themeKey) {
        themeKey = key;
        document.documentElement.style.setProperty("--plate-ground", colors.ground);
        document.documentElement.style.setProperty("--plate-ink", colors.ink);
        waveformTheme = null;
      }

      // Kick: the striker's jump, the plate's darkening, and waves from the centre.
      let kickHit = 0;
      if (song) {
        const kickIndex = song.kicks.last(time);
        kickHit = kickIndex >= 0 ? song.kicks.strength[kickIndex] * hitDecay(song.kicks.since(time), 0.07) : 0;
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
      gl.uniform1f(ground.uniforms.uFlash, groundName === "ink" || groundName === "inverted" ? -0.35 * kickHit : 0.07 * kickHit);
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
      // beat. A drop with no hole: the last beat is the knot. The drop throws it out.
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
      const nextDrop = drop.phase === 3 ? song.drops[drop.index + 1] : drop.drop;
      if (nextDrop && nextDrop.gapStart >= nextDrop.time - 0.05) {
        const lead = nextDrop.time - time;
        if (lead > 0 && lead <= song.beatPeriod) {
          gather = Math.max(gather, easeOutCubic(1 - lead / song.beatPeriod) * 0.12 + 0.88);
          knot = 0.065;
        }
      }
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      if (leadIn >= 0 && drop.phase !== 2) {
        gather = 1;
        knot = 0.065;
      }
      // The drop throws the knot out into the figure over 0.18 s, from the knot's own size.
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      if (sinceDrop < 0.18) {
        const burst = easeOutCubic(sinceDrop / 0.18);
        gather = 1 - burst;
        knot = mixValue(0.065, 0.3, burst);
      }

      // Kick waves: the last four strikes run out from the centre to the plate's edge.
      let rippleIndex = song.kicks.last(time);
      for (let slot = 0; slot < 4; slot++) {
        const age = rippleIndex >= 0 ? time - song.kicks.time[rippleIndex] : Infinity;
        const alive = age < 1.2 && gather < 0.5;
        ripples[slot * 4] = alive ? age : 0;
        ripples[slot * 4 + 1] = alive ? song.kicks.strength[rippleIndex] * 1.4 : 0;
        ripples[slot * 4 + 2] = 2.9;
        ripples[slot * 4 + 3] = 0;
        rippleIndex--;
      }
      if (sinceDrop < 1.2) {
        ripples[0] = sinceDrop;
        ripples[1] = 2.4;
      }
      // Bass: the lines are heavy while a bass note sounds, light otherwise; the grains grow
      // with them so a heavy line stays solid.
      const note = song.bassNotes.active(time);
      const heavy = note >= 0 && song.bassNotes.strength[note] > 0.3 ? easeOutCubic(clamp01((time - song.bassNotes.start[note]) / 0.06)) : 0;
      const weight = 0.018 + 0.022 * heavy;
      const pointSize = Math.max(1.5, 2.2 * (canvas.height / 1080)) * (1 + 0.45 * heavy);
      // Outro: the sand drains away.
      const drain = time > outroStart ? clamp01((time - outroStart) / Math.max(1, song.duration - outroStart)) * 0.95 : 0;

      // Voice: its sand in the figure of the sung line; on the key word the plate is its own.
      const voiceIndex = lastIndexAtOrBefore(voiceStarts, time + 0.1);
      let voicePresence = 0;
      if (voiceIndex >= 0) {
        const voice = voices[voiceIndex];
        voicePresence = Math.min(clamp01((time - voice.start + 0.1) / 0.2), clamp01((voice.end + 0.25 - time) / 0.25));
      }
      // the first frame shows the voice to come, and it gives way as the song starts
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
      const inHole = drop.phase === 2 || leadIn >= 0;
      if (inHole) voicePresence = 0; // the hole is the knot alone (unless the key word is sung into it)

      const sandColor = hexColor(colors.sand),
        voiceColor = hexColor(colors.voice);
      // the black sand steps back while the voice sings, and almost leaves for the key word
      const sandPresence = (1 - 0.55 * voicePresence) * (1 - 0.8 * keyMoment);
      drawSand(sandArray, plateGrains, previous, current, settle, gather, knot, sandPresence, sandColor, pointSize, ripples, weight, drain);
      if (keyMoment > 0.01) {
        const before = lastIndexAtOrBefore(voiceStarts, keyStart - 0.01);
        Object.assign(voiceBefore, before >= 0 ? voices[before].figure : plateKeyFigure);
        const voiceSettle = easeOutCubic(clamp01((time - keyStart) / 0.2));
        drawSand(voiceArray, plateVoiceGrains, voiceBefore, plateKeyFigure, voiceSettle, inHole ? 0.6 : gather, 0.3, keyMoment, voiceColor, pointSize * 1.5, ripples, 0.03, drain, 0.7);
      } else if (voicePresence > 0.01 && voices.length) {
        const index = Math.max(0, voiceIndex);
        Object.assign(voiceNow, voices[index].figure);
        const continuing = index > 0 && voices[index].start - voices[index - 1].end < 0.5;
        Object.assign(voiceBefore, voices[Math.max(0, index - 1)].figure);
        const voiceSettle = continuing ? easeInOutCubic(clamp01((time - voiceNow.start) / 0.25)) : 1;
        drawSand(voiceArray, plateVoiceGrains, continuing ? voiceBefore : voiceNow, voiceNow, voiceSettle, gather, knot * 1.4, voicePresence, voiceColor, pointSize * 1.35, ripples, 0.028, drain, 0.6);
      }
      drawLabels(time, width, height, drop, colors, kickHit, frame);
    }

    // The striker at the plate's centre, and captions as on an engraved plate: figure
    // number, mode, harmony, bar and time.
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
        const radius = plate.side * (0.018 + 0.06 * kickHit);
        labels.fillStyle = colors.sand;
        labels.beginPath();
        labels.arc(cx, cy, radius, 0, Math.PI * 2);
        labels.fill();
        labels.fillStyle = colors.plate;
        labels.beginPath();
        labels.arc(cx, cy, radius * 0.36, 0, Math.PI * 2);
        labels.fill();
      }
      labels.fillStyle = colors.ink;
      const chordIndex = song.chordIndex(time);
      const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
      const chord = chordIndex >= 0 ? song.chords[chordIndex] : null;
      const figureNumber = Math.max(0, lastIndexAtOrBefore(figureStarts, time)) + 1;
      const right = plate.x0 + plate.side,
        below = plate.y0 + plate.side + 36 * unit;
      labels.font = `italic 400 ${Math.round(38 * unit)}px "Instrument Serif", serif`;
      labels.textAlign = "right";
      labels.fillText(`Fig. ${figureNumber}`, right, below + 4 * unit);
      labels.textAlign = "left";
      labels.font = `400 ${Math.round(14 * unit)}px "IBM Plex Mono", monospace`;
      const harmony = chord ? `${names[chord.root]}${chord.minor ? " MINOR" : " MAJOR"}` : "";
      const bar = Math.max(0, Math.floor(song.barPosition(time)) + 1);
      const beat = Math.floor(fract(song.barPosition(time)) * 4) + 1;
      labels.fillText(`MODE (${current.mode[0]}, ${current.mode[1]})   ${harmony}`, plate.x0, below - 14 * unit);
      labels.fillText(`BAR ${String(bar).padStart(3, "0")}.${beat}   ${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, "0")}`, plate.x0, below + 4 * unit);
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
      debug: () => ({ figures, voices, grounds }),
    };
  },
});
