import * as T from "three";
import { assetUrl } from "./release-info.ts";

// Thin coastal haze keeps landmarks legible across the valley. The far plane
// includes the scenic ridges even when seen from the opposite county corner.
export const countyView = { haze: 0xb6b6bc, density: 0.0006, far: 7000 };

// The sunset in coastal-sky.jpg sits at (0.311, 0.477) from the top left.
const azimuth = (0.311 - 0.5) * 2 * Math.PI;
const altitude = (0.5 - 0.477) * Math.PI;
export const coastSun = new T.Vector3(
  Math.cos(azimuth) * Math.cos(altitude),
  Math.sin(altitude),
  Math.sin(azimuth) * Math.cos(altitude),
);

export const panoramaSampling = `
vec3 samplePanorama(sampler2D panorama, vec3 d) {
  vec2 uv = vec2(atan(d.z,d.x) * 0.15915494 + 0.5,
                 asin(clamp(d.y,-1.,1.)) * 0.31830989 + 0.5);
  // Adjacent pixels across the meridian are one texel apart, even though
  // their unwrapped coordinates differ by almost the full texture width.
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= round(dx.x);
  dy.x -= round(dy.x);
  vec3 sky = textureGrad(panorama, uv, dx, dy).rgb;
  float edge = min(uv.x, 1. - uv.x);
  if (edge < .012) {
    vec3 opposite = textureGrad(panorama, vec2(1.-uv.x,uv.y),
                               vec2(-dx.x,dx.y),vec2(-dy.x,dy.y)).rgb;
    sky = mix(sky, opposite, .5 * (1. - smoothstep(0., .012, edge)));
  }
  return sky;
}`;

export async function countyTextures() {
  const loader = new T.TextureLoader();
  const [sky, asphalt, concrete, scrubland] = await Promise.all(
    ["coastal-sky", "asphalt", "concrete", "scrubland"].map(async (name) => {
      const texture = await loader.loadAsync(
        assetUrl("models/county/" + name + ".jpg"),
      );
      texture.colorSpace = T.SRGBColorSpace;
      texture.wrapS = T.RepeatWrapping;
      if (name !== "coastal-sky") {
        texture.wrapT = T.RepeatWrapping;
        texture.anisotropy = 4;
      }
      return texture;
    }),
  );
  return { sky, asphalt, concrete, scrubland };
}

export function countySky(sky: T.Texture) {
  const material = new T.ShaderMaterial({
    uniforms: { panorama: { value: sky } },
    side: T.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 direction;
    void main(){direction=position;vec4 projected=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=projected.xyww;}`,
    fragmentShader: `varying vec3 direction;uniform sampler2D panorama;
    ${panoramaSampling}
    void main(){gl_FragColor=vec4(samplePanorama(panorama,normalize(direction)),1.);
    #include <colorspace_fragment>
    }`,
  });
  material.addEventListener("dispose", () => sky.dispose());
  const mesh = new T.Mesh(new T.SphereGeometry(1, 40, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 100; // Fill uncovered depth before the transparent window pass.
  return mesh;
}

// A local light-space atlas follows the camera in coarse steps. Static scenery
// stays cached while cars move. Destruction and moving doors mark it dirty.
export class CountySunlight {
  private sun = new T.DirectionalLight(0xffe1bb, 1.3);
  private ambient = new T.HemisphereLight(0xd8eaff, 0xa2a1bb, 1.48);
  private nextRefresh = 0;
  constructor(private scene: T.Scene) {
    const shadow = this.sun.shadow;
    Object.assign(shadow.camera, {
      left: -76,
      right: 76,
      top: 76,
      bottom: -76,
      near: 1,
      far: 245,
    });
    shadow.camera.updateProjectionMatrix();
    shadow.mapSize.set(1024, 1024);
    shadow.bias = -0.00035;
    shadow.normalBias = 0.045;
    this.sun.castShadow = true;
    this.sun.target.position.y = -1000;
    scene.add(this.sun, this.sun.target, this.ambient);
  }
  update(
    camera: T.Camera,
    renderer: T.WebGLRenderer,
    group: T.Group,
    time: number,
  ) {
    const x = Math.round(camera.position.x / 16) * 16,
      z = Math.round(camera.position.z / 16) * 16,
      y = Math.floor(camera.position.y / 16) * 16;
    const target = this.sun.target.position;
    if (
      target.x === x &&
      target.z === z &&
      target.y === y &&
      (!group.userData.shadowDirty || time < this.nextRefresh)
    )
      return;
    target.set(x, y, z);
    this.sun.position.copy(target).addScaledVector(coastSun, 126);
    renderer.shadowMap.needsUpdate = true;
    group.userData.shadowDirty = false;
    this.nextRefresh = time + 0.14;
  }
  dispose() {
    this.scene.remove(this.sun, this.sun.target, this.ambient);
    this.sun.dispose();
  }
}
