// Rig: a timecoded lighting show in a black room. Moving heads on a back truss follow the
// bass line, a row of floor jets fires on every kick, a follow-spot from above tracks the
// voice, strobe cells on the truss take the backbeat. Builds converge the beams and push
// the camera in, the gap before a drop is a blackout that counts in, and the drop fires
// every fixture on its exact frame. The beams are single scattering in haze, integrated in
// closed form per pixel (no bloom, no post-process).

const rigHeadCount = 8;
const rigJetCount = 8;
const rigBeamCount = rigHeadCount + rigJetCount + 1;
// Fixture order: symmetric pairs spreading outward, so a partly lit rig stays balanced.
const rigHeadOrder = [3, 4, 1, 6, 2, 5, 0, 7];
const rigGels = {
  "5ff86d6cd02ebd7308e03df8": "#3f74ff", // NBLY: cold blue
  "1d589940ca458d793a3fad8a": "#ff2d2d", // Desire: red
  f127a026dc751f1528bfb95d: "#2fe0b5", // Ophelia: mint
  "8eee874c702a10807f79706c": "#ffb020", // Outside: amber
  "4048d4a6dce44c151690b2b1": "#ff3fb4", // American Boy: magenta
};

const rigFragmentShader = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec3 uCameraPosition;
uniform vec3 uCameraTarget;
uniform float uFov;
uniform vec4 uBeamApex[${rigBeamCount}];   // xyz apex, w cos(half angle)
uniform vec4 uBeamAxis[${rigBeamCount}];   // xyz axis, w intensity
uniform vec4 uBeamColor[${rigBeamCount}];  // rgb, w length
uniform vec4 uHaze;        // x density, y texture amount, z drift time, w floor gloss
uniform vec4 uFlash;       // rgb, w amount
uniform vec4 uStrobe;      // x snare flash, y hat sparkle, z seed, w truss light
uniform vec4 uWash;        // rgb back wall wash, w amount
uniform float uLens;
uniform float uSeed;
uniform sampler3D uNoise;

const float INF = 1e6;

// The part of the ray inside the forward nappe of a cone, clipped to [0, far] and to the
// beam's length. A cone narrower than 90 degrees is convex, so this is one interval.
bool coneSpan(vec3 origin, vec3 direction, vec3 apex, vec3 axis, float cosAngle, float len, float far, out float t0, out float t1) {
  vec3 offset = origin - apex;
  float dv = dot(direction, axis);
  float cv = dot(offset, axis);
  float c2 = cosAngle * cosAngle;
  float a = dv * dv - c2;
  float h = dv * cv - dot(direction, offset) * c2;
  float c = cv * cv - dot(offset, offset) * c2;
  if (abs(a) < 1e-6) a = a < 0.0 ? -1e-6 : 1e-6;
  float disc = h * h - a * c;
  if (disc < 0.0) {
    if (a < 0.0) return false;
    t0 = -INF; t1 = INF;
  } else {
    float root = sqrt(disc);
    float r1 = (-h - root) / a, r2 = (-h + root) / a;
    if (r1 > r2) { float s = r1; r1 = r2; r2 = s; }
    if (a < 0.0) { t0 = r1; t1 = r2; }
    else if (cv + (r1 - 1.0) * dv >= 0.0) { t0 = -INF; t1 = r1; }
    else { t0 = r2; t1 = INF; }
  }
  // forward nappe and length: 0 <= cv + t dv <= len
  if (abs(dv) > 1e-6) {
    float tStart = (0.0 - cv) / dv, tEnd = (len - cv) / dv;
    if (dv > 0.0) { t0 = max(t0, tStart); t1 = min(t1, tEnd); }
    else { t0 = max(t0, tEnd); t1 = min(t1, tStart); }
  } else if (cv < 0.0 || cv > len) return false;
  t0 = max(t0, 0.0);
  t1 = min(t1, far);
  return t1 > t0;
}

// Light scattered toward the eye by one beam along [t0, t1]: the 1/d^2 integral in closed
// form, times the beam's angular profile at the chord's closest approach to the axis.
vec3 beamScatter(vec3 origin, vec3 direction, int index, float far, bool textured) {
  vec4 apexData = uBeamApex[index];
  vec4 axisData = uBeamAxis[index];
  if (axisData.w <= 0.0005) return vec3(0.0);
  float t0, t1;
  vec3 apex = apexData.xyz, axis = axisData.xyz;
  float cosAngle = apexData.w;
  if (!coneSpan(origin, direction, apex, axis, cosAngle, uBeamColor[index].w, far, t0, t1)) return vec3(0.0);
  vec3 offset = origin - apex;
  float b = dot(direction, offset);
  float q2 = max(dot(offset, offset) - b * b, 1e-4);
  float q = sqrt(q2);
  float integral = (atan((t1 + b) / q) - atan((t0 + b) / q)) / q;
  // closest approach of the chord to the axis line gives the brightest point of the profile
  vec3 w0 = offset;
  float dd = dot(direction, axis);
  float denom = 1.0 - dd * dd;
  float tc = denom > 1e-5 ? (dd * dot(w0, axis) - dot(w0, direction)) / denom : 0.5 * (t0 + t1);
  tc = clamp(tc, t0, t1);
  vec3 point = origin + direction * tc - apex;
  float along = dot(point, axis);
  float cosTheta = along / max(length(point), 1e-4);
  float edge = clamp((cosTheta - cosAngle) / (1.0 - cosAngle), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.22, edge) * (0.55 + 0.45 * edge * edge);
  float density = 1.0;
  if (textured) {
    vec3 middle = origin + direction * (0.5 * (t0 + t1));
    float n = texture(uNoise, middle * vec3(0.045, 0.07, 0.045) + vec3(uHaze.z * 0.013, uHaze.z * 0.006, 0.0)).r;
    float n2 = texture(uNoise, middle * vec3(0.13, 0.2, 0.13) - vec3(0.0, uHaze.z * 0.02, uHaze.z * 0.01)).r;
    density = mix(1.0, 0.35 + 1.3 * n * (0.6 + 0.8 * n2), uHaze.y);
  }
  return uBeamColor[index].rgb * (axisData.w * integral * profile * density * uHaze.x);
}

// A lens seen from the front: a hard disc, brightest when the fixture points at the eye.
// Small angles only, so the angle is taken from the cosine without acos.
vec3 lensGlow(vec3 origin, vec3 direction, int index) {
  vec4 axisData = uBeamAxis[index];
  vec3 toLens = uBeamApex[index].xyz - origin;
  float distanceToLens = length(toLens);
  vec3 toLensUnit = toLens / distanceToLens;
  float facing = max(0.0, -dot(toLensUnit, axisData.xyz));
  float size = 0.34 / distanceToLens;
  float angle = sqrt(max(0.0, 2.0 - 2.0 * dot(direction, toLensUnit)));
  if (angle > size * 12.0) return vec3(0.0);
  float disc = 1.0 - smoothstep(size * 0.8, size, angle);
  float halo = exp(-angle / (size * 2.5)) * 0.25;
  float power = axisData.w * (0.08 + 2.0 * pow(facing, 12.0));
  return uBeamColor[index].rgb * (disc + halo) * power * uLens;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 pixel = vUv * uResolution;
  vec2 ndc = (pixel - 0.5 * uResolution) / uResolution.y;
  vec3 forward = normalize(uCameraTarget - uCameraPosition);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  float focal = 0.5 / tan(0.5 * uFov);
  vec3 direction = normalize(forward * focal + right * ndc.x + up * ndc.y);
  vec3 origin = uCameraPosition;

  float far = 80.0;
  bool hitsFloor = direction.y < -1e-4;
  float floorT = hitsFloor ? -origin.y / direction.y : INF;
  far = min(far, floorT);
  // back wall at z = -14
  float wallT = direction.z < -1e-4 ? (-14.0 - origin.z) / direction.z : INF;
  far = min(far, wallT);

  vec3 color = vec3(0.0);
  for (int index = 0; index < ${rigBeamCount}; index++) {
    color += beamScatter(origin, direction, index, far, true);
    if (uBeamAxis[index].w > 0.0005 && index < ${rigHeadCount}) color += lensGlow(origin, direction, index);
  }

  // Back wall: a low wash of the chord colour at the horizon.
  if (wallT < floorT && wallT < INF) {
    vec3 wall = origin + direction * wallT;
    float band = exp(-abs(wall.y - 1.2) * 0.35);
    color += uWash.rgb * uWash.w * band * 0.35;
  }

  // Truss strobe cells: a row of small squares under the moving heads.
  {
    float trussZ = -7.0, trussY = 7.9;
    float tz = direction.z < -1e-4 ? (trussZ - origin.z) / direction.z : INF;
    if (tz < far) {
      vec3 p = origin + direction * tz;
      if (abs(p.y - trussY) < 0.3 && abs(p.x) < 11.0) {
        float cell = floor(p.x / 1.1);
        float inCell = step(abs(fract(p.x / 1.1) - 0.5), 0.32);
        float sparkle = step(1.0 - uStrobe.y, hash12(vec2(cell, uStrobe.z)));
        float light = uStrobe.x + sparkle * 0.9 + uStrobe.w * 0.06;
        color += vec3(1.0, 0.97, 0.92) * inCell * light * 1.4;
      }
    }
  }

  // Floor: pools where beams land, and a glossy reflection of the room above it.
  if (hitsFloor && floorT <= far + 1e-3 && floorT < wallT) {
    vec3 p = origin + direction * floorT;
    vec3 pool = vec3(0.0);
    for (int index = 0; index < ${rigBeamCount}; index++) {
      vec4 axisData = uBeamAxis[index];
      if (axisData.w <= 0.0005) continue;
      vec3 toPoint = p - uBeamApex[index].xyz;
      float d = length(toPoint);
      if (d > uBeamColor[index].w) continue;
      float cosTheta = dot(toPoint / d, axisData.xyz);
      float cosAngle = uBeamApex[index].w;
      float edge = clamp((cosTheta - cosAngle) / (1.0 - cosAngle), 0.0, 1.0);
      float incidence = max(0.0, -toPoint.y / d);
      pool += uBeamColor[index].rgb * axisData.w * smoothstep(0.0, 0.12, edge) * incidence / (d * d) * 0.55;
    }
    vec3 reflected = reflect(direction, vec3(0.0, 1.0, 0.0));
    vec3 mirror = vec3(0.0);
    float wall2 = reflected.z < -1e-4 ? (-14.0 - p.z) / reflected.z : 40.0;
    for (int index = 0; index < ${rigBeamCount}; index++) mirror += beamScatter(p + reflected * 0.01, reflected, index, min(40.0, wall2), false);
    float fresnel = 0.25 + 0.75 * pow(1.0 - max(0.0, -direction.y), 5.0);
    float streaks = 0.75 + 0.25 * texture(uNoise, vec3(p.x * 0.03, 0.5, p.z * 0.8)).r;
    color = color * 0.35 + pool * streaks + mirror * uHaze.w * fresnel * streaks;
    color += vec3(0.012, 0.012, 0.014) * (1.0 - smoothstep(0.0, 30.0, floorT));
  }

  color += uFlash.rgb * uFlash.w;
  // Filmic shoulder keeps white beams white without clipping hard.
  color = vec3(1.0) - exp(-color * 1.35);
  color = pow(color, vec3(0.92));
  float vignette = 1.0 - 0.28 * dot(ndc * vec2(0.62, 1.0), ndc * vec2(0.62, 1.0));
  color *= vignette;
  // Dither against banding in the dark gradients (and against codec blocking).
  color += (hash12(pixel + uSeed) - 0.5) / 255.0 * 1.5;
  outColor = vec4(color, 1.0);
}`;

registerVisualizer({
  key: "rig",
  name: "Rig",
  order: 1,
  create() {
    const canvas = createVisualCanvas();
    const gl = createWebGL(canvas);
    const { program, uniforms } = compileWebGLProgram(gl, fullscreenVertexShader, rigFragmentShader);
    const vertexArray = gl.createVertexArray();
    // A small tiling value-noise volume for the haze, made once and deterministic.
    const noiseSize = 32;
    const noiseData = new Uint8Array(noiseSize * noiseSize * noiseSize);
    {
      const lattice = new Float32Array(9 * 9 * 9);
      for (let index = 0; index < lattice.length; index++) lattice[index] = hash01(index * 7919 + 17);
      const at = (x, y, z) => lattice[(z % 8) * 81 + (y % 8) * 9 + (x % 8)];
      for (let z = 0; z < noiseSize; z++)
        for (let y = 0; y < noiseSize; y++)
          for (let x = 0; x < noiseSize; x++) {
            const fx = (x / noiseSize) * 8, fy = (y / noiseSize) * 8, fz = (z / noiseSize) * 8;
            const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
            const sx = smoothStep(0, 1, fx - ix), sy = smoothStep(0, 1, fy - iy), sz = smoothStep(0, 1, fz - iz);
            let value = 0;
            for (let corner = 0; corner < 8; corner++) {
              const cx = corner & 1, cy = (corner >> 1) & 1, cz = (corner >> 2) & 1;
              value += at(ix + cx, iy + cy, iz + cz) * (cx ? sx : 1 - sx) * (cy ? sy : 1 - sy) * (cz ? sz : 1 - sz);
            }
            noiseData[(z * noiseSize + y) * noiseSize + x] = Math.round(value * 255);
          }
    }
    const noiseTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, noiseTexture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, noiseSize, noiseSize, noiseSize, 0, gl.RED, gl.UNSIGNED_BYTE, noiseData);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, wrap, gl.REPEAT);

    const apex = new Float32Array(rigBeamCount * 4);
    const axis = new Float32Array(rigBeamCount * 4);
    const color = new Float32Array(rigBeamCount * 4);
    const show = createRigShow();
    let song = null;
    return {
      canvas,
      setSong(model) {
        song = model;
        show.setSong(model);
      },
      setActive(on) {
        canvas.hidden = !on;
      },
      resize(width, height, ratio) {
        // Fixed internal resolution: at most 1600x900 however large the window or dense the
        // display; the browser scales the result to the stage.
        const [w, h] = canvasPixels(width, height, Math.min(ratio, 1), 1600 * 900);
        canvas.width = w;
        canvas.height = h;
      },
      render(time) {
        const state = show.at(time);
        for (let index = 0; index < rigBeamCount; index++) {
          const beam = state.beams[index];
          apex.set([beam.x, beam.y, beam.z, Math.cos(beam.angle)], index * 4);
          axis.set([beam.dx, beam.dy, beam.dz, beam.intensity], index * 4);
          color.set([beam.r, beam.g, beam.b, beam.length], index * 4);
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.bindVertexArray(vertexArray);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, noiseTexture);
        gl.uniform1i(uniforms.uNoise, 0);
        gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
        gl.uniform3f(uniforms.uCameraPosition, state.camera[0], state.camera[1], state.camera[2]);
        gl.uniform3f(uniforms.uCameraTarget, state.target[0], state.target[1], state.target[2]);
        gl.uniform1f(uniforms.uFov, state.fov);
        gl.uniform4fv(uniforms.uBeamApex, apex);
        gl.uniform4fv(uniforms.uBeamAxis, axis);
        gl.uniform4fv(uniforms.uBeamColor, color);
        gl.uniform4f(uniforms.uHaze, state.haze, state.hazeTexture, time, state.gloss);
        gl.uniform4f(uniforms.uFlash, state.flash[0], state.flash[1], state.flash[2], state.flash[3]);
        gl.uniform4f(uniforms.uStrobe, state.snareFlash, state.hatSparkle, state.strobeSeed, state.truss);
        gl.uniform4f(uniforms.uWash, state.wash[0], state.wash[1], state.wash[2], state.wash[3]);
        gl.uniform1f(uniforms.uLens, state.lens);
        gl.uniform1f(uniforms.uSeed, (time * 100) % 97);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  },
});

// ---- the show: song time -> fixture states -------------------------------------------

function createRigShow() {
  const white = [1.0, 0.96, 0.9];
  const warm = [1.0, 0.86, 0.7];
  const beams = Array.from({ length: rigBeamCount }, () => ({
    x: 0, y: 0, z: 0, dx: 0, dy: -1, dz: 0, angle: 0.08, intensity: 0, r: 1, g: 1, b: 1, length: 40,
  }));
  const state = {
    beams,
    camera: [0, 2, 12],
    target: [0, 4, -6],
    fov: 0.9,
    haze: 1,
    hazeTexture: 0.7,
    gloss: 0.5,
    flash: [1, 1, 1, 0],
    snareFlash: 0,
    hatSparkle: 0,
    strobeSeed: 0,
    truss: 0,
    wash: [1, 1, 1, 0],
    lens: 1,
  };
  const spacing = 2.5;
  const headX = (index) => (index - 3.5) * spacing;
  const headY = 7.6,
    headZ = -7.0;
  let song = null;
  let gel = white;
  let mainDrop = -1;
  const DEG = Math.PI / 180;

  // Camera shots: [position, target, vertical fov]. All stand in front of the floor jets.
  const shots = {
    hero: [[0, 0.8, 5.5], [0, 7.2, -7], 1.15],
    wide: [[0, 2.0, 11], [0, 4.6, -7], 1.0],
    left: [[-6.5, 1.7, 7.5], [1.5, 5.0, -7], 1.05],
    right: [[6.5, 1.7, 7.5], [-1.5, 5.0, -7], 1.05],
    floor: [[0, 0.45, 8.5], [0, 2.8, -7], 0.98],
    close: [[0, 2.6, 4.2], [0, 7.6, -7], 1.25],
    high: [[0, 7.2, 8.5], [0, 2.0, -5], 1.0],
  };
  // Looks for the heads: fan spread (radians, negative crosses), elevation bias, and
  // whether the beams lean toward the audience (+1) or away (-1).
  const looks = {
    fan: { spread: 1.7, lift: 0, toward: 1 },
    vee: { spread: 1.05, lift: 0.12, toward: -1 },
    cross: { spread: -1.3, lift: 0, toward: 1 },
    curtain: { spread: 0.12, lift: 0.25, toward: -1 },
    blade: { spread: 2.3, lift: -0.25, toward: 1 },
    cathedral: { spread: 0.7, lift: 0.45, toward: 1 },
  };
  const driveLooks = ["fan", "cross", "vee", "curtain", "fan", "blade"];

  function setSong(model) {
    song = model;
    gel = white;
    mainDrop = -1;
    if (!model) return;
    gel = hexColor(rigGels[model.identifier] || "#ffffff");
    mainDrop = model.mainDrop;
  }

  function blank() {
    for (const beam of beams) beam.intensity = 0;
    state.flash[3] = 0;
    state.snareFlash = 0;
    state.hatSparkle = 0;
    state.truss = 0;
    state.wash[3] = 0;
  }

  function useShot(name, drift = 0) {
    const shot = shots[name];
    state.camera = [shot[0][0] + drift * 0.9, shot[0][1] + drift * 0.2, shot[0][2] - drift * 1.2];
    state.target = [shot[1][0], shot[1][1], shot[1][2]];
    state.fov = shot[2];
  }

  // Aim head i by look, elevation (radians above horizontal) and a pan offset.
  function aimHead(beam, index, look, elevation, pan = 0) {
    const spread = look.spread;
    const azimuth = spread * ((index - 3.5) / 3.5) * 0.5 + pan;
    const e = clampRange(elevation + look.lift, 0.12, 1.5);
    beam.dx = Math.sin(azimuth) * Math.cos(e);
    beam.dy = Math.sin(e);
    beam.dz = Math.cos(azimuth) * Math.cos(e) * look.toward;
  }

  function mixAim(beam, dx, dy, dz, amount) {
    beam.dx = mixValue(beam.dx, dx, amount);
    beam.dy = mixValue(beam.dy, dy, amount);
    beam.dz = mixValue(beam.dz, dz, amount);
    const length = Math.hypot(beam.dx, beam.dy, beam.dz) || 1;
    beam.dx /= length;
    beam.dy /= length;
    beam.dz /= length;
  }

  function placeHeads() {
    for (let index = 0; index < rigHeadCount; index++) {
      const beam = beams[index];
      beam.x = headX(index); beam.y = headY; beam.z = headZ;
      beam.length = 55;
      beam.r = white[0]; beam.g = white[1]; beam.b = white[2];
    }
  }

  // Standby: before the analysis arrives, a still cathedral of light.
  function standby() {
    blank();
    placeHeads();
    for (let index = 0; index < rigHeadCount; index++) {
      aimHead(beams[index], index, looks.cathedral, 0.9);
      beams[index].angle = 0.08;
      beams[index].intensity = 14;
    }
    useShot("hero");
    state.haze = 1.2; state.hazeTexture = 0.7; state.gloss = 0.5; state.lens = 1; state.truss = 1;
    return state;
  }

  function at(time) {
    if (!song) return standby();
    blank();
    placeHeads();
    const scene = song.scene(time);
    const sceneProgress = clamp01((time - scene.start) / Math.max(0.1, scene.end - scene.start));
    const drop = song.dropContext(time);
    const beat = song.beatPosition(time);
    const bar = song.barPosition(time);
    const barIndex = Math.floor(bar);
    const phrase = Math.floor(barIndex / 4);
    const afterMain = mainDrop >= 0 && time >= song.drops[mainDrop].time;
    const peak = song.peakAt(time);
    const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
    const inGap = drop.phase === 2 || leadIn >= 0;
    const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
    const hitLength = song.beatPeriod * 2;
    const inHit = sinceDrop < hitLength;
    const vocal = song.value("vocal", time);
    const singing = clamp01((vocal - 0.22) / 0.45);
    // The rig grows: six heads until the first drop, all eight after it.
    let dropsPassed = 0;
    for (const entry of song.drops) if (entry.time <= time) dropsPassed++;
    const rigSize = dropsPassed === 0 && song.drops.length ? 6 : 8;

    // ---- the bass: the fan's elevation follows the note (low note, low beams), and each
    // new note tips it like a see-saw, so repeated notes move it too.
    const notes = song.bassNotes;
    const noteIndex = notes.last(time);
    let elevation = 0.75,
      seesaw = 0,
      bassPush = 0;
    if (noteIndex >= 0) {
      const heightOf = (index) => 0.35 + 0.95 * fract((notes.pitch[index] - 24) / 24);
      const age = time - notes.start[noteIndex];
      const settle = easeOutCubic(age / 0.08);
      const previous = noteIndex > 0 ? heightOf(noteIndex - 1) : heightOf(noteIndex);
      elevation = mixValue(previous, heightOf(noteIndex), settle);
      const side = noteIndex % 2 === 0 ? 1 : -1;
      seesaw = mixValue(-side, side, settle) * 0.2;
      const sounding = time < notes.end[noteIndex] + 0.05;
      bassPush = sounding ? notes.strength[noteIndex] * hitDecay(age, 0.3) : 0;
    }
    const bassLevel = song.value("bass", time);

    // ---- look and shot per scene
    let lookName = "fan",
      intensity = 16,
      width = 0.075,
      shot = "wide",
      lit = rigSize;
    const eightBars = Math.floor(barIndex / 8);
    switch (scene.kind) {
      case "intro":
        lookName = "fan"; intensity = 18; width = 0.085; shot = "hero"; break;
      case "verse":
        lookName = ["curtain", "vee"][scene.kindIndex % 2]; intensity = 12; width = 0.08; shot = ["wide", "left", "right"][(scene.kindIndex + eightBars) % 3]; break;
      case "break":
        lookName = "cathedral"; intensity = 8 + 14 * singing; width = 0.075; shot = ["wide", "left", "right"][eightBars % 3]; break;
      case "groove":
        lookName = driveLooks[(phrase + scene.index) % 4]; intensity = 16; shot = ["left", "right", "hero"][(scene.index + eightBars) % 3]; break;
      case "build":
        lookName = "fan"; intensity = 14; shot = "wide"; break;
      case "drop":
        lookName = driveLooks[Math.floor(beat) % 2 === 0 ? 0 : 2]; intensity = 20; width = 0.055; shot = "floor"; break;
      case "drive":
        lookName = driveLooks[(phrase + scene.kindIndex) % driveLooks.length]; intensity = 18; width = 0.06;
        shot = ["wide", "left", "right", "floor", "hero"][(scene.kindIndex + eightBars) % 5]; break;
      case "outro":
        lookName = "cathedral"; intensity = 14 * (1 - sceneProgress * 0.8); shot = "wide"; lit = Math.max(2, Math.round(rigSize * (1 - sceneProgress))); break;
      case "gap":
        lookName = "fan"; intensity = 0; shot = "hero"; break;
    }
    // Chord passages: a new look on each chord stab, at most one per beat; the camera holds.
    let stabHit = 0;
    if (peak && peak.kind === "chords") {
      let count = 0,
        lastBeat = -1;
      for (let index = 0; index < song.stabs.length && song.stabs.time[index] <= time; index++) {
        const stabTime = song.stabs.time[index];
        if (stabTime < peak.start || song.stabs.strength[index] < 0.45) continue;
        const stabBeat = Math.floor(song.beatPosition(stabTime));
        if (stabBeat !== lastBeat) {
          count++;
          lastBeat = stabBeat;
        }
      }
      lookName = driveLooks[count % driveLooks.length];
      const stab = song.stabs.last(time);
      stabHit = stab >= 0 ? hitDecay(time - song.stabs.time[stab], 0.2) * song.stabs.strength[stab] : 0;
      intensity = 20;
      width = 0.06;
    }
    const look = looks[lookName];

    // ---- build: the beams gather onto one point above the stage and the camera pushes in;
    // a shimmer subdivides as the build rises.
    let converge = 0,
      shimmer = 0,
      shimmerRate = 1;
    if (drop.phase === 1) {
      converge = easeInCubic(drop.progress) * 0.95;
      shimmerRate = drop.progress < 0.5 ? 1 : drop.progress < 0.75 ? 2 : drop.progress < 0.9 ? 4 : 8;
      shimmer = 0.3 + 0.7 * drop.progress;
      intensity = mixValue(12, 22, drop.progress);
      width = mixValue(0.075, 0.035, drop.progress);
    }

    // ---- the key word: every head sweeps onto the singer, holds, and sweeps back.
    const anchorIndex = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
    let onSinger = 0;
    if (anchorIndex >= 0) {
      const moment = song.anchor.moments[anchorIndex];
      onSinger = Math.min(easeOutCubic((time - moment.start) / 0.15), 1 - easeInCubic(clamp01((time - (moment.end - 0.1)) / 0.15)));
    }
    const pitch = song.value("pitch", time);
    const singerX = pitch > 0 ? clampRange(((pitch - 64) / 12) * 4, -5, 5) : 0;

    const tintColor = afterMain ? gel : white;
    const phraseHit = scene.kind === "drive" && barIndex % 8 === 0 ? hitDecay(bar - barIndex, 0.2) : 0;
    const voiceSway = scene.kind === "break" ? Math.sin(time * 0.35) * 0.25 + (pitch > 0 ? (pitch - 64) / 60 : 0) : 0;
    for (let index = 0; index < rigHeadCount; index++) {
      const beam = beams[index];
      const rank = rigHeadOrder.indexOf(index);
      const side = index < 4 ? -1 : 1;
      let e = elevation + seesaw * side + (shimmer > 0 ? Math.sin((beat * shimmerRate + index * 0.5) * Math.PI) * shimmer * 0.2 : 0);
      aimHead(beam, index, look, e, voiceSway);
      if (converge > 0) {
        const fx = 0 - beam.x, fy = 4.8 - beam.y, fz = -0.5 - beam.z;
        const length = Math.hypot(fx, fy, fz);
        mixAim(beam, fx / length, fy / length, fz / length, converge);
      }
      if (onSinger > 0) {
        const fx = singerX - beam.x, fy = 0 - beam.y, fz = -1.5 - beam.z;
        const length = Math.hypot(fx, fy, fz);
        mixAim(beam, fx / length, fy / length, fz / length, onSinger * 0.92);
      }
      if (phraseHit > 0.02) {
        aimHead(beams[rigBeamCount - 1], index, looks.blade, 0.2);
        mixAim(beam, beams[rigBeamCount - 1].dx, beams[rigBeamCount - 1].dy, beams[rigBeamCount - 1].dz, phraseHit);
      }
      beam.angle = width * (1 + 0.35 * bassPush);
      let level = rank < lit ? intensity * (0.7 + 0.5 * bassLevel) * (1 + 0.45 * bassPush + 0.8 * stabHit) : 0;
      if (onSinger > 0) level = Math.max(level, 18 * onSinger);
      if (inGap) level = 0;
      beam.intensity = level;
      const tint = index % 2 === 0 ? tintColor : white;
      beam.r = tint[0]; beam.g = tint[1]; beam.b = tint[2];
    }

    // ---- kick: the floor jets, a row of upward shafts at the stage lip.
    const kickIndex = song.kicks.last(time);
    const kickAge = kickIndex >= 0 ? time - song.kicks.time[kickIndex] : Infinity;
    const kickPower = kickIndex >= 0 ? song.kicks.strength[kickIndex] * hitDecay(kickAge, 0.12) : 0;
    for (let jet = 0; jet < rigJetCount; jet++) {
      const beam = beams[rigHeadCount + jet];
      beam.x = (jet - 3.5) * 2.5; beam.y = 0.05; beam.z = 1.0;
      beam.dx = (jet - 3.5) * 0.04; beam.dy = 1; beam.dz = 0.14;
      const norm = Math.hypot(beam.dx, beam.dy, beam.dz);
      beam.dx /= norm; beam.dy /= norm; beam.dz /= norm;
      beam.angle = 0.13;
      beam.length = 3.2 + 3.2 * kickPower;
      beam.intensity = inGap ? 0 : kickPower * 16;
      beam.r = white[0]; beam.g = white[1]; beam.b = white[2];
    }

    // ---- voice: the follow-spot from high above, onto the singer's mark.
    const spot = beams[rigBeamCount - 1];
    spot.x = singerX * 0.3; spot.y = 16; spot.z = 1.5;
    {
      const fx = singerX - spot.x, fy = 0 - spot.y, fz = -1.5 - spot.z;
      const length = Math.hypot(fx, fy, fz);
      spot.dx = fx / length; spot.dy = fy / length; spot.dz = fz / length;
    }
    spot.angle = scene.kind === "break" || scene.kind === "verse" ? 0.1 : 0.08;
    spot.length = 40;
    // In the gap the voice keeps its light if it is singing: one warm column in the dark
    // (Desire's "Is it desire?" is sung into its hole).
    spot.intensity = inGap
      ? singing * 46
      : singing * (scene.kind === "break" || scene.kind === "verse" ? 42 : 24) * (onSinger > 0 ? 1.4 : 1);
    spot.r = warm[0]; spot.g = warm[1]; spot.b = warm[2];

    // ---- snare → truss cells flash; hats → sparkle.
    state.snareFlash = inGap ? 0 : song.snares.impulse(time, 0.06, 0.45) * 1.4;
    state.hatSparkle = inGap ? 0 : clamp01(song.hats.impulse(time, 0.04, 0.2)) * 0.45;
    state.strobeSeed = song.hats.last(time);
    state.truss = inGap ? 0 : 1;

    // ---- harmony: a faint wash on the back wall, white before the main drop, the gel after.
    const other = song.value("other", time);
    state.wash[0] = tintColor[0]; state.wash[1] = tintColor[1]; state.wash[2] = tintColor[2];
    state.wash[3] = inGap ? 0 : other * (0.35 + 1.5 * stabHit);

    // ---- the gap: blackout with blinders counting in, one pair per beat, aimed at the eye.
    state.lens = 1;
    if (inGap) {
      const gapStart = drop.phase === 2 ? drop.drop.gapStart : song.anchor.moments[leadIn].start;
      const gapEnd = drop.phase === 2 ? drop.drop.time : song.anchor.moments[leadIn].end;
      const beatsTotal = Math.max(1, Math.round((gapEnd - gapStart) / song.beatPeriod));
      const beatsIn = Math.min(beatsTotal - 1, Math.floor((time - gapStart) / song.beatPeriod));
      const pairs = Math.max(1, Math.round(((beatsIn + 1) / beatsTotal) * 4));
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        const fx = state.camera ? 0 : 0;
        aimHead(beam, index, looks.blade, 0.12);
        beam.angle = 0.02;
        beam.intensity = rigHeadOrder.indexOf(index) < pairs * 2 ? 0.05 : 0;
      }
      state.lens = 80;
    }

    // ---- the drop: the exact frame fires everything at the audience with a flash, holds
    // two beats (the hit), then the chase takes over.
    if (inHit) {
      const release = easeInCubic(clamp01((sinceDrop - song.beatPeriod) / song.beatPeriod));
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        const dx = beam.dx, dy = beam.dy, dz = beam.dz;
        aimHead(beam, index, looks.blade, 0.2);
        mixAim(beam, dx, dy, dz, release);
        beam.angle = 0.06;
        beam.intensity = 24;
      }
      state.flash[0] = 1; state.flash[1] = 0.98; state.flash[2] = 0.95;
      state.flash[3] = 1.4 * hitDecay(sinceDrop, 0.035);
      state.lens = 3;
      shot = "floor";
    }

    // ---- camera: the scene's shot with a slow move inside it; a push through a build.
    useShot(shot, sceneProgress - 0.5);
    if (drop.phase === 1) {
      const push = easeInCubic(drop.progress);
      const close = shots.close;
      state.camera = [mixValue(state.camera[0], close[0][0], push), mixValue(state.camera[1], close[0][1], push), mixValue(state.camera[2], close[0][2], push)];
      state.target = [mixValue(state.target[0], close[1][0], push), mixValue(state.target[1], close[1][1], push), mixValue(state.target[2], close[1][2], push)];
      state.fov = mixValue(state.fov, close[2], push);
    }
    if (inGap) useShot("hero");

    state.haze = scene.kind === "break" ? 1.05 : 1.25;
    state.hazeTexture = 0.75;
    state.gloss = 0.55;
    return state;
  }

  return { setSong, at };
}
