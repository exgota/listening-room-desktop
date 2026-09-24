// Shared pieces for the visualizers: shaping functions, colour, WebGL setup, and fonts.
// Nothing here keeps state between frames.

const visualFonts = [
  '900 100px "Archivo"',
  '700 100px "Archivo"',
  '600 100px "Inter Tight"',
  '500 100px "Jost"',
  '400 100px "Instrument Serif"',
  'italic 400 100px "Instrument Serif"',
  '400 100px "IBM Plex Mono"',
  '500 100px "IBM Plex Mono"',
];
const visualFontsReady = Promise.all(visualFonts.map((font) => document.fonts.load(font).catch(() => []))).then(() => true);

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const clampRange = (value, low, high) => (value < low ? low : value > high ? high : value);
const mixValue = (first, second, amount) => first + (second - first) * amount;
const smoothStep = (edge0, edge1, value) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInCubic = (x) => Math.pow(clamp01(x), 3);
const easeInOutCubic = (x) => {
  x = clamp01(x);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeOutBack = (x, overshoot = 1.7) => {
  x = clamp01(x) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
};
// A hit that lands instantly and decays: 1 at age 0, e^-1 at age = decay.
const hitDecay = (age, decay) => (age < 0 || !Number.isFinite(age) ? 0 : Math.exp(-age / decay));
const fract = (value) => value - Math.floor(value);
// Deterministic hash of an integer to 0..1.
const hash01 = (value) => {
  let x = Math.imul((value | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

function hexColor(hex) {
  const value = parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function cssColor([red, green, blue], alpha = 1) {
  return `rgba(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)},${alpha})`;
}

function mixColor(first, second, amount, into = [0, 0, 0]) {
  into[0] = first[0] + (second[0] - first[0]) * amount;
  into[1] = first[1] + (second[1] - first[1]) * amount;
  into[2] = first[2] + (second[2] - first[2]) * amount;
  return into;
}

function createVisualCanvas() {
  const canvas = document.createElement("canvas");
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

function createWebGL(canvas) {
  return canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
}

function compileWebGLProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) || "Shader failed");
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || "Link failed");
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index++) {
    const info = gl.getActiveUniform(program, index);
    const name = info.name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

const fullscreenVertexShader = `#version 300 es
out vec2 vUv;
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

// Backing-store size for a canvas: device pixels, capped so a large or dense display cannot
// multiply the per-frame cost.
function canvasPixels(width, height, ratio, maximumPixels) {
  let scale = ratio;
  if (width * height * scale * scale > maximumPixels) scale = Math.sqrt(maximumPixels / (width * height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), scale];
}
