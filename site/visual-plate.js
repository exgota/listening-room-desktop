// Plate: Chladni figures. A plate fills the frame and sand lies on its nodal lines. The
// harmony and the bass choose the plate's mode, and the sand migrates to the new lines when
// they change; the kick strikes the centre and a wave runs out through the sand; the voice
// is a second sand, vermilion, tuned to the sung pitch. A build gathers all the sand into
// the centre, the gap shrinks that knot beat by beat, and the drop throws it out into the
// new figure on the exact frame. The main drop turns the ground from ivory to vermilion.
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
uniform vec3 uScale;     // pattern units per plate half-width (x), half-height (y); z unused
uniform vec4 uRect;      // plate in clip space: x0 y0 x1 y1
uniform vec4 uGather;    // x pull to the centre 0..1, y knot radius, z present 0..1, w line weight
uniform vec4 uRipple[4]; // x age s, y strength, z speed, w unused
uniform float uPointSize;
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
    if (len > 0.045) step *= 0.045 / len;
    p -= step;
  }
  float f = field(p, mode, second, sign);
  residual = abs(f) / (length(gradient(p, mode, second, sign)) + 1e-3);
  return p;
}

void main() {
  // Pattern space is centred on the plate's centre (where the kick strikes and the knot
  // gathers), so every figure is symmetric about it.
  vec2 home = (aSeed.xy * 2.0 - 1.0) * uScale.xy;
  float r1, r2;
  vec2 a = settle(home, uModeA, uMix.x, uSignA, r1);
  vec2 b = settle(home, uModeB, uMix.y, uMix.w, r2);
  float s = uMix.z;
  vec2 p = mix(a, b, s);
  float residual = mix(r1, r2, s);
  // Line weight: each grain sits off the line by its own amount, scaled by the bass.
  vec2 grad = gradient(p, uModeB, uMix.y, uMix.w);
  vec2 normal = length(grad) > 1e-4 ? normalize(grad) : vec2(0.0, 1.0);
  p += normal * (aSeed.z - 0.5) * uGather.w;

  vec2 q = p / uScale.xy; // -1..1 across the plate
  vec2 aspect = vec2(uScale.x / uScale.y, 1.0);
  // Kick: a wave runs out from the centre and throws the sand it passes outward.
  for (int i = 0; i < 4; i++) {
    vec4 ripple = uRipple[i];
    if (ripple.y <= 0.0) continue;
    float radius = ripple.x * ripple.z;
    vec2 qs = q * aspect;
    float distance = length(qs);
    float band = exp(-pow((distance - radius) / 0.1, 2.0));
    float fade = exp(-ripple.x / 0.5);
    q += (distance > 1e-4 ? qs / distance : vec2(0.0)) / aspect * band * ripple.y * fade * 0.075;
  }
  // Gather: the figure contracts toward the centre through a build; fully gathered it is a
  // knot of the given radius.
  vec2 knot = vec2(cos(aSeed.w * 6.2831853), sin(aSeed.w * 6.2831853)) * sqrt(aSeed.z) * uGather.y / aspect;
  q *= 1.0 - 0.8 * uGather.x;
  q = mix(q, knot, smoothstep(0.9, 1.0, uGather.x));
  // Nothing leaves the plate.
  float outside = step(1.0, max(abs(q.x), abs(q.y)));
  q = clamp(q, -1.0, 1.0);

  vec2 clip = mix(uRect.xy, uRect.zw, q * 0.5 + 0.5);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPointSize * (0.75 + 0.5 * aSeed.w);
  // grains that did not reach a line are faint (real sand leaves the antinodes empty)
  float onLine = 1.0 - smoothstep(0.004, 0.02, residual);
  vAlpha = mix(onLine, 1.0, uGather.x) * uGather.z * (1.0 - outside);
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
  outColor = vec4(uColor * (0.85 + 0.3 * vShade), vAlpha * 0.9);
}`;

const plateGroundShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec3 uGround;
uniform vec3 uInk;
uniform vec2 uResolution;
uniform vec4 uFrame; // inset frame in uv: x0 y0 x1 y1
void main() {
  vec3 color = uGround;
  vec2 px = 1.0 / uResolution;
  // an engraving border: one hairline inset
  float line = 0.0;
  vec2 lo = abs(vUv - uFrame.xy), hi = abs(vUv - uFrame.zw);
  bool inside = vUv.x > uFrame.x - px.x && vUv.x < uFrame.z + px.x && vUv.y > uFrame.y - px.y && vUv.y < uFrame.w + px.y;
  if (inside && (lo.x < 1.2 * px.x || hi.x < 1.2 * px.x || lo.y < 1.2 * px.y || hi.y < 1.2 * px.y)) line = 1.0;
  color = mix(color, uInk, line * 0.85);
  // a faint darkening toward the edges of the sheet
  vec2 c = vUv - 0.5;
  color *= 1.0 - 0.06 * dot(c, c) * 2.0;
  outColor = vec4(color, 1.0);
}`;

// Mode pairs by complexity; harmony picks among them.
const plateModes = [
  [1, 2], [1, 3], [2, 3], [1, 4], [2, 5], [3, 4], [1, 5], [3, 5], [2, 7], [4, 5],
  [1, 6], [3, 7], [4, 7], [2, 9], [5, 6], [1, 8], [3, 8], [5, 7], [4, 9], [6, 7],
];
const plateCircle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

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

    const ivory = hexColor("#efe9dc");
    const ink = hexColor("#171513");
    const vermilion = hexColor("#e2401c");
    let song = null;
    let scale = 1;
    let size = { width: 1, height: 1 };
    let themeGround = "";
    const ripples = new Float32Array(16);

    let voiceFigures = []; // [{time, pitch}] where the voice figure changes
    let voicePhrases = []; // [{start, end}] where the voice sand is present
    let figures = []; // [{start, chord, variant}]: one per chord, and a new variant every two bars of a long one
    let figureStarts = new Float64Array(0);

    function setSong(model) {
      song = model;
      themeGround = "";
      voiceFigures = [];
      voicePhrases = [];
      figures = [];
      if (!model) {
        figureStarts = new Float64Array(0);
        return;
      }
      // A chord held for more than three bars gets a related figure every two bars, so a long
      // pedal (Outside's 28 s outro, NBLY's 31 s intro) keeps moving at the bar, never faster.
      model.chords.forEach((chord, index) => {
        figures.push({ start: chord.start, chord: index, variant: 0 });
        const bar = model.barIndex(chord.start + 0.05);
        for (let step = 1; ; step++) {
          const start = model.barTime(bar + step * 2);
          if (start > chord.end - model.barPeriod) break;
          figures.push({ start, chord: index, variant: step });
        }
      });
      figureStarts = Float64Array.from(figures.map((figure) => figure.start));
      // Sung notes merge into phrases (gaps under 0.4 s); inside a phrase the figure changes
      // only for a new pitch class held after at least 0.3 s, so syllables do not flicker it.
      const notes = model.vocalNotes;
      let phrase = null,
        lastFigure = -Infinity,
        lastClass = -1;
      for (let index = 0; index < notes.length; index++) {
        if (notes.strength[index] < 0.2) continue;
        const start = notes.start[index],
          end = notes.end[index];
        if (!phrase || start - phrase.end > 0.4) {
          phrase = { start, end };
          voicePhrases.push(phrase);
          lastFigure = -Infinity;
          lastClass = -1;
        }
        phrase.end = Math.max(phrase.end, end);
        const pitchClass = Math.round(notes.pitch[index]) % 12;
        if (pitchClass !== lastClass && start - lastFigure >= 0.3) {
          voiceFigures.push({ time: start, pitch: notes.pitch[index] });
          lastFigure = start;
          lastClass = pitchClass;
        }
      }
    }

    // The figure for the harmony: one per chord (and per two bars of a held chord). The root
    // around the circle of fifths picks the family, the section's intensity at the chord's start
    // adds complexity, minor flips the sign, and a second mode tied to the root enriches it.
    // Before the first chord the song's first figure is already on the plate.
    function harmonyMode(figureIndex, into) {
      let root = 0,
        minor = 0,
        intensity = 0.5,
        start = 0,
        variant = 0;
      const figure = figures[Math.max(0, figureIndex)];
      if (figure) {
        const chord = song.chords[figure.chord];
        root = chord.root;
        minor = chord.minor;
        start = figureIndex >= 0 ? figure.start : -Infinity;
        variant = figure.variant;
        intensity = song.scene(chord.start + 0.01).intensity;
      }
      const circle = plateCircle.indexOf(root);
      // capped so the figure stays bold at phone size
      const base = Math.min(11, Math.round(circle * 0.45 + intensity * 6));
      const [n, m] = plateModes[base];
      const [n2, m2] = plateModes[(circle * 5 + 3 + variant * 3) % 8];
      into.mode[0] = n; into.mode[1] = m; into.mode[2] = n2; into.mode[3] = m2;
      into.second = variant % 2 ? -0.3 : 0.35;
      into.sign = minor ? -1 : 1;
      into.start = start;
      return into;
    }

    function figureIndexAt(time) {
      let low = 0,
        high = voiceFigures.length - 1,
        found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (voiceFigures[middle].time <= time) {
          found = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      return found;
    }

    function voiceFigure(index, into) {
      const pitch = Math.round(voiceFigures[index].pitch);
      // the voice keeps to the simplest figures, drawn large, so it reads apart from the lattice
      const [n, m] = plateModes[(plateCircle.indexOf(pitch % 12) + Math.max(0, Math.floor((pitch - 48) / 12)) * 2) % 8];
      into.mode[0] = n; into.mode[1] = m; into.mode[2] = m; into.mode[3] = n + 1;
      into.second = 0.2;
      into.sign = 1;
      into.start = voiceFigures[index].time;
      return into;
    }

    const anchorFigure = { mode: [1, 3, 2, 2], second: 0.35, sign: -1, start: 0 };
    const current = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const previous = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const voiceNow = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };
    const voiceBefore = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0 };

    let density = 1.1;
    // The plate: 95.5% of the width, from under the title to just above the captions.
    const plate = { top: 0.17, bottom: 0.935 };
    function drawSand(vertexArray, count, modeA, modeB, settle, gather, knot, present, color, pointSize, rippleData, weight, scaleFactor = 1) {
      const u = sand.uniforms;
      gl.useProgram(sand.program);
      gl.uniform4f(u.uModeA, modeA.mode[0], modeA.mode[1], modeA.mode[2], modeA.mode[3]);
      gl.uniform4f(u.uModeB, modeB.mode[0], modeB.mode[1], modeB.mode[2], modeB.mode[3]);
      gl.uniform4f(u.uMix, modeA.second, modeB.second, settle, modeB.sign);
      gl.uniform1f(u.uSignA, modeA.sign);
      const aspect = (0.955 * size.width) / Math.max(1, (plate.bottom - plate.top) * size.height);
      gl.uniform3f(u.uScale, density * scaleFactor * aspect, density * scaleFactor, 0);
      gl.uniform4f(u.uRect, -0.955, 1 - 2 * plate.bottom, 0.955, 1 - 2 * plate.top);
      gl.uniform4f(u.uGather, gather, knot, present, weight);
      gl.uniform4fv(u.uRipple, rippleData);
      gl.uniform1f(u.uPointSize, pointSize);
      gl.uniform3f(u.uColor, color[0], color[1], color[2]);
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      size = { width, height };
      plate.top = Math.max(0.17, ((frame.titleBottom || 0) + height * 0.02) / height);
      const drop = song ? song.dropContext(time) : null;
      const afterMain = song && song.mainDrop >= 0 && time >= song.drops[song.mainDrop].time;
      const groundColor = afterMain ? vermilion : ivory;
      const voiceColor = afterMain ? ivory : vermilion;
      const groundHex = afterMain ? "#e2401c" : "#efe9dc";
      if (groundHex !== themeGround) {
        themeGround = groundHex;
        document.documentElement.style.setProperty("--plate-ground", groundHex);
        waveformTheme = null;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(ground.program);
      gl.uniform3f(ground.uniforms.uGround, groundColor[0], groundColor[1], groundColor[2]);
      gl.uniform3f(ground.uniforms.uInk, ink[0], ink[1], ink[2]);
      gl.uniform2f(ground.uniforms.uResolution, canvas.width, canvas.height);
      gl.uniform4f(ground.uniforms.uFrame, 0.0165, 1 - plate.bottom - 0.008, 0.9835, 1 - plate.top + 0.008);
      gl.bindVertexArray(emptyVertexArray);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!song) {
        drawLabels(time, width, height, null);
        return;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // Each drop makes the plate finer: more cells in the same frame.
      let dropsPassed = 0;
      for (const entry of song.drops) if (entry.time <= time) dropsPassed++;
      density = 1.0 + 0.14 * Math.min(2, dropsPassed);
      // Harmony: the figure, migrating from the previous one over 0.25 s.
      const figureIndex = lastIndexAtOrBefore(figureStarts, time);
      harmonyMode(figureIndex, current);
      harmonyMode(figureIndex - 1, previous);
      const settle = figureIndex > 0 ? easeInOutCubic((time - current.start) / 0.25) : 1;

      // Gather through a build; in the gap a knot that shrinks each beat; the drop throws it.
      // A drop with no gap still gets one: the last beat before it is the knot.
      let gather = 0,
        knot = 0.2;
      if (drop.phase === 1) gather = easeInCubic(drop.progress) * 0.88;
      if (drop.phase === 2) {
        const beatsLeft = Math.ceil((drop.drop.time - time) / song.beatPeriod - 1e-6);
        gather = 1;
        knot = 0.03 + 0.035 * Math.max(0, beatsLeft);
      }
      const nextDrop = drop.phase === 3 ? song.drops[drop.index + 1] : drop.drop;
      if (nextDrop && nextDrop.gapStart >= nextDrop.time - 0.05) {
        const lead = nextDrop.time - time;
        if (lead > 0 && lead <= song.beatPeriod) {
          gather = Math.max(gather, easeOutCubic(1 - lead / song.beatPeriod) * 0.9 + 0.1);
          knot = 0.06;
        }
      }
      const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
      if (leadIn >= 0 && drop.phase !== 2) {
        gather = 1;
        knot = 0.06;
      }
      // The drop throws the knot out into the figure over the next 0.18 s.
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      if (sinceDrop < 0.18) gather = 1 - easeOutCubic(sinceDrop / 0.18);

      // Kick: the last four strikes run out from the centre as waves.
      let rippleIndex = song.kicks.last(time);
      for (let slot = 0; slot < 4; slot++) {
        const age = rippleIndex >= 0 ? time - song.kicks.time[rippleIndex] : Infinity;
        const alive = age < 1.4 && gather < 0.5;
        ripples[slot * 4] = alive ? age : 0;
        ripples[slot * 4 + 1] = alive ? song.kicks.strength[rippleIndex] : 0;
        ripples[slot * 4 + 2] = 1.7;
        ripples[slot * 4 + 3] = 0;
        rippleIndex--;
      }
      if (sinceDrop < 1.4) {
        ripples[0] = sinceDrop;
        ripples[1] = 2.2;
      }
      // Bass: the plate rings harder, so the sand band widens with the bass.
      const bassLevel = clamp01(song.mean("bass", time - 0.04, time + 0.01));
      const weight = 0.028 + 0.05 * bassLevel * bassLevel;
      const pointSize = Math.max(1.5, 2.4 * (canvas.height / 1080));
      const grains = afterMain ? plateGrains : Math.round(plateGrains * (0.7 + 0.3 * Math.min(1, time / Math.max(1, song.drops[song.mainDrop]?.time || song.duration))));
      // Voice: vermilion sand in the figure of the sung note, present through each phrase. On
      // the key word the black sand steps back and the voice's own figure takes the plate.
      const anchor = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      const keyMoment = anchor >= 0 ? easeOutCubic((time - song.anchor.moments[anchor].start) / 0.12) : 0;
      drawSand(sandArray, grains, previous, current, settle, gather, knot, 1 - 0.7 * keyMoment, ink, pointSize, ripples, weight);

      let presence = 0;
      for (const phrase of voicePhrases) {
        if (phrase.start - 0.15 > time) break;
        if (time < phrase.end + 0.25) presence = Math.max(presence, Math.min(clamp01((time - phrase.start + 0.15) / 0.15), clamp01((phrase.end + 0.25 - time) / 0.25)));
      }
      if (anchor >= 0) {
        anchorFigure.start = song.anchor.moments[anchor].start;
        const figure = figureIndexAt(anchorFigure.start - 0.01);
        if (figure >= 0) voiceFigure(figure, voiceBefore);
        const voiceSettle = easeOutCubic((time - anchorFigure.start) / 0.2);
        drawSand(voiceArray, plateVoiceGrains, figure >= 0 ? voiceBefore : anchorFigure, anchorFigure, voiceSettle, gather * 0.6, knot * 1.6, 1, voiceColor, pointSize * 1.5, ripples, 0.04, 0.45);
      } else if (presence > 0) {
        const figure = figureIndexAt(time);
        if (figure >= 0) {
          voiceFigure(figure, voiceNow);
          if (figure > 0) voiceFigure(figure - 1, voiceBefore);
          const voiceSettle = figure > 0 ? easeInOutCubic((time - voiceNow.start) / 0.2) : 1;
          drawSand(voiceArray, plateVoiceGrains, figure > 0 ? voiceBefore : voiceNow, voiceNow, voiceSettle, gather * 0.6, knot * 1.6, presence, voiceColor, pointSize * 1.3, ripples, 0.03, 0.55);
        }
      }
      drawLabels(time, width, height, drop);
    }

    // Captions, as on an engraved plate: figure number, mode, harmony, bar and time.
    function drawLabels(time, width, height, drop) {
      labels.setTransform(scale, 0, 0, scale, 0, 0);
      labels.clearRect(0, 0, width, height);
      if (!song) return;
      const unit = height / 1080;
      labels.fillStyle = "#171513";
      labels.font = `italic 400 ${Math.round(34 * unit)}px "Instrument Serif", serif`;
      const chordIndex = song.chordIndex(time);
      const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
      const chord = chordIndex >= 0 ? song.chords[chordIndex] : null;
      const figureNumber = Math.max(0, lastIndexAtOrBefore(figureStarts, time)) + 1;
      labels.textAlign = "right";
      labels.fillText(`Fig. ${figureNumber}`, width * 0.9835, height * 0.982);
      labels.textAlign = "left";
      // Kick: the striker at the plate's centre, a black boss that jumps on every kick.
      const kickAge = song.kicks.since(time);
      const kickIndex = song.kicks.last(time);
      const hit = kickIndex >= 0 ? song.kicks.strength[kickIndex] * hitDecay(kickAge, 0.09) : 0;
      const gathered = drop && (drop.phase === 2 || (drop.phase === 1 && drop.progress > 0.9));
      if (!gathered) {
        const cx = width / 2,
          cy = height * (plate.top + plate.bottom) / 2;
        labels.fillStyle = "#171513";
        labels.beginPath();
        labels.arc(cx, cy, (14 + 34 * hit) * unit, 0, Math.PI * 2);
        labels.fill();
        labels.fillStyle = themeGround;
        labels.beginPath();
        labels.arc(cx, cy, (5 + 10 * hit) * unit, 0, Math.PI * 2);
        labels.fill();
      }
      labels.font = `400 ${Math.round(13 * unit)}px "IBM Plex Mono", monospace`;
      const bar = Math.max(0, Math.floor(song.barPosition(time)) + 1);
      const beat = Math.floor(fract(song.barPosition(time)) * 4) + 1;
      const mode = `(${current.mode[0]}, ${current.mode[1]})${current.second > 0 ? ` + (${current.mode[2]}, ${current.mode[3]})` : ""}`;
      const harmony = chord ? `${names[chord.root]}${chord.minor ? " minor" : " major"}` : "";
      const line = `MODE ${mode}   ${harmony.toUpperCase()}   BAR ${String(bar).padStart(3, "0")}.${beat}   ${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, "0")}`;
      labels.fillText(line, width * 0.0165, height * 0.982 - 6 * unit);
    }

    return {
      canvas: container,
      setSong,
      themeFor() {
        themeGround = "";
        return { "--plate-ground": "#efe9dc" };
      },
      setActive(on) {
        container.hidden = !on;
      },
      resize(width, height, ratio) {
        const [w, h, s] = canvasPixels(width, height, Math.min(ratio, 2), 1920 * 1080);
        canvas.width = w;
        canvas.height = h;
        const [lw, lh, ls] = canvasPixels(width, height, Math.min(ratio, 2), 2560 * 1440);
        overlay.width = lw;
        overlay.height = lh;
        scale = ls;
      },
      render,
    };
  },
});
