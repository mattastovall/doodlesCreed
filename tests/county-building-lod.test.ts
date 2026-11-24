import assert from "node:assert/strict";
import test from "node:test";
import { Group, InstancedMesh, Matrix4 } from "three";
import { cityLot } from "../src/county-architecture.ts";
import { countyBuildings } from "../src/county-buildings.ts";

test("destroying a pump column clears its near and distant images and emits a single rubble instance", () => {
  const column = cityLot(0, 0, 9, 0.4).find(
    (box) => box.kind === "pump-column",
  )!;
  const group = new Group();
  countyBuildings(group, [column]);
  const meshes = group.children;
  assert.equal(meshes.length, 2);
  const nearCell = meshes.find((m) => m.userData.detailCenter)!;
  const farCell = meshes.find((m) => m.userData.farCenter)!;
  assert.deepEqual(nearCell.userData.detailCenter, farCell.userData.farCenter);
  assert.equal(nearCell.userData.detailRange, farCell.userData.detailRange);
  const near = nearCell.children[0] as InstancedMesh;
  const far = farCell.children[0] as InstancedMesh;
  const volume = (mesh: InstancedMesh) => {
    const pose = new Matrix4();
    mesh.getMatrixAt(0, pose);
    return pose.determinant();
  };
  column.onPieceState!(2);
  assert.equal(volume(near), 0);
  assert.equal(volume(far), 0);
  group.userData.rubbleSpawn(1, [0], [column]);
  const rubble = group.getObjectByName("county-rubble-1")!;
  assert.equal(rubble.children.length, 1);
  assert.ok(volume(rubble.children[0] as InstancedMesh) > 0);
  group.userData.rubbleClear();
  column.onPieceState!(0);
  assert.ok(volume(near) > 0 && volume(far) > 0);
});
