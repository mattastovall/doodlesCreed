import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { coastSun } from "./county-atmosphere.ts";
import type { VehicleKind } from "./county.ts";

type Part = [T.BufferGeometry, number];

const ink = 0x203454,
  navy = 0x365477,
  blue = 0x769db9,
  pearl = 0xe5eff2;
// One batched mesh per moving assembly. Crisp light bands follow the contours
// as the steering wheel rotates, including the inside edge of its rim.
const cabinMaterial = new T.ShaderMaterial({
  vertexColors: true,
  uniforms: { sun: { value: coastSun } },
  vertexShader: `
    varying vec3 tint, face;
    void main() {
      tint = color;
      face = mat3(modelMatrix) * normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }`,
  fragmentShader: `
    varying vec3 tint, face;
    uniform vec3 sun;
    void main() {
      vec3 N=normalize(face);
      float d = .53 * N.y + .47 * dot(N,sun);
      float mid = smoothstep(-.23, -.19, d);
      float high = smoothstep(.53, .58, d);
      vec3 light = mix(vec3(.46,.58,.76), vec3(.81,.89,1.), mid);
      gl_FragColor = vec4(tint * mix(light,vec3(1.12),high),1.);
      #include <colorspace_fragment>
    }`,
});

function assembly(parts: Part[]) {
  const colored = parts.map(([shape, hex]) => {
    const geo = shape.index ? shape.toNonIndexed() : shape;
    geo.deleteAttribute("uv");
    const color = new T.Color(hex);
    const values = new Float32Array(geo.getAttribute("position").count * 3);
    for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
    geo.setAttribute("color", new T.BufferAttribute(values, 3));
    return geo;
  });
  return new T.Mesh(mergeGeometries(colored)!, cabinMaterial);
}

function casting(points: number[][], depth: number, bevel: number) {
  const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  return new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
}

function makeWheel() {
  const parts: Part[] = [[new T.TorusGeometry(0.151, 0.017, 12, 64), navy]];
  for (const s of [-1, 1]) {
    parts.push([
      casting(
        [
          [s * 0.033, 0.016],
          [s * 0.143, 0.035],
          [s * 0.142, 0.008],
          [s * 0.04, -0.027],
        ],
        0.008,
        0.003,
      ),
      blue,
    ]);
  }
  parts.push(
    [
      casting(
        [
          [-0.031, -0.021],
          [0.031, -0.021],
          [0.012, -0.146],
          [-0.012, -0.146],
        ],
        0.009,
        0.003,
      ),
      blue,
    ],
    [
      casting(
        [
          [-0.051, 0.031],
          [0.051, 0.031],
          [0.063, 0.006],
          [0.034, -0.039],
          [-0.034, -0.039],
          [-0.063, 0.006],
        ],
        0.022,
        0.007,
      ),
      navy,
    ],
    [
      casting(
        [
          [-0.024, 0.005],
          [0.024, 0.005],
          [0.016, -0.002],
          [-0.018, -0.002],
        ],
        0.001,
        0.001,
      ).translate(0, 0, 0.03),
      pearl,
    ],
    [
      new T.TorusGeometry(0.151, 0.0178, 12, 4, 0.1).rotateZ(
        Math.PI / 2 - 0.05,
      ),
      pearl,
    ],
  );
  return assembly(parts);
}

function makeCluster() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 232;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#182e48";
  ctx.beginPath();
  ctx.roundRect(55, 2, 658, 227, 74);
  ctx.fill();
  for (const [index, cx] of [209, 559].entries()) {
    const cy = 122;
    ctx.beginPath();
    ctx.arc(cx, cy, 106, 0, 2 * Math.PI);
    ctx.fillStyle = "#304c67";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#a2c4d8";
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI / 2 + 2.18 - (i * 4.36) / 20;
      const major = i % 4 === 0;
      const place = (r: number) =>
        [cx + Math.cos(a) * r, cy - Math.sin(a) * r] as const;
      ctx.beginPath();
      ctx.moveTo(...place(96));
      ctx.lineTo(...place(major ? 81 : 88));
      ctx.lineWidth = major ? 5 : 3;
      ctx.strokeStyle = index && i > 16 ? "#eda886" : "#e5f1fa";
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "#f1f6f7";
        ctx.font = "bold 17px sans-serif";
        ctx.fillText(String(index ? i / 4 : i * 5), ...place(65));
      }
    }
    ctx.fillStyle = "#cedfe8";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(index ? "RPM × 1000" : "MPH", cx, cy + 57);
  }
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  const width = 0.326,
    height = 0.101;
  const dash = new T.Mesh(
    new T.PlaneGeometry(width, height),
    new T.MeshBasicMaterial({ map: tex, alphaTest: 0.5 }),
  );
  const needle = casting(
    [
      [-0.0026, -0.005],
      [0.0026, -0.005],
      [0.0006, 0.037],
      [-0.0006, 0.037],
    ],
    0.001,
    0.0002,
  );
  const hand = assembly([
    [needle, 0xffb390],
    [
      new T.CylinderGeometry(0.004, 0.004, 0.002, 12)
        .rotateX(Math.PI / 2)
        .translate(0, 0, 0.002),
      pearl,
    ],
  ]);
  for (const [i, px] of [209, 559].entries()) {
    const n = hand.clone();
    n.name = "dial" + i;
    n.position.set((px / 768 - 0.5) * width, (0.5 - 122 / 232) * height, 0.001);
    dash.add(n);
  }
  return dash;
}

const rim = makeWheel();
// Sweep an upholstered cowl from its rounded face down to the dash top.
// Its front face flares at the bottom and its rear slopes toward the glass.
function cowl() {
  const crest: number[][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (Math.PI * i) / 24;
    crest.push([-0.215 * Math.cos(a), -0.068 + 0.135 * Math.sin(a) ** 0.55]);
  }
  const front = casting(crest, 0.014, 0.003).translate(0, 0, -0.017);
  const vertices: number[] = [];
  for (let i = 0; i < crest.length - 1; i++) {
    const [x, y] = crest[i],
      [nx, ny] = crest[i + 1];
    const a = [x, y, -0.01],
      b = [nx, ny, -0.01],
      c = [x * 1.1, -0.061, -0.23],
      d = [nx * 1.1, -0.061, -0.23];
    vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
  }
  const top = new T.BufferGeometry();
  top.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  top.computeVertexNormals();
  return assembly([
    [front, 0x597795],
    [top, 0x7f9cb6],
  ]);
}
const hood = cowl();

function dashPad(halfWidth: number, y: number, z: number, column: number) {
  // Cross-section from the windshield lip over the padded brow, down the
  // front fascia and under the glovebox. Ends sweep forward at the pillars.
  const section = [
    [0.0, -0.29],
    [0.007, -0.12],
    [0.005, -0.047],
    [-0.002, -0.019],
    [-0.014, -0.004],
    [-0.027, 0.001],
    [-0.055, 0],
    [-0.101, -0.005],
    [-0.152, -0.022],
    [-0.162, -0.035],
    [-0.178, -0.089],
  ];
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 10 - 1,
      curve = Math.pow(Math.abs(u), 4);
    const recess =
      1 - T.MathUtils.smoothstep(Math.abs(u * halfWidth - column), 0.14, 0.24);
    for (const [dy, dz] of section)
      vertices.push(
        u * halfWidth,
        y + dy - 0.016 * curve - 0.035 * recess,
        z + dz - 0.047 * curve,
      );
    if (i === 20) continue;
    for (let j = 0; j < section.length - 1; j++) {
      const a = i * section.length + j,
        b = a + section.length;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return assembly([[geo, 0x98b2c8]]);
}
const vents: Part[] = [[new T.BoxGeometry(0.283, 0.058, 0.02), navy]];
for (const x of [-0.071, 0.071]) {
  vents.push([
    new T.BoxGeometry(0.127, 0.043, 0.008).translate(x, 0, 0.012),
    ink,
  ]);
  for (const y of [-0.012, 0, 0.012])
    vents.push([
      new T.BoxGeometry(0.115, 0.004, 0.005).translate(x, y, 0.018),
      blue,
    ]);
}
// The narrow pale molding carries the line of the outlets across the fascia.
for (const side of [-1, 1]) {
  const belt = casting(
    [
      [side * 0.141, 0.011],
      [side * 0.65, 0.011],
      [side * 0.64, 0.002],
      [side * 0.141, -0.002],
    ],
    0.003,
    0.001,
  );
  vents.push([belt, pearl]);
}
const vent = assembly(vents);
const fittings: Record<VehicleKind, [number, number, number]> = {
  // Top of instrument binnacle and rear edge of the molded dashboard differ
  // by body shell. Offsets are relative to each GLB's steering-column marker.
  saloon: [0.104, -0.027, 0.035],
  coupe: [0.112, -0.028, 0.11],
  minivan: [0.133, -0.066, 0.028],
  delivery: [0.098, -0.055, -0.045],
  taxi: [0.097, -0.088, -0.082],
};

export function makeCockpitInstaller() {
  const cluster = makeCluster();
  return (scene: T.Group, kind: VehicleKind) => {
    const near = scene.getObjectByName("near")!;
    const wheel = scene.getObjectByName("near_steering")!;
    const original = wheel.position.clone();
    wheel.clear();
    wheel.add(rim.clone());
    wheel.position.z += kind === "coupe" ? 0.133 : 0.095;
    wheel.position.y -= 0.025;
    wheel.rotation.x = -0.3;
    const [height, depth, ventDepth] = fittings[kind];
    const pod = hood.clone();
    pod.position.copy(original);
    pod.position.y += height;
    pod.position.z += depth;
    pod.rotation.x = -0.16;
    const face = cluster.clone();
    face.position.z = 0.005;
    const outlets = vent.clone();
    outlets.position.set(
      0,
      original.y + height - 0.091,
      original.z + ventDepth,
    );
    // Bake the stationary fittings into one near-detail draw. Clones of each
    // vehicle template share this geometry.
    pod.updateMatrix();
    outlets.updateMatrix();
    const shellWidth = {
      saloon: 0.77,
      coupe: 0.75,
      minivan: 0.8,
      delivery: 0.69,
      taxi: 0.67,
    }[kind];
    const pad = dashPad(
      shellWidth,
      original.y + height - 0.035,
      original.z + ventDepth - 0.004,
      original.x,
    );
    const fixed = new T.Mesh(
      mergeGeometries([
        pad.geometry,
        pod.geometry.clone().applyMatrix4(pod.matrix),
        outlets.geometry.clone().applyMatrix4(outlets.matrix),
      ])!,
      cabinMaterial,
    );
    face.position.applyMatrix4(pod.matrix);
    face.rotation.copy(pod.rotation);
    near.add(fixed, face);
  };
}
