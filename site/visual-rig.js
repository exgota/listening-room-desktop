// Rig: a timecoded lighting show in a black room. Moving heads on a back truss pan with the
// bass line (every head together, low notes left, high right), a row of floor jets fires on
// every kick, a follow-spot from above follows the voice from mark to mark, strobe cells on
// the truss take the backbeat; in swung songs the heads chase sideways on the swung
// sixteenth. Each song has its own opening composition, its own drop (camera and looks) and
// a signature look that recurs through it. Builds converge the beams into a spike overhead
// and push the camera in; the gap before a drop is a blackout that counts in with blinders;
// the drop fires every fixture at the audience on its exact frame and holds the brightest
// state of the song for two beats, then a chase steps across the rig. The beams are single
// scattering in haze, integrated in closed form per pixel (no bloom, no post-process).

const rigHeadCount = 8;
const rigJetCount = 8;
const rigBeamCount = rigHeadCount + rigJetCount + 1;
// Fixture order: symmetric pairs spreading outward, so a partly lit rig stays balanced.
const rigHeadOrder = [3, 4, 1, 6, 2, 5, 0, 7];
// Each song opens on its own composition (its thumbnail), lands its drops in its own way
// and keeps a signature look that recurs through its drives.
// A drop's camera is never used by any other section of its song; breakdowns take their
// looks in the song's own order.
const rigSongs = {
  "5ff86d6cd02ebd7308e03df8": { shot: "hero", look: "cathedral", drop: { shot: "high", looks: ["rain", "cross"], mainLooks: ["fan", "scissor"] }, signature: "blade", breaks: ["cathedral", "rain", "fan", "rain"] }, // NBLY
  "1d589940ca458d793a3fad8a": { shot: "hero", look: "blade", drop: { shot: "floor", mainShot: "side", looks: ["cross", "fan"], looksByDrop: [["cross", "fan"], ["rain", "scissor"], null, ["scissor", "blade"]], funnel: true }, signature: "cross", breaks: ["rain"] }, // Desire
  f127a026dc751f1528bfb95d: { shot: "hero", look: "rain", drop: { shot: "overhead", looks: ["rain", "scissor"], mainLooks: ["scissor", "rain"] }, signature: "rain", breaks: ["fan", "cathedral"] }, // Ophelia
  "8eee874c702a10807f79706c": { shot: "wide", look: "scissor", drop: { shot: "far", looks: ["cross", "fan"] }, signature: "fan", breaks: ["cathedral", "rain"] }, // Outside
  "4048d4a6dce44c151690b2b1": { shot: "right", look: "cross", drop: { shot: "low", looks: ["cross", "fan"] }, signature: "fan", breaks: ["rain", "cathedral"] }, // American Boy
};
const rigDefaultSong = { shot: "hero", look: "fan", drop: { shot: "floor", looks: ["fan", "rain"] }, signature: "fan", breaks: ["cathedral", "rain"] };
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
uniform float uLensSize;
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
  float size = 0.34 * uLensSize / distanceToLens;
  float angle = sqrt(max(0.0, 2.0 - 2.0 * dot(direction, toLensUnit)));
  if (angle > size * 12.0) return vec3(0.0);
  float disc = 1.0 - smoothstep(size * 0.8, size, angle);
  // the halo reaches zero at the cutoff, so it never ends on a hard circle
  float halo = exp(-angle / (size * 2.5)) * 0.25 * (1.0 - smoothstep(size * 4.0, size * 12.0, angle));
  float power = axisData.w * (0.08 + 1.3 * pow(facing, 12.0));
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
      if (abs(p.y - trussY) < 0.45 && abs(p.x) < 11.0) {
        float cell = floor(p.x / 2.2);
        float inCell = step(abs(fract(p.x / 2.2) - 0.5), 0.38);
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
    // haze in front of a near floor is dimmed so the pools read; toward the back wall it is
    // kept whole, so a beam does not step down where it crosses the floor line
    float keep = mix(0.45, 1.0, 1.0 - smoothstep(-14.0, -3.0, p.z));
    color = color * keep + pool * streaks + mirror * uHaze.w * fresnel * streaks;
    color += vec3(0.012, 0.012, 0.014) * (1.0 - smoothstep(0.0, 30.0, floorT));
  }

  // the flash spares the title's corner, so the title and credits survive the drop frame
  float titleCorner = (1.0 - smoothstep(0.22, 0.5, vUv.x)) * smoothstep(0.55, 0.8, vUv.y);
  color += uFlash.rgb * uFlash.w * (1.0 - 0.6 * titleCorner);
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
  order: 4,
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
        gl.uniform1f(uniforms.uLensSize, state.lensSize);
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
    lensSize: 1,
  };
  const spacing = 2.5;
  const headX = (index) => (index - 3.5) * spacing;
  const headY = 7.6,
    headZ = -7.0;
  let song = null;
  let gel = white,
    gelBoost = 1;
  let config = rigDefaultSong;
  let bassLow = 28,
    bassHigh = 52,
    swingLate = 0,
    outroStart = Infinity,
    bookendStart = Infinity,
    songEnd = Infinity,
    turnHit = -1;
  let breathOK = [];
  let marks = new Float32Array(0); // the follow-spot's stage mark, 20 a second

  // Camera shots: [position, target, vertical fov]. None puts the truss or a lens in the
  // title's corner at any point of its drift (checked by projection at 1920x930).
  const shots = {
    hero: [[0, 0.8, 5.5], [0, 7.2, -7], 1.15],
    wide: [[0, 2.0, 11], [0, 5.6, -7], 1.0],
    right: [[6.5, 1.7, 7.5], [-1.5, 5.0, -7], 1.05],
    floor: [[0, 0.45, 8.5], [0, 5.6, -7], 0.98],
    close: [[0, 2.6, 4.2], [0, 8.6, -7], 1.25],
    high: [[0, 9.0, 8], [0, 6.0, -7], 1.05],
    side: [[13, 2.2, 4], [-2, 4.8, -6], 1.1],
    low: [[0, 0.3, 6], [0, 6.5, -7], 1.2],
    overhead: [[0, 17, 1], [0, 0, -12], 1.0],
    far: [[0, 1.2, 22], [0, 5.5, -7], 0.72],
  };
  // Looks for the heads: fan spread (radians, negative crosses), elevation bias, and
  // whether the beams lean toward the audience (+1) or away (-1).
  const looks = {
    fan: { spread: 1.7, lift: 0, toward: 1 },
    vee: { spread: 1.1, lift: 0.35, toward: -1 },
    cross: { spread: -1.3, lift: 0, toward: 1 },
    curtain: { spread: 0.4, lift: 0.5, toward: -1 },
    blade: { spread: 2.3, lift: -0.25, toward: 1 },
    cathedral: { spread: 0.7, lift: 0.45, toward: 1 },
    // down onto the stage: columns to the floor, pools and their reflections
    rain: { spread: 0.5, lift: -1.85, toward: 1 },
    // down and across: two sides crossing over the stage
    scissor: { spread: -1.1, lift: -1.6, toward: 1 },
  };
  // (the looks that lean away, vee and curtain, show the least beam from the front: kept out)
  const driveLooks = ["fan", "cross", "rain", "blade", "scissor", "rain", "cross"];

  function setSong(model) {
    song = model;
    gel = white;
    config = rigDefaultSong;
    breathOK = [];
    marks = new Float32Array(0);
    turnHit = -1;
    if (!model) return;
    gel = hexColor(rigGels[model.identifier] || "#ffffff");
    gelBoost = Math.min(1.6, 0.8 / Math.max(0.05, 0.2126 * gel[0] + 0.7152 * gel[1] + 0.0722 * gel[2]));
    config = rigSongs[model.identifier] || rigDefaultSong;
    // the bass line's own range, for the pan
    const pitches = Array.from(model.bassNotes.pitch).sort((a, b) => a - b);
    bassLow = 28;
    bassHigh = 52;
    if (pitches.length > 8) {
      bassLow = pitches[Math.floor(pitches.length * 0.05)];
      bassHigh = Math.max(bassLow + 5, pitches[Math.floor(pitches.length * 0.95)]);
    }
    // swing, measured where the bass lands late in the beat (as Pocket does)
    const late = [];
    for (let index = 0; index < model.bassNotes.length; index++) {
      const phase = fract(model.beatPosition(model.bassNotes.start[index]));
      if (phase > 0.6 && phase < 0.97) late.push(phase);
    }
    late.sort((a, b) => a - b);
    swingLate = late.length > 20 ? clampRange(late[late.length >> 1] - 0.75, 0, 0.15) : 0;
    // the outro is one fade, however many sections it has, and reaches black at the end
    outroStart = Infinity;
    for (let index = model.scenes.length - 1; index >= 0 && model.scenes[index].kind === "outro"; index--) outroStart = model.scenes[index].start;
    const mix = model.series.mix;
    songEnd = model.duration;
    if (mix) {
      let index = mix.length - 1;
      while (index > 0 && mix[index] < 0.08) index--;
      songEnd = Math.min(model.duration, index / 100 + 0.3);
    }
    // The opening composition comes back as a bookend for at least the last eight bars (after
    // the last drop section).
    let lastDropEnd = 0;
    for (const scene of model.scenes) if (scene.kind === "drop") lastDropEnd = scene.end;
    bookendStart = Math.max(lastDropEnd, Math.min(outroStart, songEnd - 8 * model.barPeriod));
    // A drop with no hole takes a breath (its last beat dark) only where the music really
    // dips there; where an instrument enters on that beat, the rig stays up.
    breathOK = model.drops.map((drop) => {
      if (drop.gapStart < drop.time - 0.05) return true;
      const beat = model.beatPeriod;
      const last = model.mean("mix", drop.time - beat, drop.time),
        before = model.mean("mix", drop.time - 2 * beat, drop.time - beat);
      const bassEnters = model.mean("bass", drop.time - beat, drop.time) > 0.3 && model.mean("bass", drop.time - 2 * beat, drop.time - beat) < 0.1;
      return last < before * 0.8 && !bassEnters;
    });
    // The song's turn, when it is not a drop, gets a hit of its own.
    if (!model.drops.some((drop) => Math.abs(drop.time - model.lateStart) < 0.3) && model.lateStart < model.duration) turnHit = model.lateStart;
    // The follow-spot's marks: five places across the stage from the median sung pitch of the
    // last half second; held through unvoiced moments (up to three seconds).
    const pitch = model.series.pitch,
      vocal = model.series.vocal;
    const count = Math.ceil(model.duration * 20) + 1;
    marks = new Float32Array(count);
    let held = 0,
      heldFor = 0;
    const window = [];
    for (let index = 0; index < count; index++) {
      const end = Math.min(pitch ? pitch.length : 0, index * 5);
      window.length = 0;
      for (let sample = Math.max(0, end - 50); sample < end; sample++) if (pitch[sample] > 0 && (!vocal || vocal[sample] > 0.2)) window.push(pitch[sample]);
      if (window.length >= 5) {
        window.sort((a, b) => a - b);
        const median = window[window.length >> 1];
        held = Math.round(clampRange(((median - 64) / 12) * 2, -2, 2)) * 2;
        heldFor = 0;
      } else if (++heldFor > 60) held = 0;
      marks[index] = held;
    }
    // A mark held for under a second between two stretches of one mark is dropped, so the
    // spot does not visit a neighbour and come straight back.
    for (let index = 1; index < count; ) {
      if (marks[index] === marks[index - 1]) {
        index++;
        continue;
      }
      let end = index;
      while (end < count && marks[end] === marks[index]) end++;
      if (end < count && end - index < 20 && marks[end] === marks[index - 1]) marks.fill(marks[index - 1], index, end);
      index = end;
    }
  }

  // How much the voice sings, held at its peak over the last `hold` seconds (so the spot does
  // not strobe with a chopped vocal).
  function singingAt(time, hold) {
    let level = 0;
    for (let step = 0; step * 0.05 <= hold; step++) level = Math.max(level, clamp01((song.value("vocal", time - step * 0.05) - 0.22) / 0.45));
    return level;
  }

  // The spot's place: the stage mark, glided over 0.15 s.
  function spotAt(time) {
    if (!marks.length) return 0;
    let sum = 0;
    for (let step = 0; step < 4; step++) sum += marks[clampRange(Math.floor((time - step * 0.05) * 20), 0, marks.length - 1)];
    return sum / 4;
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
    const shot = shots[name] || shots.wide;
    state.camera = [shot[0][0] + drift * 0.9, shot[0][1] + drift * 0.2, shot[0][2] - drift * 1.2];
    state.target = [shot[1][0], shot[1][1], shot[1][2]];
    state.fov = shot[2];
  }

  // Aim head i by look, elevation (radians above horizontal) and a pan offset.
  function aimHead(beam, index, look, elevation, pan = 0) {
    const spread = look.spread;
    const azimuth = spread * ((index - 3.5) / 3.5) * 0.5 + pan;
    const e = clampRange(elevation + look.lift, look.lift < -0.5 ? -1.45 : 0.12, 1.5);
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

  function aimAt(beam, x, y, z, amount) {
    const fx = x - beam.x,
      fy = y - beam.y,
      fz = z - beam.z;
    const length = Math.hypot(fx, fy, fz) || 1;
    mixAim(beam, fx / length, fy / length, fz / length, amount);
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
    state.haze = 1.2; state.hazeTexture = 0.7; state.gloss = 0.5; state.lens = 1; state.lensSize = 1; state.truss = 1;
    return state;
  }

  function at(time) {
    if (!song) return standby();
    blank();
    placeHeads();
    const drop = song.dropContext(time);
    // a build (or an approach) keeps the look and shot of the section it began in
    const scene = drop.phase === 1 ? song.scene(drop.build.start + 0.01) : song.scene(time);
    const sceneProgress = clamp01((time - scene.start) / Math.max(0.1, scene.end - scene.start));
    const beat = song.beatPosition(time);
    const bar = song.barPosition(time);
    const barIndex = Math.floor(bar);
    const phrase = Math.floor(barIndex / 4);
    const eightBars = Math.floor(barIndex / 8);
    // the gel is saved for the song's turn (its main drop, or its last third when that drop
    // comes early)
    const afterMain = time >= song.lateStart;
    const peak = song.peakAt(time);
    const leadIn = song.anchor.kind === "lead_in" ? song.anchorAt(time) : -1;
    const lastBeat = drop.phase === 1 && drop.drop.gapStart >= drop.drop.time - 0.05 && drop.drop.time - time <= song.beatPeriod;
    const breath = lastBeat && breathOK[drop.index];
    const inGap = drop.phase === 2 || leadIn >= 0 || breath;
    const sinceDrop = drop.phase === 3 ? drop.since : Infinity;
    const sinceTurn = turnHit >= 0 && time >= turnHit ? time - turnHit : Infinity;
    const hitLength = song.beatPeriod * 3;
    const dropHit = sinceDrop < hitLength;
    const inHit = dropHit || sinceTurn < song.beatPeriod;
    const hitAge = Math.min(sinceDrop, sinceTurn);
    const mainHit = dropHit && drop.index === song.mainDrop;
    const singing = singingAt(time, 0.2);
    // The rig grows: six heads until the first drop, all eight after it.
    let dropsPassed = 0;
    for (const entry of song.drops) if (entry.time <= time) dropsPassed++;
    const rigSize = dropsPassed === 0 && song.drops.length ? 6 : 8;
    // the last two bars fade to black
    const fadeOut = clamp01((songEnd - time) / (2 * song.barPeriod));
    const inBookend = time >= bookendStart && drop.phase !== 1 && drop.phase !== 2;
    // after the song's turn the rig runs hotter for sixteen bars
    const turnLift = time >= song.lateStart && time < song.lateStart + 16 * song.barPeriod ? 1.25 : 1;

    // ---- the bass: every head pans with the note across the song's bass range (low left,
    // high right), snapping onto each note with an overshoot; a repeated note nods them.
    const notes = song.bassNotes;
    const noteIndex = notes.last(time);
    let elevation = 0.75,
      bassPan = 0,
      nod = 0;
    if (noteIndex >= 0) {
      const panOf = (index) => (clamp01((notes.pitch[index] - bassLow) / (bassHigh - bassLow)) - 0.5) * 1.0;
      const age = time - notes.start[noteIndex];
      const settle = easeOutBack(clamp01(age / 0.12));
      const previous = noteIndex > 0 ? panOf(noteIndex - 1) : panOf(noteIndex);
      bassPan = mixValue(previous, panOf(noteIndex), settle);
      elevation = 0.62 + 0.35 * clamp01((notes.pitch[noteIndex] - bassLow) / (bassHigh - bassLow));
      nod = notes.strength[noteIndex] * hitDecay(age, 0.15) * 0.14;
    }
    // Swung songs: the heads chase sideways on the beat and on the swung sixteenth, from the
    // first bar (American Boy's lateral swing is its show).
    let swingChase = 0;
    if (swingLate > 0.06 && scene.kind !== "break" && scene.kind !== "build" && scene.kind !== "outro") {
      const phase = fract(beat);
      const lateAt = 0.75 + swingLate;
      const snap = (age) => easeOutBack(clamp01(age / 0.1));
      swingChase = (phase < lateAt ? mixValue(-1, 1, snap(phase)) : mixValue(1, -1, snap(phase - lateAt))) * 0.18;
    }
    // the opening composition breathes over two bars: the heads rise and swell, then sink
    const breathing = scene.kind === "intro" || scene.index === 0 ? Math.sin((bar / 2) * Math.PI * 2) : 0;
    const barBreath = breathing * 0.24;

    // ---- look and shot per scene
    let lookName = "fan",
      intensity = 16,
      width = 0.075,
      shot = "wide",
      lit = rigSize,
      chase = 0,
      lens = 1,
      sweep = 0;
    // the camera and looks of the drop this section follows: a main drop may have its own,
    // and a song with several drops may take its cameras in turn
    const mainSection = drop.phase === 3 && drop.index === song.mainDrop;
    const dropShot = mainSection && config.drop.mainShot ? config.drop.mainShot : config.drop.shots ? config.drop.shots[Math.max(0, drop.index) % config.drop.shots.length] : config.drop.shot;
    const byDrop = config.drop.looksByDrop && drop.phase === 3 ? config.drop.looksByDrop[drop.index % config.drop.looksByDrop.length] : null;
    const dropLooks = mainSection && config.drop.mainLooks ? config.drop.mainLooks : byDrop || config.drop.looks;
    switch (scene.kind) {
      case "intro":
        lookName = config.look; intensity = 18; width = 0.085; shot = config.shot; break;
      case "verse":
        lookName = [config.signature, "rain", "cross", "fan"][(scene.kindIndex + eightBars) % 4]; intensity = 14; width = 0.08; shot = ["wide", "right", "hero"][(scene.index + eightBars) % 3]; break;
      case "break": {
        lookName = config.breaks[scene.kindIndex % config.breaks.length]; intensity = 9 + 13 * singing; width = 0.075; shot = ["wide", "right", "hero"][(scene.index + eightBars) % 3];
        // a breakdown of eight bars or more wakes the rig pair by pair
        const sceneBars = (scene.end - scene.start) / song.barPeriod;
        if (sceneBars >= 5.9) lit = Math.min(rigSize, 2 + 2 * Math.floor(Math.max(0, barIndex - song.barIndex(scene.start + 0.01)) / Math.max(1, Math.floor(sceneBars / 6))));
        break;
      }
      case "groove":
        lookName = phrase % 3 === 1 ? config.signature : driveLooks[(phrase + scene.index) % driveLooks.length]; intensity = 16; shot = ["right", "hero", "wide"][(scene.index + eightBars) % 3]; lens = 0.8; break;
      case "build":
        lookName = ["fan", "cross", "rain"][Math.max(0, drop.index) % 3]; intensity = 14; shot = "wide"; break;
      case "drop":
        lookName = dropLooks[barIndex % 2]; intensity = 30; width = 0.06; shot = dropShot; chase = 1; lens = 1.0; break;
      case "drive":
        lookName = phrase % 3 === 1 ? config.signature : driveLooks[(phrase + scene.kindIndex) % driveLooks.length]; intensity = 18; width = 0.065;
        shot = ["wide", "right", "hero"][(scene.index + eightBars) % 3]; chase = 0.5; lens = 0.5; break;
      case "outro":
        lookName = config.look; intensity = 14; shot = config.shot; break;
      case "gap":
        lookName = "fan"; intensity = 0; shot = "hero"; break;
    }
    // A drop's section runs at least eight bars, whatever the scene list calls them.
    const inDropSection = drop.phase === 3 && scene.kind !== "outro" && (scene.kind === "drop" || drop.since < 8 * song.barPeriod);
    if (inDropSection && scene.kind !== "drop") {
      lookName = dropLooks[barIndex % 2];
      intensity = 30;
      width = 0.06;
      shot = dropShot;
      chase = 1;
      lens = 1.0;
      lit = rigSize;
    }
    // The song's first section always opens on its own composition (Outside opens on a groove).
    if (scene.index === 0) {
      lookName = config.look;
      shot = config.shot;
      width *= 1 + 0.3 * breathing;
    }
    // The bookend: the opening composition again, its heads dropping out as it fades, and a
    // slow sweep so the last bars still move.
    if (inBookend) {
      const fade = clamp01((time - bookendStart) / Math.max(1, songEnd - bookendStart));
      lookName = config.look;
      shot = config.shot;
      intensity = 16 * (1 - fade * 0.6);
      width = 0.075;
      chase = 0;
      lens = 1;
      lit = Math.max(2, Math.round(rigSize * (1 - fade * 0.75)));
      sweep = Math.sin((bar / 4) * Math.PI * 2) * 0.3 * (0.4 + fade);
    }
    intensity *= turnLift;
    // the first frames (the thumbnail) open with the heads a notch hotter
    if (time < 1.5) intensity *= 1 + 0.5 * (1 - smoothStep(0.3, 1.5, time));
    // the song's main drop runs hotter than its other drops
    if (inDropSection && mainSection && !inBookend) intensity *= 1.3;
    // Chord passages: a new look on each chord stab, at most one per beat; the camera holds.
    let stabHit = 0;
    if (peak && peak.kind === "chords") {
      let count = 0,
        lastStabBeat = -1;
      for (let index = 0; index < song.stabs.length && song.stabs.time[index] <= time; index++) {
        const stabTime = song.stabs.time[index];
        if (stabTime < peak.start || song.stabs.strength[index] < 0.45) continue;
        const stabBeat = Math.floor(song.beatPosition(stabTime));
        if (stabBeat !== lastStabBeat) {
          count++;
          lastStabBeat = stabBeat;
        }
      }
      lookName = driveLooks[count % driveLooks.length];
      const stab = song.stabs.last(time);
      stabHit = stab >= 0 ? hitDecay(time - song.stabs.time[stab], 0.2) * song.stabs.strength[stab] : 0;
      intensity = 20;
      width = 0.06;
    }
    const look = looks[lookName] || looks.fan;

    // ---- build: the beams gather, steadily, into one spike high over the stage (never into
    // the lens) and the camera pushes in; a shimmer subdivides as the build rises.
    let converge = 0,
      shimmer = 0,
      shimmerRate = 1;
    if (drop.phase === 1) {
      const progress = drop.progress;
      converge = progress * 0.8;
      shimmerRate = progress < 0.5 ? 1 : progress < 0.75 ? 2 : progress < 0.9 ? 4 : 8;
      shimmer = 0.3 + 0.7 * progress;
      // the gathered beams brighten as they close (the build rises; it never ebbs)
      const lastBar = drop.drop.gapStart - time < song.barPeriod;
      intensity = lastBar ? 24 : mixValue(13, 20, progress);
      width = mixValue(0.075, 0.058, progress);
    }

    // ---- the key word: every head sweeps onto the singer's mark, from just before the word,
    // holds it, and lets go over a beat.
    let onSinger = 0,
      keyX = 0;
    if (song.anchor.kind === "word") {
      const index = lastIndexAtOrBefore(song.anchorStarts, time + 0.15);
      if (index >= 0) {
        const moment = song.anchor.moments[index];
        onSinger = Math.max(0, Math.min(easeOutCubic(clamp01((time - moment.start + 0.15) / 0.15)), 1 - easeInOutCubic(clamp01((time - moment.end) / song.beatPeriod))));
        keyX = spotAt(moment.start);
      }
    }
    const singerX = spotAt(time);
    const tintColor = afterMain ? gel : white;
    const voiceSway = (scene.kind === "break" ? Math.sin(time * 0.35) * 0.2 : 0) + sweep;
    // The chase: a pair of heads steps across the rig on every eighth, left to right over two
    // beats, then back.
    const eighth = Math.floor(beat * 2);
    const chasePair = Math.floor(beat / 2) % 2 ? 3 - (eighth % 4) : eighth % 4;
    for (let index = 0; index < rigHeadCount; index++) {
      const beam = beams[index];
      const rank = rigHeadOrder.indexOf(index);
      const e = elevation - nod + barBreath + (shimmer > 0 ? Math.sin((beat * shimmerRate + index * 0.5) * Math.PI) * shimmer * 0.2 : 0);
      aimHead(beam, index, look, e, voiceSway + bassPan + swingChase);
      if (converge > 0) aimAt(beam, 0, 12.5, -9, converge);
      if (onSinger > 0) aimAt(beam, keyX, 0, -1.5, onSinger * 0.92);
      beam.angle = width;
      let level = rank < lit ? intensity * (1 + 0.8 * stabHit) : 0;
      // the chase: the lead pair brighter; in a drop's section the others stay near its level
      if (chase > 0) level *= Math.floor(index / 2) === chasePair ? 1 + 0.6 * chase : 1 - (inDropSection ? 0.1 : 0.35) * chase;
      if (onSinger > 0) level = Math.max(level, 20 * onSinger);
      if (inGap) level = 0;
      beam.intensity = level * fadeOut;
      const tint = index % 2 === 0 ? tintColor : white;
      beam.r = tint[0]; beam.g = tint[1]; beam.b = tint[2];
      if (tint !== white) beam.intensity *= gelBoost;
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
      const power = inHit ? Math.max(kickPower, 1 - hitAge / hitLength) : kickPower;
      beam.length = 3.2 + 3.2 * power;
      beam.intensity = inGap ? 0 : power * 16 * fadeOut;
      beam.r = white[0]; beam.g = white[1]; beam.b = white[2];
    }

    // ---- voice: the follow-spot from high above, onto the singer's mark (it moves from mark
    // to mark and holds through the breaths between notes).
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
    // (Desire's key line is sung into its hole), held at its peak over half a second so a
    // chopped vocal does not strobe it.
    spot.intensity = (inGap ? singingAt(time, 0.5) * 46 : singing * (scene.kind === "break" || scene.kind === "verse" ? 42 : 24) * (onSinger > 0 ? 1.4 : 1)) * fadeOut;
    spot.r = warm[0]; spot.g = warm[1]; spot.b = warm[2];

    // ---- snare → truss cells flash; hats → sparkle.
    state.snareFlash = inGap ? 0 : song.snares.impulse(time, 0.06, 0.45) * 1.4 * fadeOut;
    state.hatSparkle = inGap ? 0 : clamp01(song.hats.impulse(time, 0.04, 0.2)) * 0.45 * fadeOut;
    state.strobeSeed = song.hats.last(time);
    state.truss = inGap ? 0 : fadeOut;

    // ---- harmony: a faint wash on the back wall, white before the turn, the gel after.
    const other = song.value("other", time);
    state.wash[0] = tintColor[0]; state.wash[1] = tintColor[1]; state.wash[2] = tintColor[2];
    state.wash[3] = inGap ? 0 : other * (0.35 + 1.5 * stabHit) * fadeOut;

    // Lenses: dimmed while the beams converge, so a build narrows to a spike, not a flare;
    // held down in the drives so only a drop glares, and while the heads tip toward the
    // singer (and so toward the camera) for the key word.
    state.lens = lens * (1 - 0.4 * converge) * (1 - 0.6 * onSinger);
    state.lensSize = 1;

    // ---- the gap: blackout with four big blinders counting in, a pair per beat, aimed at the
    // eye; a one-beat hold lights them all on its last eighth.
    if (inGap) {
      const gapStart = drop.phase === 2 ? drop.drop.gapStart : leadIn >= 0 ? song.anchor.moments[leadIn].start : drop.drop.time - song.beatPeriod;
      const gapEnd = drop.phase === 2 ? drop.drop.time : leadIn >= 0 ? song.anchor.moments[leadIn].end : drop.drop.time;
      const beatsTotal = Math.max(1, Math.round((gapEnd - gapStart) / song.beatPeriod));
      let pairs;
      if (beatsTotal === 1) pairs = gapEnd - time <= song.beatPeriod / 2 ? 4 : 0;
      else pairs = Math.min(4, Math.max(1, Math.round(((Math.min(beatsTotal - 1, Math.floor((time - gapStart) / song.beatPeriod)) + 1) / beatsTotal) * 4)));
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        aimHead(beam, index, looks.blade, 0.12);
        beam.angle = 0.02;
        beam.intensity = rigHeadOrder.indexOf(index) < pairs * 2 ? 0.05 : 0;
      }
      state.lens = 80;
      state.lensSize = 2.6;
    }

    // ---- the drop: the exact frame fires everything over the audience, the brightest state
    // of the song for three beats, with a flash that dies over 100 ms; then four beats of tail
    // into the chase. Desire's main drop pours every head onto the singer instead. The turn,
    // when it is not a drop, gets a beat of the same and two of tail.
    if (inHit) {
      const length = dropHit ? hitLength : song.beatPeriod;
      const release = easeInCubic(clamp01((hitAge - length / 2) / (length / 2)));
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        const dx = beam.dx, dy = beam.dy, dz = beam.dz;
        if (mainHit && config.drop.funnel) {
          aimHead(beam, index, looks.fan, 0.3);
          aimAt(beam, singerX, 0, -1.5, 0.95);
        } else aimHead(beam, index, looks.blade, 0.35); // over the audience's heads, not into the lens
        mixAim(beam, dx, dy, dz, release);
        beam.angle = 0.065;
        // (the main drop's pour onto the singer, seen from the side, needs more to outshine)
        beam.intensity = mainHit ? (config.drop.funnel ? 95 : 60) : 48;
      }
      state.flash[0] = 1; state.flash[1] = 0.98; state.flash[2] = 0.95;
      state.flash[3] = (mainHit ? 0.7 : 0.5) * hitDecay(hitAge, 0.1);
      if (mainHit) {
        state.wash[0] = gel[0]; state.wash[1] = gel[1]; state.wash[2] = gel[2];
        state.wash[3] = 3 * (1 - hitAge / hitLength);
      }
      state.lens = 1.0;
      state.truss = 1;
      if (dropHit) shot = dropShot;
    } else if ((sinceDrop < hitLength + 4 * song.beatPeriod || sinceTurn < 3 * song.beatPeriod) && !inGap) {
      // the tail: four beats (two after the turn) easing from the hit's level to the section's
      const tail = sinceDrop < sinceTurn ? { age: sinceDrop - hitLength, length: 4 * song.beatPeriod } : { age: sinceTurn - song.beatPeriod, length: 2 * song.beatPeriod };
      const settle = easeInOutCubic(clamp01(tail.age / tail.length));
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        beam.intensity = mixValue(Math.max(beam.intensity, 32 * fadeOut), beam.intensity, settle);
      }
      state.lens = mixValue(1.0, state.lens, settle);
    }

    // ---- camera: the scene's shot with a slow move inside it; a push through a build.
    useShot(shot, sceneProgress - 0.5);
    if (drop.phase === 1) {
      const push = drop.progress;
      const close = shots.close;
      state.camera = [mixValue(state.camera[0], close[0][0], push), mixValue(state.camera[1], close[0][1], push), mixValue(state.camera[2], close[0][2], push)];
      state.target = [mixValue(state.target[0], close[1][0], push), mixValue(state.target[1], close[1][1], push), mixValue(state.target[2], close[1][2], push)];
      state.fov = mixValue(state.fov, close[2], push);
    }
    if (inGap) useShot("hero");

    // A beam whose cone holds the camera would wash the whole frame (a release sweeping
    // through the lens, a head aimed down the camera's line): it fades as the camera nears its
    // axis. Not in a gap, where the blinders face the camera by design.
    if (!inGap)
      for (let index = 0; index < rigHeadCount; index++) {
        const beam = beams[index];
        const vx = state.camera[0] - beam.x,
          vy = state.camera[1] - beam.y,
          vz = state.camera[2] - beam.z;
        const toCamera = (vx * beam.dx + vy * beam.dy + vz * beam.dz) / (Math.hypot(vx, vy, vz) || 1);
        const edge = Math.cos(Math.max(beam.angle * 2.2, 0.24));
        if (toCamera > edge) beam.intensity *= mixValue(1, 0.2, clamp01(((toCamera - edge) / (1 - edge)) * 3));
      }

    // haze: thinner in breakdowns, thickening through a build, thickest in a drop's section
    // (the drop outshines the drives whatever its look)
    state.haze = inDropSection && !inBookend ? (mainSection ? 2.0 : 1.7) : drop.phase === 1 ? mixValue(1.25, 1.5, drop.progress) : scene.kind === "break" ? 1.05 : 1.25;
    state.hazeTexture = 0.75;
    state.gloss = 0.55;
    return state;
  }

  return { setSong, at };
}
