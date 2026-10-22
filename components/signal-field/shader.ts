// A drifting height field drawn as contour lines: terrain, or a fingerprint,
// depending on how you look at it. Written for WebGL 1 so it runs nearly everywhere.

export const VERTEX = /* glsl */ `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAGMENT = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 uRes;       // drawing buffer size in px
uniform float uTime;     // seconds
uniform float uRise;     // 0 -> 1 during the intro
uniform vec2 uMouse;     // buffer px, origin bottom-left
uniform float uMouseAmt; // 0 -> 1 while the pointer is over the field
uniform vec3 uPulse;     // buffer px x, y, start time (negative = no pulse)
uniform float uScale;    // buffer px per CSS px
uniform float uSeed;
uniform vec2 uFocus;     // where the field is brightest, 0..1 of the canvas

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 gradient(vec2 i) {
  float a = 6.2831853 * hash(i + uSeed);
  return vec2(cos(a), sin(a));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradient(i), f);
  float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 4; i++) {
    sum += amp * noise(p);
    p = ROT * p * 2.03 + 11.7;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  float unit = min(uRes.x, uRes.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / unit;
  float t = uTime;

  // Domain-warped drift, slow enough to read as breathing rather than motion.
  vec2 p = uv * 1.35;
  vec2 warp = vec2(
    fbm(p + vec2(0.0, t * 0.021)),
    fbm(p + vec2(4.7, 1.9) - vec2(t * 0.017, 0.0))
  );
  float h = fbm(p + 1.25 * warp + vec2(t * 0.008, -t * 0.006));

  // The pointer raises the terrain under it.
  vec2 m = (uMouse - 0.5 * uRes) / unit;
  float md = length(uv - m);
  h += uMouseAmt * 0.16 * exp(-md * md * 14.0);

  // A ring travels outward when someone joins the waitlist.
  float age = t - uPulse.z;
  if (uPulse.z >= 0.0 && age < 6.0) {
    float pd = length(uv - (uPulse.xy - 0.5 * uRes) / unit);
    float front = pd - age * 0.6;
    h += 0.09 * exp(-front * front * 60.0) * exp(-age * 0.6);
  }

  // Intro: a few faint lines multiply into the full field.
  float rise = smoothstep(0.0, 1.0, uRise);
  float v = h * mix(7.0, 24.0, rise);

  float fw = max(fwidth(v), 1e-4);
  float nearest = floor(v + 0.5);
  float dist = abs(v - nearest) / fw;
  float line = 1.0 - smoothstep(0.55 * uScale, 0.55 * uScale + 1.0, dist);
  float major = 1.0 - step(0.5, mod(nearest, 5.0));

  // Where contours crowd together they would blur into grey; thin them out.
  line *= 1.0 - clamp(fw * 1.6, 0.0, 1.0) * 0.85;

  // Sample markers: a grid of tiny squares, lit only where a contour passes.
  float cell = 34.0 * uScale;
  vec2 g = mod(gl_FragCoord.xy, cell) - 0.5 * cell;
  float onCell = step(max(abs(g.x), abs(g.y)), 1.1 * uScale);
  float marker = onCell * (1.0 - smoothstep(0.0, 0.16, abs(v - nearest)));

  float glow = 0.5 + 0.5 * smoothstep(-0.25, 0.45, h);
  float ink = line * mix(0.12, 0.4, major) * glow + marker * 0.6 * glow;

  vec2 q = gl_FragCoord.xy / uRes - uFocus;
  float vignette = smoothstep(1.05, 0.25, length(q * vec2(1.15, 1.35)));
  ink *= vignette * rise;

  float grain = (hash(gl_FragCoord.xy + fract(t * 7.0) * 400.0) - 0.5) * 0.05;
  gl_FragColor = vec4(vec3(clamp(ink + grain, 0.0, 1.0)), 1.0);
}
`;
