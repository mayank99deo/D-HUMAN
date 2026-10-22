"use client";

import { useEffect, useRef } from "react";
import { FRAGMENT, VERTEX } from "./shader";

export const PULSE_EVENT = "dhuman:pulse";
export type PulseDetail = { x: number; y: number };

const INTRO_SECONDS = 2.6;
const STILL_TIME = 14; // the frame shown when motion is reduced

type Props = {
  className?: string;
  seed?: number;
  /** Where the field is brightest, as fractions of the canvas (x from left, y from bottom). */
  focus?: [number, number];
};

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[signal-field]", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

export function SignalField({ className, seed = 0, focus = [0.7, 0.55] }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [focusX, focusY] = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Without WebGL the section falls back to plain black rather than a blank canvas.
    const unavailable = () => {
      canvas.style.visibility = "hidden";
    };
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
    });
    if (!gl || gl.isContextLost() || !gl.getExtension("OES_standard_derivatives")) return unavailable();

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return unavailable();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[signal-field]", gl.getProgramInfoLog(program));
      return unavailable();
    }
    gl.useProgram(program);
    canvas.style.visibility = "";

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("uRes"), uTime = u("uTime"), uRise = u("uRise"), uMouse = u("uMouse");
    const uMouseAmt = u("uMouseAmt"), uPulse = u("uPulse"), uScale = u("uScale");
    gl.uniform1f(u("uSeed"), seed * 17.31);
    gl.uniform2f(u("uFocus"), focusX, focusY);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let scale = Math.min(window.devicePixelRatio || 1, 1.5);
    let raf = 0;
    let visible = false;
    const start = performance.now();
    const mouse = { x: 0, y: 0, target: 0, amount: 0, idle: 0 };
    let pulse: [number, number, number] = [0, 0, -1];
    const frameTimes: number[] = [];
    let lastFrame = 0;

    // Resizing clears the canvas, so repaint right away instead of waiting a frame.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (reducedMotion.matches) draw(STILL_TIME, 1);
      else paint(performance.now());
    };

    const draw = (time: number, rise: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uRise, rise);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uMouseAmt, mouse.amount);
      gl.uniform3f(uPulse, pulse[0], pulse[1], pulse[2]);
      gl.uniform1f(uScale, scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const paint = (now: number) => {
      const time = (now - start) / 1000;
      draw(time, Math.min(1, Math.max(0, (time - 0.2) / INTRO_SECONDS)));
    };

    const frame = (now: number) => {
      raf = 0;
      if (mouse.target > 0 && now > mouse.idle) mouse.target = 0;
      mouse.amount += (mouse.target - mouse.amount) * 0.05;
      paint(now);

      // Drop resolution on slow devices instead of dropping frames.
      if (lastFrame) {
        frameTimes.push(now - lastFrame);
        if (frameTimes.length === 45) {
          const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
          frameTimes.length = 0;
          if (avg > 24 && scale > 0.5) {
            scale = Math.max(0.5, scale * 0.8);
            resize();
          }
        }
      }
      lastFrame = now;
      loop();
    };

    const loop = () => {
      if (!raf && visible && !document.hidden && !reducedMotion.matches) {
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
      frameTimes.length = 0;
    };

    const toBuffer = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return [(clientX - rect.left) * scale, (rect.bottom - clientY) * scale] as const;
    };

    const onPointer = (event: PointerEvent) => {
      if (!visible || event.pointerType === "touch") return;
      [mouse.x, mouse.y] = toBuffer(event.clientX, event.clientY);
      mouse.target = 1;
      mouse.idle = performance.now() + 1500;
    };

    const onPulse = (event: Event) => {
      const { x, y } = (event as CustomEvent<PulseDetail>).detail;
      const [bx, by] = toBuffer(x, y);
      pulse = [bx, by, (performance.now() - start) / 1000];
    };

    const onVisibility = () => (document.hidden ? stop() : loop());
    const onMotionPreference = () => {
      stop();
      if (reducedMotion.matches) draw(STILL_TIME, 1);
      else loop();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) loop();
      else stop();
    });
    intersection.observe(canvas);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener(PULSE_EVENT, onPulse);
    document.addEventListener("visibilitychange", onVisibility);
    reducedMotion.addEventListener("change", onMotionPreference);
    resize();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener(PULSE_EVENT, onPulse);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotion.removeEventListener("change", onMotionPreference);
      // Free what this effect created, but keep the context alive: React can run the
      // effect again on the same canvas (Strict Mode, or a route hidden and shown).
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [seed, focusX, focusY]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}

export function sendPulse(from: Element) {
  const rect = from.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent<PulseDetail>(PULSE_EVENT, {
      detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    }),
  );
}
