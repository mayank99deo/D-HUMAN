// Draws the contour field with WebGL. Uses no page APIs, so the same code runs in a
// Web Worker on an OffscreenCanvas (the usual case: the page's main thread never
// waits on the GPU) or on the main thread as a fallback.

import { FRAGMENT, VERTEX } from "./shader";

const INTRO_SECONDS = 2.6;
const STILL_TIME = 14; // the frame shown when motion is reduced or there is no real GPU
const FRAME_MS = 1000 / 30; // the field drifts slowly, so 30 fps looks the same as 60 at half the work
const SLOW_FRAME_MS = FRAME_MS * 1.4;

export type FieldOptions = {
  seed: number;
  focus: [number, number];
  /** CSS size of the canvas and the device pixel ratio. */
  width: number;
  height: number;
  dpr: number;
  reducedMotion: boolean;
};

export type FieldController = {
  resize(width: number, height: number, dpr: number): void;
  setVisible(visible: boolean): void;
  setHidden(hidden: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** Pointer position in CSS pixels from the canvas's top-left corner. */
  pointer(x: number, y: number): void;
  pulse(x: number, y: number): void;
  dispose(): void;
};

// Workers may lack requestAnimationFrame; a timer is fine at 30 fps.
const nextFrame = (cb: (now: number) => void) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(performance.now()), FRAME_MS) as unknown as number);
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id);

// Software rendering (no usable GPU) runs every frame on the CPU, so show the still frame.
function isSoftwareRenderer(gl: WebGLRenderingContext) {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(renderer);
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/** Returns null when WebGL isn't available on this canvas. */
export function createFieldRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: FieldOptions,
  onUnavailable: () => void,
): FieldController | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  }) as WebGLRenderingContext | null;
  if (!gl || gl.isContextLost() || !gl.getExtension("OES_standard_derivatives")) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  const state = {
    cssWidth: options.width,
    cssHeight: options.height,
    dpr: options.dpr,
    scale: Math.min(options.dpr || 1, 1.5),
    visible: false,
    hidden: false,
    reducedMotion: options.reducedMotion,
    software: isSoftwareRenderer(gl),
    ready: false,
    disposed: false,
    stillDrawn: false,
    startedAt: 0,
    raf: 0,
    lastFrame: 0,
    mouse: { x: 0, y: 0, until: 0, amount: 0 },
    pulse: [0, 0, -1] as [number, number, number],
  };
  const frameTimes: number[] = [];
  let uniforms: Record<string, WebGLUniformLocation | null> = {};
  let buffer: WebGLBuffer | null = null;

  const still = () => state.reducedMotion || state.software;

  const sizeCanvas = () => {
    canvas.width = Math.max(1, Math.round(state.cssWidth * state.scale));
    canvas.height = Math.max(1, Math.round(state.cssHeight * state.scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    state.stillDrawn = false;
  };

  const draw = (time: number, rise: number) => {
    gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
    gl.uniform1f(uniforms.uTime, time);
    gl.uniform1f(uniforms.uRise, rise);
    gl.uniform2f(uniforms.uMouse, state.mouse.x, state.mouse.y);
    gl.uniform1f(uniforms.uMouseAmt, state.mouse.amount);
    gl.uniform3f(uniforms.uPulse, ...state.pulse);
    gl.uniform1f(uniforms.uScale, state.scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const paint = (now: number) => {
    const time = (now - state.startedAt) / 1000;
    draw(time, Math.min(1, Math.max(0, (time - 0.2) / INTRO_SECONDS)));
  };

  const stop = () => {
    cancelFrame(state.raf);
    state.raf = 0;
    state.lastFrame = 0;
    frameTimes.length = 0;
  };

  const loop = () => {
    if (!state.raf && state.ready && state.visible && !state.hidden && !still()) state.raf = nextFrame(frame);
  };

  // Shows whatever the field should show right now: the still frame once, or the animation.
  const refresh = () => {
    if (!state.ready || !state.visible || state.hidden) return;
    if (!still()) return loop();
    if (state.stillDrawn) return;
    draw(STILL_TIME, 1);
    state.stillDrawn = true;
  };

  const frame = (now: number) => {
    state.raf = 0;
    if (state.lastFrame && now - state.lastFrame < FRAME_MS - 1) return loop();
    state.mouse.amount += ((now > state.mouse.until ? 0 : 1) - state.mouse.amount) * 0.1;
    paint(now);

    // Drop resolution on slow devices instead of dropping frames.
    if (state.lastFrame) {
      frameTimes.push(now - state.lastFrame);
      if (frameTimes.length === 30) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        frameTimes.length = 0;
        if (avg > SLOW_FRAME_MS && state.scale > 0.5) {
          state.scale = Math.max(0.5, state.scale * 0.8);
          sizeCanvas();
        }
      }
    }
    state.lastFrame = now;
    loop();
  };

  const toBuffer = (x: number, y: number) => [x * state.scale, (state.cssHeight - y) * state.scale] as const;

  // Asking for LINK_STATUS straight away would block until the GPU finishes compiling.
  // Where supported, poll a status that answers without waiting.
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  let poll = 0;
  const whenLinked = () => {
    if (state.disposed) return;
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
      poll = nextFrame(whenLinked);
      return;
    }
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[signal-field]", gl.getProgramInfoLog(program), gl.getShaderInfoLog(fs));
      onUnavailable();
      return;
    }
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(
      ["uRes", "uTime", "uRise", "uMouse", "uMouseAmt", "uPulse", "uScale"].map((n) => [n, gl.getUniformLocation(program, n)]),
    );
    gl.uniform1f(gl.getUniformLocation(program, "uSeed"), options.seed * 17.31);
    gl.uniform2f(gl.getUniformLocation(program, "uFocus"), ...options.focus);
    sizeCanvas();
    state.ready = true;
    state.startedAt = performance.now();
    refresh();
  };
  whenLinked();

  return {
    resize(width, height, dpr) {
      state.cssWidth = width;
      state.cssHeight = height;
      if (dpr !== state.dpr) {
        state.dpr = dpr;
        state.scale = Math.min(dpr || 1, 1.5);
      }
      if (!state.ready) return;
      sizeCanvas();
      // Resizing clears the canvas, so repaint right away instead of waiting a frame.
      if (!state.visible || state.hidden) return;
      if (still()) refresh();
      else paint(performance.now());
    },
    setVisible(visible) {
      state.visible = visible;
      if (visible) refresh();
      else stop();
    },
    setHidden(hidden) {
      state.hidden = hidden;
      if (hidden) stop();
      else refresh();
    },
    setReducedMotion(reduced) {
      state.reducedMotion = reduced;
      stop();
      state.stillDrawn = false;
      refresh();
    },
    pointer(x, y) {
      [state.mouse.x, state.mouse.y] = toBuffer(x, y);
      state.mouse.until = performance.now() + 1500;
    },
    pulse(x, y) {
      const [bx, by] = toBuffer(x, y);
      state.pulse = [bx, by, (performance.now() - state.startedAt) / 1000];
    },
    dispose() {
      state.disposed = true;
      stop();
      cancelFrame(poll);
      // Free what was created, but leave the context: on the main thread React can set
      // the field up again on the same canvas (Strict Mode, or a route hidden and shown).
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
