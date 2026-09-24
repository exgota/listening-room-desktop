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
uniform vec4 uModeA;     // pattern the sand is leaving: n1 m1 n2 m2
uniform vec4 uModeB;     // pattern it is moving to
uniform vec4 uMix;       // x weight of the second mode (A), y (B), z settle 0..1, w sign
uniform vec2 uAspect;    // pattern units across x, y
uniform vec4 uRect;      // plate in clip space: x0 y0 x1 y1
uniform vec4 uGather;    // x pull to the centre 0..1, y knot radius, z present 0..1, w hat shimmer
uniform vec4 uRipple[4]; // x age s, y strength, z speed, w unused
uniform float uTime;
uniform float uPointSize;
uniform float uSeedOffset;
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

float hash(float n) { return fract(sin(n * 12.9898 + uSeedOffset) * 43758.5453); }

void main() {
  // seed in pattern space: [0, aspect.x] x [0, aspect.y]
  vec2 home = aSeed.xy * uAspect;
  float r1, r2;
  vec2 a = settle(home, uModeA, uMix.x, uMix.w, r1);
  vec2 b = settle(home, uModeB, uMix.y, uMix.w, r2);
  float s = uMix.z;
  vec2 p = mix(a, b, s);
  float residual = mix(r1, r2, s);
  // a band of sand, not a hairline: each grain sits a little off the line
  vec2 grad = gradient(p, uModeB, uMix.y, uMix.w);
  vec2 normal = length(grad) > 1e-4 ? normalize(grad) : vec2(0.0, 1.0);
  p += normal * (aSeed.z - 0.5) * 0.018;
  // hats: a shimmer along the line
  p += vec2(sin(aSeed.w * 40.0 + uTime * 31.0), cos(aSeed.w * 33.0 + uTime * 27.0)) * uGather.w * 0.004;

  // to plate-normalized coordinates -1..1 around the centre
  vec2 q = p / uAspect * 2.0 - 1.0;
  vec2 aspectScale = vec2(uAspect.x / uAspect.y, 1.0);
  // kick: waves run out from the centre and throw the sand they pass
  for (int i = 0; i < 4; i++) {
    vec4 ripple = uRipple[i];
    if (ripple.y <= 0.0) continue;
    float radius = ripple.x * ripple.z;
    vec2 qs = q * aspectScale;
    float distance = length(qs);
    float band = exp(-pow((distance - radius) / 0.07, 2.0));
    float fade = exp(-ripple.x / 0.45);
    q += (distance > 1e-4 ? qs / distance : vec2(0.0)) / aspectScale * band * ripple.y * fade * 0.05;
  }
  // gather: the whole figure contracts toward the centre through a build (it stays a
  // figure, only smaller and denser); fully gathered it is a knot of the given radius
  vec2 knot = vec2(cos(aSeed.w * 6.2831853), sin(aSeed.w * 6.2831853)) * sqrt(aSeed.z) * uGather.y / aspectScale;
  float contract = 1.0 - 0.8 * uGather.x;
  q *= contract;
  q = mix(q, knot, smoothstep(0.9, 1.0, uGather.x));

  vec2 clip = mix(uRect.xy, uRect.zw, q * 0.5 + 0.5);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPointSize * (0.75 + 0.5 * aSeed.w);
  // grains that did not reach a line are faint (real sand leaves the antinodes empty)
  float onLine = 1.0 - smoothstep(0.004, 0.02, residual);
  vAlpha = mix(onLine, 1.0, uGather.x) * uGather.z;
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

    function setSong(model) {
      song = model;
      themeGround = "";
    }

    // The figure for the harmony at a time: chord root around the circle of fifths picks the
    // family, minor flips the sign, the scene's intensity adds complexity, and the sounding
    // bass note adds a second mode.
    function harmonyMode(time, into) {
      const chordIndex = song ? song.chordIndex(time) : -1;
      const scene = song ? song.scene(time) : null;
      let root = 0,
        minor = 0;
      if (chordIndex >= 0) {
        root = song.chords[chordIndex].root;
        minor = song.chords[chordIndex].minor;
      }
      const intensity = scene ? scene.intensity : 0.5;
      const base = Math.min(plateModes.length - 1, Math.round(plateCircle.indexOf(root) * 0.7 + intensity * 8));
      const [n, m] = plateModes[base];
      const note = song ? song.bassNotes.active(time) : -1;
      const pitchClass = note >= 0 ? Math.round(song.bassNotes.pitch[note]) % 12 : root;
      const [n2, m2] = plateModes[(plateCircle.indexOf(pitchClass) + 3) % 10];
      into.mode[0] = n; into.mode[1] = m; into.mode[2] = n2; into.mode[3] = m2;
      into.second = note >= 0 ? 0.3 : 0;
      into.sign = minor ? -1 : 1;
      into.start = Math.max(chordIndex >= 0 ? song.chords[chordIndex].start : 0, note >= 0 ? song.bassNotes.start[note] : 0);
      return into;
    }

    function voiceMode(time, into) {
      const note = song ? song.vocalNotes.active(time) : -1;
      const anchor = song && song.anchor.kind === "word" ? song.anchorAt(time) : -1;
      if (anchor >= 0) {
        into.mode[0] = 3; into.mode[1] = 3; into.mode[2] = 1; into.mode[3] = 7;
        into.second = 0.6;
        into.sign = -1;
        into.start = song.anchor.moments[anchor].start;
        into.present = 1;
        return into;
      }
      if (note < 0) {
        into.present = 0;
        into.start = 0;
        return into;
      }
      const pitch = Math.round(song.vocalNotes.pitch[note]);
      const [n, m] = plateModes[(plateCircle.indexOf(pitch % 12) + Math.max(0, Math.floor((pitch - 48) / 12)) * 3) % plateModes.length];
      into.mode[0] = n; into.mode[1] = m; into.mode[2] = m; into.mode[3] = n + 1;
      into.second = 0.25;
      into.sign = 1;
      into.start = song.vocalNotes.start[note];
      into.present = clamp01((song.vocalNotes.strength[note] - 0.15) / 0.3);
      return into;
    }

    const current = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0, present: 1 };
    const previous = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0, present: 1 };
    const voiceNow = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0, present: 0 };
    const voiceBefore = { mode: [1, 2, 1, 3], second: 0, sign: 1, start: 0, present: 0 };

    let density = 1.1;
    function drawSand(vertexArray, count, modeA, modeB, settle, gather, knot, present, color, time, pointSize, rippleData, shimmer, seedOffset) {
      const u = sand.uniforms;
      gl.useProgram(sand.program);
      gl.uniform4f(u.uModeA, modeA.mode[0], modeA.mode[1], modeA.mode[2], modeA.mode[3]);
      gl.uniform4f(u.uModeB, modeB.mode[0], modeB.mode[1], modeB.mode[2], modeB.mode[3]);
      gl.uniform4f(u.uMix, modeA.second, modeB.second, settle, modeB.sign);
      // the plate: 95.5% of the width, 80% of the height, below the title band
      const aspect = (0.955 * size.width) / Math.max(1, 0.8 * size.height);
      gl.uniform2f(u.uAspect, density * aspect, density);
      gl.uniform4f(u.uRect, -0.955, -0.94, 0.955, 0.66);
      gl.uniform4f(u.uGather, gather, knot, present, shimmer);
      gl.uniform4fv(u.uRipple, rippleData);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uPointSize, pointSize);
      gl.uniform1f(u.uSeedOffset, seedOffset);
      gl.uniform3f(u.uColor, color[0], color[1], color[2]);
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.POINTS, 0, count);
    }

    function render(time, frame) {
      const width = frame.width,
        height = frame.height;
      size = { width, height };
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
      gl.uniform4f(ground.uniforms.uFrame, 0.016, 0.022, 0.984, 0.836);
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
      density = 1.1 + 0.28 * Math.min(2, dropsPassed);
      // Harmony: the figure now, and the one before it for the migration.
      harmonyMode(time, current);
      harmonyMode(Math.max(0, current.start - 0.01), previous);
      const settle = easeInOutCubic((time - current.start) / 0.32);

      // Gather through a build; in the gap a knot that shrinks each beat; the drop throws it.
      let gather = 0,
        knot = 0.2;
      if (drop.phase === 1) gather = easeInCubic(drop.progress) * 0.88;
      if (drop.phase === 2) {
        const beatsLeft = Math.ceil((drop.drop.time - time) / song.beatPeriod - 1e-6);
        gather = 1;
        knot = 0.03 + 0.035 * Math.max(0, beatsLeft);
      }
      const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
      if (sinceDrop < 0.12) gather = 0;

      // Kick: the last four strikes, as waves.
      let rippleIndex = song.kicks.last(time);
      for (let slot = 0; slot < 4; slot++) {
        const age = rippleIndex >= 0 ? time - song.kicks.time[rippleIndex] : Infinity;
        const alive = age < 1.2;
        ripples[slot * 4] = alive ? age : 0;
        ripples[slot * 4 + 1] = alive ? song.kicks.strength[rippleIndex] * (drop.phase === 2 ? 0 : 1) : 0;
        ripples[slot * 4 + 2] = 1.8;
        ripples[slot * 4 + 3] = 0;
        rippleIndex--;
      }
      if (sinceDrop < 1.2) {
        ripples[0] = sinceDrop;
        ripples[1] = 2.5;
      }
      const shimmer = clamp01(song.hats.impulse(time, 0.05, 0.2));
      const pointSize = Math.max(1.5, 2.3 * (canvas.height / 1080));
      const grains = afterMain ? plateGrains : Math.round(plateGrains * (0.62 + 0.38 * Math.min(1, time / Math.max(1, song.drops[song.mainDrop]?.time || song.duration))));
      drawSand(sandArray, grains, previous, current, settle, gather, knot, 1, ink, time, pointSize, ripples, shimmer, 0);

      // Voice: vermilion sand in the figure of the sung note; away when nobody sings.
      voiceMode(time, voiceNow);
      if (voiceNow.present > 0 || voiceNow.start > 0) {
        voiceMode(Math.max(0, voiceNow.start - 0.01), voiceBefore);
        const voiceSettle = easeOutCubic((time - voiceNow.start) / 0.12);
        const present = voiceNow.present * (voiceBefore.present > 0 ? 1 : voiceSettle);
        drawSand(voiceArray, plateVoiceGrains, voiceBefore.present > 0 ? voiceBefore : voiceNow, voiceNow, voiceSettle, gather * 0.6, knot * 1.6, present, voiceColor, time, pointSize * 1.1, ripples, 0, 3.7);
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
      const figureNumber = chordIndex >= 0 ? chordIndex + 1 : 0;
      labels.textAlign = "right";
      labels.fillText(`Fig. ${figureNumber}`, width * 0.9825 - 6 * unit, height * 0.975);
      labels.textAlign = "left";
      labels.font = `400 ${Math.round(13 * unit)}px "IBM Plex Mono", monospace`;
      const bar = Math.max(0, Math.floor(song.barPosition(time)) + 1);
      const beat = Math.floor(fract(song.barPosition(time)) * 4) + 1;
      const mode = `(${current.mode[0]}, ${current.mode[1]})${current.second > 0 ? ` + (${current.mode[2]}, ${current.mode[3]})` : ""}`;
      const harmony = chord ? `${names[chord.root]}${chord.minor ? " minor" : " major"}` : "";
      const line = `MODE ${mode}   ${harmony.toUpperCase()}   BAR ${String(bar).padStart(3, "0")}.${beat}   ${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, "0")}`;
      labels.fillText(line, width * 0.0175 + 6 * unit, height * 0.975 - 8 * unit);
    }

    return {
      canvas: container,
      setSong,
      themeFor() {
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
