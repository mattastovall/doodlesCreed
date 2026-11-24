import * as T from "three";
import { makeCockpitInstaller } from "./county-cockpit.ts";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import { coastSun, panoramaSampling } from "./county-atmosphere.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { assetUrl } from "./release-info.ts";
import { VEHICLES, type VehicleKind } from "./county.ts";

function panel(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: texture });
}
// The GLB seat marker is the driver's eye position. Bake the jacket, head and
// visor into one colored mesh so an occupied near-detail car adds one draw.
function seatedMotorist() {
  const parts = [
    [
      new T.CylinderGeometry(0.19, 0.15, 0.32, 7)
        .scale(1, 1, 0.72)
        .translate(0, -0.31, 0.025),
      0x39867e,
    ],
    ...[-1, 1].flatMap(
      (side) =>
        [
          [
            new T.BoxGeometry(0.105, 0.22, 0.13)
              .rotateX(0.48)
              .translate(side * 0.19, -0.32, -0.035),
            0x39867e,
          ],
          [
            new T.BoxGeometry(0.095, 0.1, 0.21).translate(
              side * 0.18,
              -0.402,
              -0.14,
            ),
            0xf5efdf,
          ],
          [
            new T.BoxGeometry(0.14, 0.14, 0.32).translate(
              side * 0.09,
              -0.51,
              -0.08,
            ),
            0x303d51,
          ],
          [
            new T.BoxGeometry(0.13, 0.27, 0.12).translate(
              side * 0.09,
              -0.66,
              -0.185,
            ),
            0x303d51,
          ],
        ] as const,
    ),
    [
      new T.SphereGeometry(1, 9, 6)
        .scale(0.145, 0.172, 0.14)
        .translate(0, -0.012, 0.01),
      0xf5efdf,
    ],
    [
      new T.BoxGeometry(0.22, 0.045, 0.045).translate(0, 0.012, -0.109),
      0x28364c,
    ],
  ] as const;
  const light = new T.Vector3(-0.55, 1, -0.4).normalize(),
    n = new T.Vector3();
  const baked = parts.map(([shape, tint]) => {
    const geo = shape.toNonIndexed();
    // Face normals keep the two paper-shading bands crisp.
    geo.computeVertexNormals();
    const normals = geo.getAttribute("normal"),
      colors: number[] = [];
    const base = new T.Color(tint),
      shade = new T.Color();
    for (let i = 0; i < normals.count; i++) {
      const brightness = n.fromBufferAttribute(normals, i).dot(light);
      shade
        .copy(base)
        .multiplyScalar(
          brightness > 0.35 ? 1 : brightness > -0.35 ? 0.79 : 0.58,
        );
      colors.push(shade.r, shade.g, shade.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    return geo;
  });
  const body = new T.Mesh(
    mergeGeometries(baked)!,
    new T.MeshBasicMaterial({ vertexColors: true }),
  );
  body.name = "civilian-driver";
  body.visible = false;
  return body;
}
const driverFigure = seatedMotorist();
export async function loadFleet(sky: T.Texture) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const paint = new T.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      coat: { value: new T.Color(0xf5f4ec) },
      panorama: { value: sky },
      sun: { value: coastSun },
    },
    vertexShader: `uniform vec3 coat; varying vec3 tint,n,world;varying float enamel;
    void main(){enamel=color.a;tint=mix(pow(color.rgb,vec3(2.2)),coat,enamel);n=normalize(mat3(modelMatrix)*normal);world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 tint,n,world;varying float enamel;uniform vec3 sun;uniform sampler2D panorama;
    ${panoramaSampling}
    void main(){
      vec3 N=normalize(n), V=normalize(cameraPosition-world), R=reflect(-V,N);
      float lit=dot(N,sun), fresnel=pow(1.-max(0.,dot(N,V)),3.);
      vec3 sky=samplePanorama(panorama,R);
      vec3 body=tint*mix(vec3(.49,.58,.73),vec3(1.08,.97,.83),smoothstep(-.20,.38,lit));
      // Upholstery and hard trim retain their cool ink-and-paper palette.
      float up=.53*N.y+.47*lit;
      vec3 trim=tint*mix(vec3(.49,.63,.83),vec3(.92,1.,1.11),smoothstep(-.24,-.20,up));
      trim=mix(trim,tint*vec3(1.28,1.36,1.41),smoothstep(.48,.53,up));
      body=mix(trim,body,enamel);
      vec3 coat=mix(body,sky,enamel*(.10+.45*fresnel));
      coat+=vec3(1.,.82,.59)*pow(max(0.,dot(R,sun)),55.)*(.72*enamel);
      gl_FragColor=vec4(coat,1.);
      #include <colorspace_fragment>
    }`,
  });
  const glass = new T.ShaderMaterial({
    uniforms: { panorama: { value: sky } },
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec3 n,world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;n=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D panorama; varying vec3 n,world;
    ${panoramaSampling}
    void main(){vec3 v=normalize(cameraPosition-world),N=normalize(n);float f=pow(1.-max(dot(v,N),0.),2.);
      vec3 color=samplePanorama(panorama,reflect(-v,N));
      gl_FragColor=vec4(mix(vec3(.06,.18,.22),color,.62+f*.32),.2+.55*f);
      #include <colorspace_fragment>
    }`,
  });
  const paints = [
    0xf5f4ec, 0xead28b, 0x748fab, 0xdbe8ee, 0x7ca8ac, 0xc98172,
  ].map((hex) => {
    const material = paint.clone();
    material.uniforms.panorama.value = sky;
    material.uniforms.coat.value.setHex(hex);
    return material;
  });
  paint.dispose();
  const installCockpit = makeCockpitInstaller();
  const taxiLabel = panel(192, 54, (ctx) => {
    ctx.fillStyle = "#e6edf2";
    ctx.fillRect(0, 0, 192, 54);
    ctx.fillStyle = "#273d62";
    ctx.textAlign = "center";
    ctx.font = "bold 49px sans-serif";
    ctx.fillText("TAXI", 96, 45);
  });
  const templates = new Map<VehicleKind, T.Group>();
  await Promise.all(
    VEHICLES.map(async (kind) => {
      const { scene } = await loader.loadAsync(
        assetUrl("models/fleet/" + kind + ".glb"),
      );
      scene.traverse((o) => {
        if (o instanceof T.Mesh)
          o.material = o.name.includes("_glass_") ? glass : paints[0];
      });
      installCockpit(scene, kind);
      if (kind === "taxi") {
        const [lo, hi] = scene.userData.taxiSign;
        const geo = new T.PlaneGeometry(
          (hi[0] - lo[0]) * 0.93,
          (hi[1] - lo[1]) * 0.8,
        );
        for (const tier of ["near", "street"])
          for (const side of [-1, 1]) {
            const label = new T.Mesh(geo, taxiLabel);
            label.position.set(
              0,
              (hi[1] + lo[1]) / 2,
              side < 0 ? lo[2] - 0.003 : hi[2] + 0.003,
            );
            label.rotation.y = side < 0 ? Math.PI : 0;
            scene.getObjectByName(tier)!.add(label);
          }
      }
      templates.set(kind, scene);
    }),
  );
  const shadow = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 st;void main(){st=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 st;void main(){float edge=length(pow(abs(st),vec2(3.)));gl_FragColor=vec4(.025,.032,.048,.37*(1.-smoothstep(.32,1.,edge)));
    #include <colorspace_fragment>
    }`,
  });
  const contact = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const policePanel = panel(256, 64, (c) => {
    c.fillStyle = "#22334b";
    c.fillRect(0, 0, 256, 64);
    c.fillStyle = "#f1f2e7";
    c.font = "bold 42px sans-serif";
    c.textAlign = "center";
    c.fillText("POLICE", 128, 47);
  });
  return (kind: VehicleKind, finish: number, patrol = false) => {
    const car = new CountyCarModel(
      kind,
      templates.get(kind)!,
      paints[patrol ? 0 : finish % paints.length],
      paints[0],
    );
    const [w, l, h] = VEHICLE_DIMENSIONS[kind];
    const contactMesh = new T.Mesh(contact, shadow);
    contactMesh.position.y = 0.012;
    contactMesh.scale.set(w * 2.65, 1, l * 2.2);
    car.add(contactMesh);
    if (patrol) {
      const bar = new T.Group();
      for (const side of [-1, 1]) {
        const lens = new T.Mesh(
          new T.BoxGeometry(0.43, 0.14, 0.26),
          new T.MeshBasicMaterial({ color: side < 0 ? 0xe45358 : 0x477ef4 }),
        );
        lens.position.set(side * 0.235, h + 0.07, 0);
        bar.add(lens);
        car.beacons.push(lens.material);
        const door = new T.Mesh(new T.PlaneGeometry(1.08, 0.29), policePanel);
        door.position.set(side * (w * 0.89), h * 0.44, -0.05);
        door.rotation.y = (side * Math.PI) / 2;
        bar.add(door);
      }
      car.add(bar);
    }
    return car;
  };
}
// Driver's eye relative to the authored seat marker (inward, up, forward).
// Cab-over vans and the shallow saloon have different windshield rake.
const driverOffset: Record<VehicleKind, [number, number, number]> = {
  saloon: [0.045, -0.024, 0.19],
  coupe: [0, 0.015, 0.1],
  minivan: [0.045, 0.005, 0.18],
  delivery: [0.015, 0.015, 0.11],
  taxi: [0, 0.018, 0.105],
};
export class CountyCarModel extends T.Group {
  readonly driverEye: T.Vector3;
  readonly beacons: T.MeshBasicMaterial[] = [];
  readonly seat: T.Vector3;
  readonly doorSide: number;
  private motorist: T.Mesh;
  private radius: number;
  private hinges: T.Object3D[];
  private levels: T.Object3D[];
  private previous: string | null | undefined;
  private wasHijacking = false;
  private elapsed = 1;
  private lastTime = 0;
  private lastPosition = new T.Vector3();
  private roll = 0;
  private turn = 0;
  private steering: T.Object3D;
  private wheels: T.Object3D[];
  private needles: T.Object3D[];
  constructor(
    kind: VehicleKind,
    template: T.Group,
    coat: T.Material,
    baseCoat: T.Material,
  ) {
    super();
    const model = template.clone(true);
    model.traverse((o) => {
      if (o instanceof T.Mesh && o.material === baseCoat) o.material = coat;
    });
    this.needles = [
      model.getObjectByName("dial0")!,
      model.getObjectByName("dial1")!,
    ];
    this.seat = new T.Vector3().fromArray(model.userData.seat);
    this.doorSide = model.userData.doorSide;
    const [inward, up, forward] = driverOffset[kind];
    this.driverEye = this.seat
      .clone()
      .add(new T.Vector3(-inward * this.doorSide, up, -forward));
    this.radius = model.userData.wheelRadius;
    const tiers = ["near", "street", "far"];
    this.levels = tiers.map((name) => model.getObjectByName(name)!);
    this.motorist = driverFigure.clone();
    this.motorist.position.copy(this.seat);
    this.levels[0].add(this.motorist);
    this.hinges = tiers.map((name) => model.getObjectByName(name + "_door")!);
    this.steering = model.getObjectByName("near_steering")!;
    this.wheels = ["fl", "fr", "rl", "rr"].map((name) =>
      model.getObjectByName("near_wheel_" + name)!,
    );
    this.add(model);
    this.levels.forEach((o, i) => (o.visible = i === 2));
  }
  update(
    driver: string | null,
    now: number,
    distance: number,
    steer = 0,
    responding = false,
    reduced = false,
    hijack?: number,
    cockpit = false,
  ) {
    for (const [i, light] of this.beacons.entries()) {
      const bright =
        responding && (reduced || Math.sin(now * 8 + i * Math.PI) > 0);
      light.color.setHex(
        i === 0 ? (bright ? 0xff9b9b : 0xa32639) : bright ? 0xa5daff : 0x314bb1,
      );
    }
    const dt = this.lastTime
      ? Math.min(0.12, Math.max(0, now - this.lastTime))
      : 0;
    this.elapsed += dt;
    if (this.previous !== undefined && driver !== this.previous)
      this.elapsed = this.wasHijacking ? 0.55 : 0;
    this.wasHijacking = hijack !== undefined;
    let speed = 0;
    if (driver && this.previous === driver) {
      const dx = this.position.x - this.lastPosition.x,
        dz = this.position.z - this.lastPosition.z;
      speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      this.roll +=
        (dx * Math.sin(this.rotation.y) + dz * Math.cos(this.rotation.y)) /
        this.radius;
    }
    this.needles.forEach(
      (n, i) =>
        (n.rotation.z = 2.18 - Math.min(1, speed / (i ? 43 : 44.704)) * 4.36),
    );
    this.lastPosition.copy(this.position);
    this.lastTime = now;
    this.turn += (steer - this.turn) * (1 - Math.exp(-12 * dt));
    if (this.steering) this.steering.rotation.z = -this.turn * 1.9;
    this.wheels.forEach((wheel, i) => {
      if (wheel) {
        wheel.rotation.x = this.roll;
        wheel.rotation.y = i < 2 ? -this.turn * 0.45 : 0;
      }
    });
    this.previous = driver;
    const t = Math.min(1, this.elapsed / 0.98);
    // Swing out, pause for the runner, then close at the front hinge.
    const openness =
      hijack !== undefined
        ? T.MathUtils.smoothstep(hijack, 0, 0.32)
        : t < 0.36
          ? T.MathUtils.smoothstep(t, 0, 0.36)
          : 1 - T.MathUtils.smoothstep(t, 0.55, 1);
    const level = distance < 10 ? 0 : distance < 35 ? 1 : 2;
    this.motorist.visible =
      level === 0 && !!driver && (!cockpit || hijack !== undefined);
    if (level === 0) {
      const slide =
        hijack === undefined ? 0 : T.MathUtils.smoothstep(hijack, 0.26, 0.85);
      this.motorist.position.copy(this.seat);
      this.motorist.position.x += slide * this.doorSide * 1.68;
      this.motorist.position.y +=
        Math.sin(slide * Math.PI) * 0.19 - slide * 0.38;
      this.motorist.rotation.z = slide * this.doorSide * -0.62;
    }
    this.levels.forEach((o, i) => {
      o.visible = i === level;
      this.hinges[i].rotation.y = this.doorSide * 1.12 * openness;
    });
  }
}
