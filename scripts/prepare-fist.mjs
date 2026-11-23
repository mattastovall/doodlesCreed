// Input: dist/profiles/generic-hand/right.glb from @webxr-input-profiles/assets 1.0.20.
// Bake once so drawing a crowd needs no hand skeletons, bone textures or animation mixers.
import fs from "node:fs";
import * as T from "three";
import meshopt from "meshoptimizer";
const glb = fs.readFileSync(process.argv[2]);
const length = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + length));
function attribute(i, ArrayType) {
  const accessor = gltf.accessors[i];
  const view = gltf.bufferViews[accessor.bufferView];
  const bytes = glb.subarray(
    28 + length + view.byteOffset,
    28 + length + view.byteOffset + view.byteLength,
  );
  return new ArrayType(Uint8Array.from(bytes).buffer);
}
const position = attribute(0, Float32Array),
  joints = attribute(3, Uint8Array),
  weights = attribute(4, Float32Array);
const sourceIndices = attribute(5, Uint16Array);
const v = (x, y, z) => new T.Vector3(x, y, z);
const wrist = gltf.nodes[0].translation;
function local([x, y, z]) {
  return v(z - wrist[2], x - wrist[0], y - wrist[1]);
}
const bones = gltf.skins[0].joints.map((i) => {
  const origin = local(gltf.nodes[i].translation);
  return { origin, target: origin.clone(), rotation: new T.Quaternion() };
});
// Pose knuckles first, then curl the middle and distal phalanges back into the palm.
function poseChain(start, directions) {
  directions.forEach((direction, j) => {
    const a = bones[start + j],
      b = bones[start + j + 1];
    const segment = b.origin.clone().sub(a.origin);
    const current = segment.clone().normalize().applyQuaternion(a.rotation);
    a.rotation.premultiply(
      new T.Quaternion().setFromUnitVectors(
        current,
        direction.clone().normalize(),
      ),
    );
    b.target
      .copy(a.target)
      .addScaledVector(direction.normalize(), segment.length());
    b.rotation.copy(a.rotation);
  });
}
for (let i = 0; i < 4; i++) {
  const lean = (1.5 - i) * 0.065;
  poseChain(6 + i * 5, [
    v(lean, -0.97, -0.23 + i * 0.045),
    v(lean, 0.04, 1),
    v(lean, 0.88, 0.48),
  ]);
}
// The opposed thumb lies across the proximal index and middle phalanges.
poseChain(1, [
  v(-0.49, -0.49, -0.72),
  v(0.36, -0.57, -0.74),
  v(0.95, -0.14, -0.26),
]);
const vertices = [],
  indices = [],
  welded = new Map();
for (const vertex of sourceIndices) {
  const p = local(position.subarray(vertex * 3, vertex * 3 + 3));
  const posed = v(0, 0, 0);
  for (let j = 0; j < 4; j++) {
    const w = weights[vertex * 4 + j];
    if (!w) continue;
    const bone = bones[joints[vertex * 4 + j]];
    posed.addScaledVector(
      p
        .clone()
        .sub(bone.origin)
        .applyQuaternion(bone.rotation)
        .add(bone.target),
      w,
    );
  }
  const coordinates = posed.toArray().map((n) => Math.round(n * 100000));
  const key = coordinates.join(",");
  if (!welded.has(key)) {
    welded.set(key, vertices.length / 3);
    vertices.push(...coordinates);
  }
  indices.push(welded.get(key));
}
const positions = Float32Array.from(vertices, (n) => n / 100000);
const geometry = new T.BufferGeometry();
geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
geometry.setIndex(indices);
geometry.computeVertexNormals();
const normals = geometry.getAttribute("normal");
const mesh = new T.Mesh(
  geometry,
  new T.MeshBasicMaterial({ side: T.DoubleSide }),
);
const occlusion = [];
const ray = new T.Raycaster();
for (let i = 0; i < positions.length / 3; i++) {
  const n = v(0, 0, 0).fromBufferAttribute(normals, i);
  const p = v(0, 0, 0)
    .fromArray(positions, i * 3)
    .addScaledVector(n, 0.0005);
  const frame = new T.Quaternion().setFromUnitVectors(v(0, 1, 0), n);
  let shadow = 0;
  for (let j = 0; j < 32; j++) {
    const radius = Math.sqrt((j + 0.5) / 32),
      angle = j * 2.39996323;
    ray.set(
      p,
      v(
        radius * Math.cos(angle),
        Math.sqrt(1 - radius * radius),
        radius * Math.sin(angle),
      ).applyQuaternion(frame),
    );
    ray.far = 0.032;
    const hit = ray.intersectObject(mesh, false)[0];
    if (hit) shadow += 1 - hit.distance / ray.far;
  }
  occlusion.push(Math.round((shadow * 255) / 32));
}
const { MeshoptSimplifier } = meshopt;
await MeshoptSimplifier.ready;
const reduced = MeshoptSimplifier.simplify(
  Uint32Array.from(indices),
  positions,
  3,
  3 * 340,
  0.04,
)[0];
const base64 = (a) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
function pack(triangles) {
  const [remap, count] = MeshoptSimplifier.compactMesh(triangles);
  const points = new Int16Array(count * 3),
    shade = new Uint8Array(count);
  remap.forEach((to, from) => {
    if (to >= count) return;
    points.set(vertices.slice(from * 3, from * 3 + 3), to * 3);
    shade[to] = occlusion[from];
  });
  return {
    points: base64(points),
    shade: base64(shade),
    triangles: base64(Uint16Array.from(triangles)),
  };
}
fs.writeFileSync(
  new URL("../src/models/fist.json", import.meta.url),
  JSON.stringify(
    { view: pack(Uint32Array.from(indices)), actor: pack(reduced) },
    null,
    2,
  ) + "\n",
);
