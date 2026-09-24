// Rig: a timecoded lighting show in a black room. Moving heads on a back truss follow the
// bass line, a row of floor jets fires on every kick, a follow-spot from above tracks the
// voice, strobe cells on the truss take the backbeat. Builds converge the beams and push
// the camera in, the gap before a drop is a blackout that counts in, and the drop fires
// every fixture on its exact frame. The beams are single scattering in haze, integrated in
// closed form per pixel (no bloom, no post-process).

const rigHeadCount = 16;
const rigJetCount = 8;
const rigBeamCount = rigHeadCount + rigJetCount + 1;
// Fixture order: symmetric pairs spreading outward, so a partly lit rig stays balanced.
const rigHeadOrder = [7, 8, 3, 12, 5, 10, 1, 14, 6, 9, 2, 13, 4, 11, 0, 15];
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
vec3 lensGlow(vec3 origin, vec3 direction, int index) {
  vec4 axisData = uBeamAxis[index];
  vec3 toLens = uBeamApex[index].xyz - origin;
  float distanceToLens = length(toLens);
  float facing = max(0.0, dot(-normalize(toLens), axisData.xyz));
  float radius = 0.16;
  float angle = acos(clamp(dot(direction, toLens / distanceToLens), -1.0, 1.0));
  float size = radius / distanceToLens;
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
      if (abs(p.y - trussY) < 0.16 && abs(p.x) < 10.0) {
        float cell = floor(p.x / 0.5);
        float inCell = step(abs(fract(p.x / 0.5) - 0.5), 0.3);
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
  const warm = [1.0, 0.88, 0.74];
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
  const spacing = 1.5;
  const headX = (index) => (index - 7.5) * spacing;
  const headY = 7.6,
    headZ = -7.0;
  let song = null;
  let gel = white;
  let mainDrop = -1;
  const look = [0, 0, 0];
  const look2 = [0, 0, 0];

  // Camera shots: [position, target, vertical fov in radians]
  const shots = {
    hero: [[0, 0.7, 4.6], [0, 7.2, -7], 1.18], // low and close, looking up into the rig
    wide: [[0, 2.0, 10.5], [0, 4.6, -7], 1.0],
    left: [[-6.8, 1.6, 6.5], [1.5, 5.0, -7], 1.05],
    right: [[6.8, 1.6, 6.5], [-1.5, 5.0, -7], 1.05],
    high: [[0, 7.5, 7.5], [0, 1.2, -5], 1.0],
    truss: [[0, 2.6, 0.2], [0, 8.2, -7], 1.32],
    floor: [[0, 0.35, 8.5], [0, 2.4, -7], 0.95], // eye on the stage floor, jets huge
  };

  function setSong(model) {
    song = model;
    gel = white;
    mainDrop = -1;
    if (!model) return;
    gel = hexColor(rigGels[model.identifier] || "#ffffff");
    mainDrop = model.mainDrop;
  }

  function aim(beam, x, y, z) {
    const dx = x - beam.x, dy = y - beam.y, dz = z - beam.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    beam.dx = dx / length;
    beam.dy = dy / length;
    beam.dz = dz / length;
  }

  // Target point for head i under a named look.
  function lookTarget(name, index, into) {
    const x = headX(index);
    const side = x < 0 ? -1 : 1;
    const outer = Math.abs(x) / (7.5 * spacing);
    switch (name) {
      case "fanUp": into[0] = x * 2.4; into[1] = 34; into[2] = -12; break;
      case "cathedral": into[0] = x * 0.45; into[1] = 30; into[2] = -9; break;
      case "fanOut": into[0] = x * 2.0; into[1] = 2.0; into[2] = 16; break;
      case "cross": into[0] = -x * 1.5; into[1] = 0; into[2] = 2.5; break;
      case "curtain": into[0] = x * 1.0; into[1] = 0; into[2] = -5.5; break;
      case "pools": into[0] = x * 0.5; into[1] = 0; into[2] = -1.0; break;
      case "vee": into[0] = side * (6 + 16 * outer); into[1] = 26; into[2] = -5; break;
      case "tunnel": into[0] = x * 0.25; into[1] = 1.6; into[2] = 20; break;
      case "wave": into[0] = x * 1.2; into[1] = 18 + 12 * Math.sin(index * 0.8); into[2] = 4; break;
      default: into[0] = 0; into[1] = 4; into[2] = -2;
    }
    return into;
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
    state.camera = [shot[0][0] + drift * 0.9, shot[0][1] + drift * 0.2, shot[0][2] - drift * 1.4];
    state.target = [shot[1][0], shot[1][1], shot[1][2]];
    state.fov = shot[2];
  }

  // Standby: before the analysis arrives, a still, symmetric cathedral of light.
  function standby() {
    blank();
    for (let index = 0; index < rigHeadCount; index++) {
      const beam = beams[index];
      beam.x = headX(index); beam.y = headY; beam.z = headZ;
      lookTarget("cathedral", index, look);
      aim(beam, look[0], look[1], look[2]);
      beam.angle = 0.06;
      beam.intensity = rigHeadOrder.indexOf(index) < 8 ? 12 : 0;
      beam.r = white[0]; beam.g = white[1]; beam.b = white[2];
      beam.length = 45;
    }
    useShot("hero");
    state.haze = 1; state.hazeTexture = 0.7; state.gloss = 0.5; state.lens = 1; state.truss = 1;
    return state;
  }

  function at(time) {
    if (!song) return standby();
    blank();
    const scene = song.scene(time);
    const sceneProgress = clamp01((time - scene.start) / Math.max(0.1, scene.end - scene.start));
    const drop = song.dropContext(time);
    const beat = song.beatPosition(time);
    const bar = song.barPosition(time);
    const barIndex = Math.floor(bar);
    let dropsPassed = 0;
    for (const entry of song.drops) if (entry.time <= time) dropsPassed++;
    const afterMain = mainDrop >= 0 && time >= song.drops[mainDrop].time;
    const songProgress = time / song.duration;
    const peak = song.peakAt(time);

    // How much of the rig exists: it grows through the song.
    let lit = scene.kind === "intro" ? 8 : 10;
    if (dropsPassed >= 1) lit = 14;
    if (dropsPassed >= 2 || songProgress > 0.62) lit = 16;
    if (!song.drops.length) lit = Math.min(16, 10 + 2 * Math.floor(scene.index / 2));

    // Look for the heads, per scene kind; drive scenes move on every four bars.
    const drivers = ["fanOut", "vee", "cross", "wave", "fanUp", "tunnel"];
    let lookName = "fanUp",
      lookIntensity = 10,
      beamAngle = 0.05,
      shot = "wide";
    const phrase = Math.floor(barIndex / 4);
    switch (scene.kind) {
      case "intro": lookName = "cathedral"; lookIntensity = 12; beamAngle = 0.06; shot = "hero"; break;
      case "verse": lookName = ["curtain", "vee"][scene.kindIndex % 2]; lookIntensity = 7; beamAngle = 0.06; shot = ["wide", "left", "right"][scene.kindIndex % 3]; break;
      case "break": lookName = "cathedral"; lookIntensity = 4; beamAngle = 0.04; shot = "high"; lit = 4; break;
      case "groove": lookName = drivers[(phrase + scene.index) % 4 + 1]; lookIntensity = 10; shot = ["left", "right", "hero"][scene.index % 3]; break;
      case "build": lookName = "fanUp"; lookIntensity = 9; shot = "truss"; break;
      case "drop": lookName = "fanOut"; lookIntensity = 14; beamAngle = 0.035; shot = "floor"; break;
      case "drive": lookName = drivers[(phrase + scene.kindIndex) % drivers.length]; lookIntensity = 12; beamAngle = 0.04; shot = ["wide", "left", "right", "floor"][(scene.kindIndex + Math.floor(phrase / 2)) % 4]; break;
      case "outro": lookName = "fanUp"; lookIntensity = 9 * (1 - sceneProgress * 0.85); shot = "wide"; lit = Math.max(2, Math.round(lit * (1 - sceneProgress))); break;
      case "gap": lookName = "fanUp"; lookIntensity = 0; shot = "truss"; break;
    }

    // Chord passages: every stab of the other stem throws the heads into the next look.
    let stabHit = 0;
    if (peak && peak.kind === "chords") {
      const stab = song.stabs.last(time);
      let count = 0;
      for (let index = stab; index >= 0 && song.stabs.time[index] >= peak.start; index--) if (song.stabs.strength[index] > 0.45) count++;
      lookName = drivers[count % drivers.length];
      stabHit = stab >= 0 ? hitDecay(time - song.stabs.time[stab], 0.18) * song.stabs.strength[stab] : 0;
      lookIntensity = 14;
      beamAngle = 0.04;
      shot = ["floor", "left", "right", "hero"][count % 4];
    }

    // Bass line → the whole fan swings (mirrored) with a snap onto each new note.
    const noteIndex = song.bassNotes.last(time);
    let pan = 0,
      bassPush = 0;
    if (noteIndex >= 0) {
      const pitchOf = (index) => (((song.bassNotes.pitch[index] - 24) % 24) + 24) % 24 / 24 - 0.5;
      const current = pitchOf(noteIndex);
      const previous = noteIndex > 0 ? pitchOf(noteIndex - 1) : current;
      const age = time - song.bassNotes.start[noteIndex];
      pan = mixValue(previous, current, easeOutCubic(age / 0.08));
      const sounding = time < song.bassNotes.end[noteIndex] + 0.05;
      bassPush = sounding ? song.bassNotes.strength[noteIndex] * hitDecay(age, 0.3) : 0;
    }
    const bassLevel = song.value("bass", time);

    // Build → converge on a focus point; a shimmer that subdivides as the build rises.
    let converge = 0,
      shimmer = 0,
      shimmerRate = 1;
    if (drop.phase === 1) {
      converge = easeInCubic(drop.progress) * 0.94;
      shimmerRate = drop.progress < 0.5 ? 1 : drop.progress < 0.75 ? 2 : drop.progress < 0.9 ? 4 : 8;
      shimmer = 0.4 + 0.6 * drop.progress;
      lookIntensity = mixValue(8, 16, drop.progress);
      beamAngle = mixValue(0.05, 0.028, drop.progress);
    }
    const inGap = drop.phase === 2;
    const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
    const hitLength = song.beatPeriod * 2;

    // Anchor: the key word pulls every head onto the singer; the lead-in is the blackout.
    const anchorIndex = song.anchor.kind === "word" ? song.anchorAt(time) : -1;
    const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
    const blackout = inGap || leadIn >= 0;

    // Voice → follow spot, x from the sung pitch.
    const pitch = song.value("pitch", time);
    const vocal = song.value("vocal", time);
    const singerX = pitch > 0 ? clampRange(((pitch - 64) / 12) * 4.5, -5.5, 5.5) : 0;

    const tintColor = afterMain ? gel : white;
    const phraseHit = scene.kind === "drive" && barIndex % 8 === 0 ? hitDecay(bar - barIndex, 0.22) : 0;
    for (let index = 0; index < rigHeadCount; index++) {
      const beam = beams[index];
      beam.x = headX(index); beam.y = headY; beam.z = headZ;
      const rank = rigHeadOrder.indexOf(index);
      const on = rank < lit;
      lookTarget(lookName, index, look);
      const side = beam.x < 0 ? -1 : 1;
      look[0] += side * pan * 16;
      if (shimmer > 0) look[1] += Math.sin((beat * shimmerRate + index * 0.5) * Math.PI) * shimmer * 5;
      if (converge > 0) {
        look[0] = mixValue(look[0], 0, converge);
        look[1] = mixValue(look[1], 4.8, converge);
        look[2] = mixValue(look[2], -1.0, converge);
      }
      if (anchorIndex >= 0) {
        look[0] = mixValue(look[0], singerX, 0.9);
        look[1] = mixValue(look[1], 0, 0.9);
        look[2] = mixValue(look[2], -1.5, 0.9);
      }
      if (phraseHit > 0.02) {
        lookTarget("fanOut", index, look2);
        look[0] = mixValue(look[0], look2[0], phraseHit);
        look[1] = mixValue(look[1], look2[1], phraseHit);
        look[2] = mixValue(look[2], look2[2], phraseHit);
      }
      aim(beam, look[0], look[1], look[2]);
      beam.angle = beamAngle * (1 + 0.3 * bassPush);
      let intensity = on ? lookIntensity * (0.7 + 0.6 * bassLevel) * (1 + 0.5 * bassPush + 0.8 * stabHit) : 0;
      if (anchorIndex >= 0) intensity = rank < 16 ? 14 : 0;
      if (blackout) intensity = 0;
      beam.intensity = intensity;
      const tint = index % 2 === 0 ? tintColor : white;
      beam.r = tint[0]; beam.g = tint[1]; beam.b = tint[2];
      beam.length = 50;
    }

    // Kick → floor jets: a row of short upward shafts at the stage lip.
    const kickIndex = song.kicks.last(time);
    const kickAge = kickIndex >= 0 ? time - song.kicks.time[kickIndex] : Infinity;
    const kickPower = kickIndex >= 0 ? song.kicks.strength[kickIndex] * hitDecay(kickAge, 0.12) : 0;
    for (let jet = 0; jet < rigJetCount; jet++) {
      const beam = beams[rigHeadCount + jet];
      beam.x = (jet - 3.5) * 2.4; beam.y = 0.05; beam.z = 1.0;
      beam.dx = (jet - 3.5) * 0.045; beam.dy = 1; beam.dz = 0.16;
      const norm = Math.hypot(beam.dx, beam.dy, beam.dz);
      beam.dx /= norm; beam.dy /= norm; beam.dz /= norm;
      beam.angle = 0.12;
      beam.length = 3.0 + 3.0 * kickPower;
      beam.intensity = blackout ? 0 : kickPower * 14;
      beam.r = white[0]; beam.g = white[1]; beam.b = white[2];
    }

    // Voice → follow spot from high above, onto the singer's mark.
    const spot = beams[rigBeamCount - 1];
    spot.x = singerX * 0.3; spot.y = 16; spot.z = 1.5;
    aim(spot, singerX, 0, -1.5);
    spot.angle = scene.kind === "break" || scene.kind === "verse" ? 0.1 : 0.075;
    spot.length = 40;
    const singing = clamp01((vocal - 0.22) / 0.45);
    spot.intensity = blackout ? 0 : singing * (scene.kind === "break" || scene.kind === "verse" ? 40 : 22) * (anchorIndex >= 0 ? 1.6 : 1);
    spot.r = warm[0]; spot.g = warm[1]; spot.b = warm[2];

    // Snare → truss cells flash; hats → sparkle.
    state.snareFlash = blackout ? 0 : song.snares.impulse(time, 0.06, 0.45) * 1.3;
    state.hatSparkle = blackout ? 0 : clamp01(song.hats.impulse(time, 0.04, 0.2)) * 0.4;
    state.strobeSeed = song.hats.last(time);
    state.truss = blackout ? 0 : 1;

    // Harmony → a faint wash on the back wall: white before the main drop, the gel after.
    const other = song.value("other", time);
    state.wash[0] = tintColor[0]; state.wash[1] = tintColor[1]; state.wash[2] = tintColor[2];
    state.wash[3] = blackout ? 0 : other * (0.25 + 1.5 * stabHit);

    // Gap: blackout that counts in; each beat of the gap lights one more pair of lenses.
    state.lens = 1;
    if (blackout) {
      const gapStart = inGap ? drop.drop.gapStart : song.anchor.moments[leadIn].start;
      const gapEnd = inGap ? drop.drop.time : song.anchor.moments[leadIn].end;
      const beatsTotal = Math.max(1, Math.round((gapEnd - gapStart) / song.beatPeriod));
      const beatsIn = Math.min(beatsTotal - 1, Math.floor((time - gapStart) / song.beatPeriod));
      const pairs = Math.max(1, Math.round(((beatsIn + 1) / beatsTotal) * 8));
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        lookTarget("tunnel", index, look2);
        aim(beam, look2[0], look2[1], look2[2]);
        beam.angle = 0.03;
        beam.intensity = rigHeadOrder.indexOf(index) < pairs * 2 ? 0.02 : 0;
      }
      state.lens = 60;
    }

    // Drop: the exact frame fires everything straight at the audience with a flash, holds
    // for two beats (the hit), then lets the show move.
    if (sinceDrop < hitLength) {
      const release = easeInCubic(clamp01((sinceDrop - song.beatPeriod) / song.beatPeriod));
      for (let index = 0; index < rigHeadCount; index++) {
        lookTarget("fanOut", index, look2);
        lookTarget(lookName, index, look);
        aim(beams[index], mixValue(look2[0], look[0], release), mixValue(look2[1], look[1], release), mixValue(look2[2], look[2], release));
        beams[index].angle = 0.045;
        beams[index].intensity = 16;
      }
      state.flash[0] = 1; state.flash[1] = 0.98; state.flash[2] = 0.95;
      state.flash[3] = 1.4 * hitDecay(sinceDrop, 0.035);
      state.lens = 3;
      shot = "floor";
    }

    // Camera: a shot per scene with a slow move inside it, a push in through a build.
    useShot(shot, sceneProgress - 0.5);
    if (drop.phase === 1) {
      const push = easeInCubic(drop.progress);
      state.camera[2] -= push * 4.5;
      state.camera[1] += push * 0.5;
      state.fov += push * 0.15;
    }
    if (blackout) useShot("hero");
    if (sinceDrop < hitLength) useShot("floor");

    state.haze = scene.kind === "break" ? 0.8 : 1.0;
    state.hazeTexture = 0.75;
    state.gloss = 0.5;
    return state;
  }

  return { setSong, at };
}
