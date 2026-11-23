import * as T from "three";
import { handMesh, fistMaterial } from "./hand-model.ts";
import { guardRaise, punchPose } from "./fists.ts";

export function buildFists() {
  const group = new T.Group();
  group.name = "fists";
  const skin = fistMaterial(),
    cloth = fistMaterial(true);
  // Radius is in metres. The axial coordinate stretches from elbow to wrist.
  const profile = [
    [0.078, 0],
    [0.073, 0.23],
    [0.06, 0.6],
    [0.048, 0.87],
    [0.045, 0.89],
    [0.046, 0.9],
    [0.045, 0.97],
    [0.043, 1],
    [0, 1],
  ];
  const cut = new T.LatheGeometry(
    profile.map(([r, y]) => new T.Vector2(r, y)),
    24,
  );
  for (const side of [-1, 1]) {
    const hand = new T.Group();
    hand.add(handMesh(side, skin, true));
    hand.scale.setScalar(1.18);
    const sleeve = new T.Mesh(cut, cloth);
    group.add(sleeve, hand);
    hand.name = side === -1 ? "left-fist" : "right-fist";
    hand.userData.sleeve = sleeve;
  }
  return group;
}
const wrist = new T.Vector3(),
  elbow = new T.Vector3(),
  axis = new T.Vector3(),
  up = new T.Vector3(0, 1, 0),
  proximal = new T.Vector3(0, 0, 1);
export function animateFists(
  group: T.Group,
  move: number,
  age: number,
  time: number,
  equipAge: number,
) {
  for (const side of [-1, 1]) {
    const hand = group.getObjectByName(
      side === -1 ? "left-fist" : "right-fist",
    )!;
    const pose = punchPose(move, age, side);
    const lowered = 1 - guardRaise(equipAge, side, move, age);
    wrist.set(
      side * (0.205 + lowered * 0.08) + pose.x,
      -0.195 +
        (side === 1 ? 0.012 : 0) -
        lowered * 0.4 +
        pose.y +
        0.004 * Math.sin(time * 2.5 + side * 0.4),
      (side === -1 ? -0.425 : -0.385) + lowered * 0.14 - pose.z,
    );
    elbow.set(
      side * 0.295 + pose.x * 0.32,
      -0.445 - lowered * 0.16 + pose.y * 0.35,
      -0.12 - pose.z * 0.6,
    );
    axis.subVectors(wrist, elbow);
    const length = axis.length();
    axis.normalize();
    const sleeve = hand.userData.sleeve;
    sleeve.position.copy(elbow);
    sleeve.quaternion.setFromUnitVectors(up, axis);
    sleeve.scale.y = length + 0.001;
    hand.position.copy(wrist);
    // Roll about the forearm axis. Both surfaces meet at the same socket
    // through guard, extension and recovery, even while the elbow moves.
    hand.quaternion.setFromUnitVectors(proximal, axis.negate());
    const guardRoll = side === -1 ? 1.62 : 1.75;
    const turn = move === 2 ? 1.12 : 3;
    hand.rotateZ(-side * guardRoll + pose.roll * turn);
  }
}
