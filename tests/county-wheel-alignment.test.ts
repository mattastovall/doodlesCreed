import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { CountyCarModel } from "../src/county-car.ts";
import { VEHICLES } from "../src/county.ts";

test("all fleet LODs roll around fixed hubs, steer about vertical kingpins, and reverse spin", async () => {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (const kind of VEHICLES) {
    const file = await readFile(
      new URL(`../public/models/fleet/${kind}.glb`, import.meta.url),
    );
    const { scene } = await loader.parseAsync(Uint8Array.from(file).buffer, "");
    for (const name of ["dial0", "dial1"]) {
      const needle = new T.Group();
      needle.name = name;
      scene.add(needle);
    }
    const paint = new T.ShaderMaterial({
      uniforms: { wheelPose: { value: new T.Vector4() } },
    });
    const model = new CountyCarModel(kind, scene, paint, paint);
    const near = model.getObjectByName("near_wheel_fl")!;
    const authoredHub = near.position.clone(),
      radius = scene.userData.wheelRadius as number;
    const z0 = model.position.z;
    for (const [i, tier] of ["near", "street", "far"].entries()) {
      const d = [3, 20, 80][i];
      model.position.z = z0;
      model.update(null, 10 * i + 1, d);
      model.update("driver", 10 * i + 2, d, 1);
      const reference = near.rotation.x;
      for (let j = 0; j < 6; j++) {
        model.position.z -= radius * 0.4;
        model.update("driver", 10 * i + 2.1 + j * 0.1, d, 1);
        const axle = new T.Vector3(1, 0, 0).applyQuaternion(near.quaternion);
        assert.ok(Math.abs(axle.y) < 1e-10 && axle.z > 0.1);
        assert.ok(near.position.distanceTo(authoredHub) < 1e-10);
        const rear = model.getObjectByName("near_wheel_rr")!;
        assert.ok(
          new T.Vector3(1, 0, 0)
            .applyQuaternion(rear.quaternion)
            .distanceTo(new T.Vector3(1, 0, 0)) < 1e-10,
        );
      }
      assert.ok(
        Math.abs(Math.cos(near.rotation.x - reference) - Math.cos(-2.4)) < 1e-9,
      );
      assert.ok(
        Math.abs(Math.sin(near.rotation.x - reference) - Math.sin(-2.4)) < 1e-9,
      );
      model.position.z = z0;
      model.update("driver", 10 * i + 3, d, 1);
      assert.ok(Math.abs(Math.sin(near.rotation.x - reference)) < 1e-9);
      if (tier === "near") continue;
      const body = model.getObjectByName(tier + "_body_mesh") as T.Mesh;
      const attr = body.geometry.getAttribute("_wheelhub");
      const hubs = new Map<string, number>();
      for (let k = 0; k < attr.count; k++) {
        const x = attr.getX(k),
          y = attr.getY(k),
          z = attr.getZ(k),
          tag = attr.getW(k);
        if (!tag) continue;
        const name =
          tier + "_wheel_" + (z < 0 ? "f" : "r") + (x < 0 ? "l" : "r");
        assert.ok(
          model
            .getObjectByName(name)!
            .position.distanceTo(new T.Vector3(x, y, z)) < 0.001,
        );
        assert.equal(tag, z < 0 ? 1 : -1);
        hubs.set(name, (hubs.get(name) ?? 0) + 1);
      }
      assert.equal(hubs.size, 4);
      assert.ok(Math.min(...hubs.values()) > 24);
      body.onBeforeRender(
        {} as T.WebGLRenderer,
        new T.Scene(),
        new T.Camera(),
        body.geometry,
        paint,
        new T.Group(),
      );
      const pose = paint.uniforms.wheelPose.value;
      assert.ok(Math.abs(pose.w - Math.sin(near.rotation.y)) < 1e-10);
      assert.ok(Math.abs(pose.y - Math.sin(near.rotation.x)) < 1e-10);
    }
    model.rotation.y = 0.1;
    model.position.z -= 1;
    model.update("driver", 24, 10);
    assert.ok(
      near.rotation.y > 0,
      "remote steering follows observed forward curvature",
    );
    paint.dispose();
  }
});
