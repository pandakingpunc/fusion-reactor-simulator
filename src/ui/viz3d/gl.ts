/**
 * Raw WebGL2 renderer of the 3D view (no library): one small program, one vertex array per mesh, and the frame plan of
 * materials.ts executed in order. It owns no state of the run; the viewer gives it a scene, a plan and a camera.
 *
 * Shading modes of the fragment shader: 0 lit (diffuse + specular, two-sided), 1 glowing plasma (translucent, brighter where the
 * surface turns away from the viewer), 2 flat colour. The plasma deformation of a disruption (`Deform`) is done in the vertex
 * shader, so a disruption costs no geometry rebuild.
 */
import { OrbitCamera, eyeOf, viewProjection } from './camera';
import type { DrawCall } from './materials';
import type { Scene3D } from './scene';

/** Raised when the 3D view cannot run here: no WebGL2, or the shaders do not compile. The caller falls back to the 2D view. */
export class Viz3DUnavailable extends Error {
  constructor(message: string, readonly reason: 'no-webgl2' | 'shader' | 'resource') {
    super(message);
    this.name = 'Viz3DUnavailable';
  }
}

export const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_nrm;
uniform mat4 u_vp;
uniform vec4 u_def;    // axis R, axis Z, squash, active
uniform vec2 u_shift;  // shift in R and Z
out vec3 v_pos;
out vec3 v_nrm;
void main() {
  vec3 p = a_pos;
  if (u_def.w > 0.5) {
    float R = length(p.xy);
    float R2 = max(1e-3, u_def.x + u_def.z * (R - u_def.x) + u_shift.x);
    float Z2 = u_def.y + u_def.z * (p.z - u_def.y) + u_shift.y;
    p = vec3(R > 1e-9 ? p.xy * (R2 / R) : vec2(0.0), Z2);
  }
  v_pos = p;
  v_nrm = a_nrm;
  gl_Position = u_vp * vec4(p, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_pos;
in vec3 v_nrm;
uniform vec3 u_eye;
uniform vec3 u_color;
uniform float u_alpha;
uniform float u_glow;
uniform int u_mode;
out vec4 o_color;
void main() {
  vec3 n = normalize(v_nrm);
  vec3 v = normalize(u_eye - v_pos);
  if (dot(n, v) < 0.0) n = -n;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  if (u_mode == 0) {
    vec3 key = normalize(vec3(0.45, -0.55, 0.70));
    float d = max(dot(n, key), 0.0);
    float h = max(dot(n, normalize(key + v)), 0.0);
    vec3 c = u_color * (0.30 + 0.55 * d + 0.25 * ndv) + vec3(0.35) * pow(h, 32.0) * 0.6;
    o_color = vec4(c, u_alpha);
  } else if (u_mode == 1) {
    float rim = pow(1.0 - ndv, 2.0);
    o_color = vec4(u_color * u_glow, u_alpha * (0.35 + 0.65 * rim));
  } else {
    o_color = vec4(u_color * u_glow, u_alpha);
  }
}
`;

const MODE = { lit: 0, glow: 1, flat: 2 } as const;

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
}

export interface GlRenderer {
  /** upload the meshes of a scene (replaces the previous ones) */
  setScene(scene: Scene3D): void;
  /** draw one frame: the plan, from the camera, into a viewport of the given size in device pixels */
  render(plan: readonly DrawCall[], camera: OrbitCamera, widthPx: number, heightPx: number): void;
  /** draw calls and triangles of the last frame */
  readonly stats: { drawCalls: number; triangles: number };
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Viz3DUnavailable('could not create a shader', 'resource');
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Viz3DUnavailable(`shader compile failed: ${log}`, 'shader');
  }
  return sh;
}

/** Compile the program and set up the renderer on a WebGL2 context; throws Viz3DUnavailable when the context cannot draw. */
export function createGlRenderer(gl: WebGL2RenderingContext): GlRenderer {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  let fs: WebGLShader;
  try { fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER); } catch (e) { gl.deleteShader(vs); throw e; }
  const prog = gl.createProgram();
  if (!prog) throw new Viz3DUnavailable('could not create a program', 'resource');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '';
    gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    throw new Viz3DUnavailable(`program link failed: ${log}`, 'shader');
  }
  gl.deleteShader(vs); gl.deleteShader(fs); // kept alive by the program
  const loc = (name: string) => gl.getUniformLocation(prog, name);
  const U = {
    vp: loc('u_vp'), def: loc('u_def'), shift: loc('u_shift'), eye: loc('u_eye'),
    color: loc('u_color'), alpha: loc('u_alpha'), glow: loc('u_glow'), mode: loc('u_mode'),
  };

  let meshes = new Map<object, GpuMesh>();
  const stats = { drawCalls: 0, triangles: 0 };

  const freeMeshes = () => {
    for (const m of meshes.values()) { gl.deleteVertexArray(m.vao); for (const b of m.buffers) gl.deleteBuffer(b); }
    meshes = new Map();
  };

  const upload = (mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array }): GpuMesh => {
    const vao = gl.createVertexArray(), pos = gl.createBuffer(), nrm = gl.createBuffer(), idx = gl.createBuffer();
    if (!vao || !pos || !nrm || !idx) throw new Viz3DUnavailable('could not allocate buffers', 'resource');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, buffers: [pos, nrm, idx], count: mesh.indices.length };
  };

  let sceneRadius = 1;

  return {
    stats,
    setScene(scene: Scene3D) {
      freeMeshes();
      for (const it of scene.items) meshes.set(it, upload(it.mesh));
      sceneRadius = scene.radius;
    },
    render(plan, camera, widthPx, heightPx) {
      stats.drawCalls = 0; stats.triangles = 0;
      const w = Math.max(1, Math.floor(widthPx)), h = Math.max(1, Math.floor(heightPx));
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.043, 0.055, 0.078, 1);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.vp, false, viewProjection(camera, w / h, sceneRadius));
      const e = eyeOf(camera);
      gl.uniform3f(U.eye, e[0], e[1], e[2]);
      for (const call of plan) {
        const m = meshes.get(call.item);
        if (!m) continue;
        if (call.blend === 'opaque') { gl.disable(gl.BLEND); gl.depthMask(true); }
        else {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, call.blend === 'additive' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
        }
        if (call.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); } else gl.disable(gl.CULL_FACE);
        const d = call.deform;
        gl.uniform4f(U.def, d ? d.axisR : 0, d ? d.axisZ : 0, d ? d.squash : 1, d ? 1 : 0);
        gl.uniform2f(U.shift, d ? d.dR : 0, d ? d.dZ : 0);
        gl.uniform3f(U.color, call.color[0], call.color[1], call.color[2]);
        gl.uniform1f(U.alpha, call.alpha);
        gl.uniform1f(U.glow, call.glow);
        gl.uniform1i(U.mode, MODE[call.shading]);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
        stats.drawCalls++; stats.triangles += m.count / 3;
      }
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },
    dispose() {
      freeMeshes();
      gl.deleteProgram(prog);
      // give the GPU context back now: browsers keep only a handful of live contexts per page
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
