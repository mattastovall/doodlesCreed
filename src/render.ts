import { coastSun } from "./county-atmosphere.ts";
import { blimpPosition, type Blimp } from "./aerial.ts";
import * as T from "three";
import { type City, type Box, type V3, randomSeed } from "./world.ts";
export const INK = "#222bc3",
  RED = "#d23c45",
  PAPER = "#f7f5e9",
  GOLD = "#dfa52b";
const vertex = `varying vec3 vNormal; varying vec3 vLocal; varying vec3 vLocalNormal; varying vec3 vWorld; varying float vDepth;
void main(){vLocal=position;vLocalNormal=normal;vec4 p=vec4(position,1.);vec3 n=normal;
#ifdef USE_INSTANCING
p=instanceMatrix*p;n=mat3(instanceMatrix)*n;
#endif
vec4 world=modelMatrix*p;vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*n);vec4 view=viewMatrix*world;vDepth=-view.z;gl_Position=projectionMatrix*view;}`;
const fragment = `precision highp float;uniform vec3 uInk;uniform vec3 uPaper;uniform float uFill;uniform float uLocal;uniform float uSurface;varying vec3 vLocal;varying vec3 vLocalNormal;varying vec3 vNormal;varying vec3 vWorld;varying float vDepth;
float surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float surfaceNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+vec2(1,1)),f.x),f.y);}
float pen(float x){float aa=max(fwidth(x),.015);return (1.-smoothstep(.07,.07+aa,abs(fract(x)-.5)))*clamp(1.-aa*.45,0.,1.);}
void main(){vec3 n=normalize(vNormal);float light=dot(n,normalize(vec3(-.55,1.,.35)));float shade=clamp((1.-light)*.44,0.,.8);
vec3 surface=mix(vWorld,vLocal,uLocal);vec3 axis=mix(n,vLocalNormal,uLocal);
vec2 uv=abs(axis.y)>.5?surface.xz:(abs(axis.x)>.5?surface.zy:surface.xy);
float grain=surfaceNoise(uv*11.);float patina=surfaceNoise(uv*.65);
// Surface-anchored paper fibres fade when too small to resolve, avoiding shimmer.
float fibreScale=55.;float fibreFade=1.-smoothstep(.35,1.2,max(fwidth(uv.x),fwidth(uv.y))*fibreScale);
float fibres=(surfaceNoise(uv*vec2(fibreScale,fibreScale*.7))-.5)*fibreFade;
uv=gl_FragCoord.xy*mix(.09,.155,uLocal);float wobble=sin(uv.x*1.9+uv.y*.7)*.11;
float hatch=pen(uv.x+uv.y*.9+wobble);float cross=pen(uv.x-uv.y*.8+wobble);
float strength=hatch*shade*1.15+cross*max(0.,shade-mix(.64,.36,uLocal))*1.1;strength*=smoothstep(.16,.36,shade);strength*=mix(.3,1.,uLocal);strength*=mix(1.-smoothstep(25.,110.,vDepth),1.,uLocal);strength=max(strength,uFill*mix(.45,1.,uLocal));strength+=uSurface*(.025+.09*shade+.024*(grain-.5)+.010*(patina-.5)+.018*fibres);vec3 color=mix(uPaper,uInk,clamp(strength,0.,1.));float fog=smoothstep(65.,250.,vDepth);color=mix(color,uPaper,fog*.86);gl_FragColor=vec4(color,1.);
#include <colorspace_fragment>
}`;
export function inkMaterial(ink = INK, fill = 0, local = false) {
  return new T.ShaderMaterial({
    uniforms: {
      uInk: { value: new T.Color(ink) },
      uPaper: { value: new T.Color(PAPER) },
      uFill: { value: fill },
      uLocal: { value: Number(local) },
      uSurface: { value: 0 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: T.DoubleSide,
  });
}
export function stroke(
  a: T.Vector3,
  b: T.Vector3,
  color = INK,
  radius = 0.025,
) {
  const delta = b.clone().sub(a),
    m = new T.Mesh(
      new T.CylinderGeometry(radius, radius, delta.length(), 5),
      new T.MeshBasicMaterial({ color }),
    );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  return m;
}
export function outlinedBox(
  size: V3,
  pos: V3,
  material: T.Material,
  group: T.Object3D,
  color = INK,
) {
  const geo = new T.BoxGeometry(...size),
    m = new T.Mesh(geo, material);
  m.position.set(...pos);
  const edge = new T.LineSegments(
    new T.EdgesGeometry(geo),
    new T.LineBasicMaterial({ color }),
  );
  m.add(edge);
  group.add(m);
  return m;
}
export function label(
  text: string,
  width = 512,
  color = INK,
  bg: string | null = null,
) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, 128);
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = 'bold 52px "Patrick Hand", cursive';
  ctx.fillText(text, width / 2, 66, width - 20);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(
    new T.PlaneGeometry(width / 128, 1),
    new T.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  return mesh;
}
export class Renderer {
  renderer: T.WebGLRenderer;
  private inkTarget = new T.WebGLRenderTarget(1, 1, {
    depthTexture: new T.DepthTexture(1, 1),
    samples: 4,
  });
  private inkScene = new T.Scene();
  private inkCamera = new T.Camera();
  private sunInView = new T.Vector3();
  private motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  private inkPost = new T.ShaderMaterial({
    uniforms: {
      color: { value: null },
      groundAware: { value: 0 },
      sunUv: { value: new T.Vector2() },
      sunEffects: { value: 0 },
      depth: { value: null },
      pixel: { value: new T.Vector2(1, 1) },
      ink: { value: new T.Color(INK) },
      clip: { value: new T.Vector2(0.06, 700) },
    },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform sampler2D color;uniform sampler2D depth;uniform vec2 pixel;uniform vec3 ink;uniform vec2 clip;uniform float groundAware;
    uniform vec2 sunUv;
    uniform float sunEffects;
    float skyAt(vec2 uv){return step(1.-0.000001,texture2D(depth,uv).x);}
    vec3 sunOptics(vec2 uv) {
      if(sunEffects == 0.) return vec3(0.);
      vec2 aspect=vec2(pixel.y/pixel.x,1.);
      vec2 delta=(uv-sunUv)*aspect;
      float r=length(delta);
      vec2 rim=min(sunUv,1.-sunUv);
      float fade=smoothstep(.003,.045,min(rim.x,rim.y));
      // Sample the solar disc, independent of the pixel receiving the flare.
      vec2 aperture=.0025/aspect;
      float visible=.25*(skyAt(sunUv+aperture)+skyAt(sunUv-aperture)
                       +skyAt(sunUv+vec2(-aperture.x,aperture.y))
                       +skyAt(sunUv+vec2(aperture.x,-aperture.y)));
      if(visible == 0.) return vec3(0.);
      vec3 optics=vec3(1.,.75,.41)*(.58*exp(-r*r*15000.)+.15*exp(-r*12.));
      if(sunEffects > 1.) {
        if(r < .45) {
          // Integrate sky and bright cloud gaps along the line to the sun.
          float rays=0.;
          for(int i=0;i<6;i++){
            vec2 tap=mix(sunUv,uv,(float(i)+.5)/6.);
            rays+=skyAt(tap)*smoothstep(.22,.65,dot(texture2D(color,tap).rgb,vec3(.21,.72,.07)));
          }
          optics+=vec3(1.,.78,.45)*(rays/6.)*.18*exp(-r*5.)*(1.-smoothstep(.34,.45,r));
        }
        vec2 axis=vec2(.5)-sunUv;
        float ghost=length((uv-(sunUv+axis*1.45))*aspect);
        float ring=length((uv-(sunUv+axis*2.1))*aspect);
        optics+=vec3(.24,.75,.64)*.045*(1.-smoothstep(.022,.032,ghost))
               +vec3(.97,.55,.25)*.035*(1.-smoothstep(.001,.008,abs(ring-.052)));
      }
      return optics*visible*fade;
    }
    float distanceAt(vec2 uv){float d=texture2D(depth,uv).x;return (clip.x*clip.y)/(clip.y-d*(clip.y-clip.x));}
    void main(){vec3 c=texture2D(color,vUv).rgb;float z=distanceAt(vUv);float edge=0.;
    if(groundAware<.5)for(int i=0;i<4;i++){vec2 dir=i==0?vec2(1.,0.):i==1?vec2(-1.,0.):i==2?vec2(0.,1.):vec2(0.,-1.);float other=distanceAt(vUv+dir*pixel*1.15);edge=max(edge,smoothstep(.012,.035,abs(z-other)/max(z,.1)));}
    if(groundAware>.5){edge=0.;for(int i=0;i<2;i++){vec2 dir=i==0?vec2(1.,0.):vec2(0.,1.);float a=distanceAt(vUv+dir*pixel*1.15),b=distanceAt(vUv-dir*pixel*1.15);float bend=abs(2./z-1./a-1./b)*z;edge=max(edge,smoothstep(.012,.035,bend));}}

    float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
    c=mix(c,ink,edge*(.68+grain*.2)*(1.-smoothstep(45.,140.,z)));gl_FragColor=vec4(c+sunOptics(vUv),1.);
    #include <colorspace_fragment>
    }`,
    depthTest: false,
    depthWrite: false,
  });
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(82, 1, 0.06, 700);
  cityGroup = new T.Group();
  beaconMeshes: T.Group[] = [];
  blimpMeshes: { model: T.Group; path: Blimp }[] = [];
  decor: T.Group[] = [];
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(PAPER);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.scene.background = new T.Color(PAPER);
    this.scene.fog = new T.Fog(PAPER, 65, 250);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.cityGroup, this.camera);
    this.inkPost.uniforms.color.value = this.inkTarget.texture;
    this.inkPost.uniforms.depth.value = this.inkTarget.depthTexture;
    this.inkScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.inkPost));
    this.resize();
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    const size = this.renderer.getDrawingBufferSize(new T.Vector2());
    this.inkTarget.setSize(size.x, size.y);
    this.inkPost.uniforms.pixel.value.set(1 / size.x, 1 / size.y);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  setQuality(high: boolean) {
    this.qualityHigh = high;
    this.renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.5) : 1);
    this.resize();
  }
  countyCars: import("./county-car.ts").CountyCarModel[] = [];
  private county = false;
  private sunlight?: import("./county-atmosphere.ts").CountySunlight;
  private frameCost = 0;
  private qualityHigh = true;
  async build(city: City) {
    this.sunlight?.dispose();
    this.sunlight = undefined;
    this.countyCars = [];
    const county = city.seed === "switchback-county";
    this.renderer.shadowMap.enabled = county;
    this.renderer.shadowMap.autoUpdate = !county;
    (this.scene.fog as T.Fog).color.set(county ? 0xe1cfc1 : PAPER);
    this.inkPost.uniforms.ink.value.set(county ? 0x304464 : INK);
    if (county !== this.county) {
      this.county = county;
      this.frameCost = 0.025;
      this.camera.far = county ? 285 : 700;
      this.camera.updateProjectionMatrix();
      this.inkTarget.dispose();
      this.inkTarget.samples = county ? 0 : 4;
      if (county) {
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
        this.resize();
      } else this.setQuality(this.qualityHigh);
    }
    this.inkPost.uniforms.groundAware.value =
      city.arena || city.seed === "switchback-county" ? 1 : 0;
    disposeGroup(this.cityGroup);
    this.cityGroup = new T.Group();
    this.scene.add(this.cityGroup);
    this.beaconMeshes = [];
    this.blimpMeshes = [];
    this.decor = [];
    const groups = new Map<string, Box[]>();
    for (const b of city.boxes) {
      if (
        county &&
        (b.piece ||
          b.kind === "building" ||
          b.kind === "road" ||
          b.kind === "ground" ||
          b.kind === "county-tree")
      )
        continue;
      if (b.kind === "collision" || b.kind === "boundary" || b.mesh) continue;
      const kind = [
        "ground",
        "road",
        "mark",
        "pavement",
        "metal",
        "bridge",
        "sky-platform",
      ].includes(b.kind)
        ? b.kind
        : "building";
      const key =
        kind === "ground"
          ? "ground"
          : `${kind}|${b.cell?.[0] ?? Math.floor(b.p[0] / 66)}|${b.cell?.[1] ?? Math.floor(b.p[2] / 66)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }
    const unit = new T.BoxGeometry(1, 1, 1),
      unitEdges = new T.EdgesGeometry(unit).getAttribute("position");
    for (const [key, boxes] of groups) {
      const [kind, cx, cz] = key.split("|");
      const group = new T.Group();
      if (kind !== "ground")
        group.userData.detailCenter = [
          Number(cx) * 66 + 33,
          Number(cz) * 66 + 33,
        ];
      if (kind === "bridge" || kind === "sky-platform") {
        delete group.userData.detailCenter;
        group.userData.aerial = true;
      }
      const fill =
        kind === "mark"
          ? 0.28
          : kind === "road"
            ? 0.045
            : kind === "metal"
              ? 0.16
              : 0;
      const inst = new T.InstancedMesh(
          unit.clone(),
          county
            ? new T.MeshLambertMaterial({
                color: kind === "ground" ? 0xc4be97 : 0xdfd7c7,
              })
            : inkMaterial(INK, fill),
          boxes.length,
        ),
        matrix = new T.Matrix4(),
        edgeVertices: number[] = [];
      boxes.forEach((b, i) => {
        matrix.compose(
          new T.Vector3(...b.p),
          new T.Quaternion(),
          new T.Vector3(...b.s),
        );
        inst.setMatrixAt(i, matrix);
        if (!["ground", "road", "mark", "stairs"].includes(b.kind))
          for (let j = 0; j < unitEdges.count; j++)
            edgeVertices.push(
              unitEdges.getX(j) * b.s[0] + b.p[0],
              unitEdges.getY(j) * b.s[1] + b.p[1],
              unitEdges.getZ(j) * b.s[2] + b.p[2],
            );
      });
      inst.receiveShadow = county;
      inst.computeBoundingSphere();
      group.add(inst);
      if (edgeVertices.length) {
        const edges = new T.BufferGeometry();
        edges.setAttribute(
          "position",
          new T.Float32BufferAttribute(edgeVertices, 3),
        );
        group.add(
          new T.LineSegments(edges, new T.LineBasicMaterial({ color: INK })),
        );
      }
      this.cityGroup.add(group);
    }
    for (const platform of city.platforms) {
      const g = new T.Group();
      g.position.set(...platform.p);
      for (const x of [-2.7, 2.7])
        for (const z of [-2.7, 2.7]) {
          const buoy = new T.Mesh(
            new T.OctahedronGeometry(0.45),
            inkMaterial(GOLD, 0.45),
          );
          buoy.position.set(x, 0.5, z);
          g.add(buoy);
        }
      const stripe = new T.Mesh(
        new T.BoxGeometry(6, 0.04, 0.18),
        new T.MeshBasicMaterial({ color: GOLD }),
      );
      stripe.position.set(0, 0.025, 2.85);
      g.add(stripe);
      const opposite = stripe.clone();
      opposite.position.z = -2.85;
      g.add(opposite);
      this.cityGroup.add(g);
    }
    for (const path of city.blimps) {
      const g = new T.Group();
      if (path.kind !== "buoy") {
        const hull = new T.Mesh(
          new T.SphereGeometry(1, 24, 12),
          inkMaterial(INK, 0.04),
        );
        hull.scale.set(6, 2.4, 2.6);
        g.add(hull);
        for (const x of [-3, 0, 3]) {
          const seam = new T.Mesh(
            new T.TorusGeometry(
              Math.sqrt(1 - (x * x) / 36) * 2.5,
              0.025,
              4,
              32,
            ),
            new T.MeshBasicMaterial({ color: INK }),
          );
          seam.rotation.y = Math.PI / 2;
          seam.position.x = x;
          g.add(seam);
        }
        const basket = new T.Mesh(
          new T.BoxGeometry(2, 0.7, 1.2),
          inkMaterial(INK, 0.25),
        );
        basket.position.y = -2.8;
        g.add(basket);
      } else {
        const buoy = new T.Mesh(
          new T.OctahedronGeometry(1.2),
          inkMaterial(GOLD, 0.2),
        );
        g.add(buoy);
        const stem = new T.Mesh(
          new T.CylinderGeometry(0.04, 0.04, 3, 5),
          new T.MeshBasicMaterial({ color: INK }),
        );
        stem.position.y = -1.5;
        g.add(stem);
      }
      const ring = new T.Mesh(
        new T.TorusGeometry(1.15, 0.14, 8, 32),
        new T.MeshBasicMaterial({ color: GOLD }),
      );
      ring.position.y = -4;
      g.add(ring);
      const ring2 = ring.clone();
      ring2.rotation.y = Math.PI / 2;
      g.add(ring2);
      if (path.kind !== "buoy") {
        const fin = new T.Mesh(
          new T.BoxGeometry(2, 3, 0.15),
          inkMaterial(INK, 0.12),
        );
        fin.position.x = -5;
        g.add(fin);
        const name = label("SKY HOOK", 256, GOLD);
        name.position.set(0, 3.4, 0);
        name.scale.set(5, 1.25, 1);
        g.add(name);
      }
      g.userData.blimp = true;
      this.cityGroup.add(g);
      this.blimpMeshes.push({ model: g, path });
    }
    unit.dispose();
    if (city.seed === "switchback-county") {
      const { CountySunlight } = await import("./county-atmosphere.ts");
      this.sunlight = new CountySunlight(this.scene);
      this.countyCars = await (
        await import("./county-render.ts")
      ).drawCounty(city, this.cityGroup);
      return;
    }
    if (city.arena) {
      await this.buildArena(city);
      return;
    }
    // Cheap distant massing keeps the extended skyline visible without drawing every interior.
    for (const b of city.buildings) {
      const group = new T.Group();
      outlinedBox(
        [b.w, b.height, b.d],
        [b.x, b.height / 2, b.z],
        inkMaterial(INK, 0.025),
        group,
      );
      group.userData.farCenter = [
        Math.floor(b.x / 66) * 66 + 33,
        Math.floor(b.z / 66) * 66 + 33,
      ];
      this.cityGroup.add(group);
    }
    for (const b of city.buildings) {
      const decorationStart = this.cityGroup.children.length;
      const sign = label(b.name, 512, INK, PAPER);
      sign.scale.set(Math.min(b.w / 5, 2.4), 0.72, 1);
      sign.position.set(b.x, 2.85, b.z + b.d / 2 + 0.21);
      this.cityGroup.add(sign);
      const number = label(String(b.id + 1).padStart(2, "0"), 128);
      number.scale.set(0.45, 0.45, 0.45);
      number.position.set(b.x + 2.6, 1.7, b.z + b.d / 2 + 0.25);
      this.cityGroup.add(number);
      if (b.kind === "shop") {
        const awning = new T.Group();
        outlinedBox([6, 0.12, 1.8], [0, 0, 0], inkMaterial(INK, 0.08), awning);
        awning.position.set(b.x, 2.6, b.z + b.d / 2 + 0.8);
        awning.rotation.x = 0.12;
        this.cityGroup.add(awning);
        for (let i = -3; i <= 3; i++) {
          const stripe = new T.Mesh(
            new T.BoxGeometry(0.08, 0.025, 1.8),
            inkMaterial(INK, 0.6),
          );
          stripe.position.set(i, 0.08, 0);
          awning.add(stripe);
        }
      }
      // Antennas and rooftop water tanks give buildings varied, readable silhouettes.
      if (b.id % 4 === 0) {
        const tank = new T.Group(),
          mat = inkMaterial();
        const barrel = new T.Mesh(
          new T.CylinderGeometry(1.2, 1.2, 2.2, 10),
          mat,
        );
        barrel.position.y = 2.3;
        tank.add(barrel);
        const roof = new T.Mesh(new T.ConeGeometry(1.3, 0.6, 10), mat);
        roof.position.y = 3.7;
        tank.add(roof);
        for (const part of [barrel, roof])
          part.add(
            new T.LineSegments(
              new T.EdgesGeometry(part.geometry, 20),
              new T.LineBasicMaterial({
                color: INK,
                transparent: true,
                opacity: 0.75,
              }),
            ),
          );
        for (const x of [-0.8, 0.8])
          for (const z of [-0.8, 0.8])
            tank.add(stroke(new T.Vector3(x, 0, z), new T.Vector3(x, 1.3, z)));
        tank.position.set(b.x + 4, b.height, b.z - 4);
        this.cityGroup.add(tank);
      }
      if (b.id % 3 === 0) {
        const antenna = new T.Group();
        antenna.add(stroke(new T.Vector3(), new T.Vector3(0, 3, 0)));
        for (let h = 1.5; h < 3; h += 0.5)
          antenna.add(
            stroke(new T.Vector3(-0.8, h, 0), new T.Vector3(0.8, h, 0)),
          );
        antenna.position.set(b.x + 3, b.height, b.z + 5);
        this.cityGroup.add(antenna);
      }
      if (b.facing === 2) {
        const group = new T.Group();
        for (const child of this.cityGroup.children.slice(decorationStart)) {
          child.position.x -= b.x;
          child.position.z -= b.z;
          group.add(child);
        }
        group.position.set(b.x, 0, b.z);
        group.rotation.y = Math.PI;
        this.cityGroup.add(group);
      }
    }
    const rand = randomSeed(city.seed + "decor");
    for (const item of city.dressing) {
      const [x, , z] = item.p;
      if (item.kind === "lamp") {
        const lamp = new T.Group();
        lamp.add(stroke(new T.Vector3(), new T.Vector3(0, 5, 0), INK, 0.045));
        lamp.add(
          stroke(new T.Vector3(0, 5, 0), new T.Vector3(1.1, 5, 0), INK, 0.035),
        );
        outlinedBox([0.8, 0.2, 0.5], [1, 4.9, 0], inkMaterial(), lamp);
        lamp.position.set(x, 0, z);
        this.cityGroup.add(lamp);
      }
      if (item.kind === "tree") {
        const tree = new T.Group();
        tree.add(stroke(new T.Vector3(), new T.Vector3(0, 2.7, 0), INK, 0.12));
        for (let k = 0; k < 5; k++) {
          const canopy = new T.Mesh(
            new T.IcosahedronGeometry(0.9 + rand() * 0.4, 1),
            inkMaterial(INK, 0.04),
          );
          canopy.position.set(
            Math.cos(k * 2) * 0.65,
            2.8 + rand(),
            Math.sin(k * 2) * 0.65,
          );
          const edge = new T.LineSegments(
            new T.EdgesGeometry(canopy.geometry, 30),
            new T.LineBasicMaterial({
              color: INK,
              transparent: true,
              opacity: 0.4,
            }),
          );
          canopy.add(edge);
          tree.add(canopy);
        }
        tree.position.set(x, 0, z);
        this.cityGroup.add(tree);
      }
      if (item.kind === "car") {
        const car = new T.Group(),
          mat = inkMaterial();
        outlinedBox([1.8, 0.65, 3.7], [0, 0.7, 0], mat, car);
        outlinedBox([1.5, 0.65, 1.8], [0, 1.3, 0], mat, car);
        for (const x of [-0.95, 0.95])
          for (const z of [-1.2, 1.2]) {
            const wheel = new T.Mesh(
              new T.CylinderGeometry(0.33, 0.33, 0.15, 10),
              inkMaterial(INK, 0.7),
            );
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(x, 0.4, z);
            car.add(wheel);
          }
        car.position.set(x, 0, z);
        car.rotation.y = Math.PI / 2;
        this.cityGroup.add(car);
      }
    }
    for (const block of city.plan.blocks) {
      const sign = label(block.neighborhood.toUpperCase(), 256, INK, PAPER);
      sign.position.set((block.minX + block.maxX) / 2, 5, block.minZ - 1);
      sign.scale.set(0.85, 0.5, 0.5);
      this.cityGroup.add(sign);
    }
    city.beacons.forEach((p, i) => {
      const g = new T.Group(),
        mat = new T.MeshBasicMaterial({ color: GOLD });
      for (let h = 0; h < 3; h++) {
        const ring = new T.Mesh(
          new T.TorusGeometry(0.8 + h * 0.13, 0.035, 5, 36),
          mat,
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.2 + h * 0.45;
        g.add(ring);
      }
      const diamond = new T.Mesh(
        new T.OctahedronGeometry(0.5),
        inkMaterial(GOLD, 0.3),
      );
      diamond.position.y = 1.6;
      g.add(diamond);
      const text = label("0" + (i + 1), 128, GOLD);
      text.position.y = 2.7;
      text.scale.set(0.8, 0.8, 0.8);
      g.add(text);
      g.position.set(...p);
      this.cityGroup.add(g);
      this.beaconMeshes.push(g);
    });
    for (const platform of city.platforms) {
      const g = new T.Group();
      g.position.set(...platform.p);
      for (const x of [-2.7, 2.7])
        for (const z of [-2.7, 2.7]) {
          const buoy = new T.Mesh(
            new T.OctahedronGeometry(0.45),
            inkMaterial(GOLD, 0.45),
          );
          buoy.position.set(x, 0.5, z);
          g.add(buoy);
        }
      const stripe = new T.Mesh(
        new T.BoxGeometry(6, 0.04, 0.18),
        new T.MeshBasicMaterial({ color: GOLD }),
      );
      stripe.position.set(0, 0.025, 2.85);
      g.add(stripe);
      const opposite = stripe.clone();
      opposite.position.z = -2.85;
      g.add(opposite);
      this.cityGroup.add(g);
    }
    for (const path of city.blimps) {
      const g = new T.Group();
      if (path.kind !== "buoy") {
        const hull = new T.Mesh(
          new T.SphereGeometry(1, 24, 12),
          inkMaterial(INK, 0.04),
        );
        hull.scale.set(6, 2.4, 2.6);
        g.add(hull);
        for (const x of [-3, 0, 3]) {
          const seam = new T.Mesh(
            new T.TorusGeometry(
              Math.sqrt(1 - (x * x) / 36) * 2.5,
              0.025,
              4,
              32,
            ),
            new T.MeshBasicMaterial({ color: INK }),
          );
          seam.rotation.y = Math.PI / 2;
          seam.position.x = x;
          g.add(seam);
        }
        const basket = new T.Mesh(
          new T.BoxGeometry(2, 0.7, 1.2),
          inkMaterial(INK, 0.25),
        );
        basket.position.y = -2.8;
        g.add(basket);
      } else {
        const buoy = new T.Mesh(
          new T.OctahedronGeometry(1.2),
          inkMaterial(GOLD, 0.2),
        );
        g.add(buoy);
        const stem = new T.Mesh(
          new T.CylinderGeometry(0.04, 0.04, 3, 5),
          new T.MeshBasicMaterial({ color: INK }),
        );
        stem.position.y = -1.5;
        g.add(stem);
      }
      const ring = new T.Mesh(
        new T.TorusGeometry(1.15, 0.14, 8, 32),
        new T.MeshBasicMaterial({ color: GOLD }),
      );
      ring.position.y = -4;
      g.add(ring);
      const ring2 = ring.clone();
      ring2.rotation.y = Math.PI / 2;
      g.add(ring2);
      if (path.kind !== "buoy") {
        const fin = new T.Mesh(
          new T.BoxGeometry(2, 3, 0.15),
          inkMaterial(INK, 0.12),
        );
        fin.position.x = -5;
        g.add(fin);
        const name = label("SKY HOOK", 256, GOLD);
        name.position.set(0, 3.4, 0);
        name.scale.set(5, 1.25, 1);
        g.add(name);
      }
      g.userData.blimp = true;
      this.cityGroup.add(g);
      this.blimpMeshes.push({ model: g, path });
    }
    unit.dispose();
  }
  private async buildArena(city: City) {
    const arena = city.arena!;
    if (arena.model) {
      // Reuse the exact collision triangles: no duplicate model payload or textures.
      const mat = inkMaterial(INK, 0.025);
      mat.uniforms.uSurface.value = 1.7;
      for (const box of city.boxes) {
        if (!box.mesh) continue;
        const indexed = new T.BufferGeometry();
        indexed.setAttribute(
          "position",
          new T.Float32BufferAttribute(box.mesh.vertices, 3),
        );
        indexed.setIndex(box.mesh.indices);
        const geo = indexed.toNonIndexed();
        indexed.dispose();
        geo.computeVertexNormals();
        const mesh = new T.Mesh(geo, mat);
        this.cityGroup.add(mesh);
      }
    }

    for (const prop of arena.props) {
      const a = new T.Vector3(...prop.a),
        b = new T.Vector3(...prop.b),
        d = b.clone().sub(a),
        length = d.length();
      const geo =
        prop.kind === "tank"
          ? new T.SphereGeometry(prop.radius, 12, 6)
          : new T.CylinderGeometry(
              prop.radius,
              prop.radius,
              length,
              prop.kind === "beam" ? 4 : 12,
            );
      const mesh = new T.Mesh(
        geo,
        inkMaterial(prop.ink || INK, prop.kind === "beam" ? 0.35 : 0.1),
      );
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      if (prop.kind === "tank") mesh.scale.y = 0.3;
      else
        mesh.quaternion.setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          d.normalize(),
        );
      const edges = new T.LineSegments(
        new T.EdgesGeometry(geo, 25),
        new T.LineBasicMaterial({
          color: INK,
          transparent: true,
          opacity: 0.5,
        }),
      );
      mesh.add(edges);
      this.cityGroup.add(mesh);
      if (prop.kind === "pipe")
        for (let t = 0; t <= length; t += 2.5) {
          const ring = new T.Mesh(
            new T.TorusGeometry(prop.radius + 0.025, 0.045, 4, 16),
            inkMaterial(INK, 0.35),
          );
          ring.position.copy(a).addScaledVector(d, t);
          ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), d);
          this.cityGroup.add(ring);
        }
    }
    city.beacons.forEach((p, i) => {
      const g = new T.Group();
      for (let j = 0; j < 4; j++) {
        const m = new T.Mesh(
          new T.OctahedronGeometry(j === 3 ? 0.45 : 0.08),
          inkMaterial(GOLD, 0.4),
        );
        m.position.y = j === 3 ? 1.6 : j * 0.3;
        g.add(m);
      }
      g.position.set(...p);
      this.cityGroup.add(g);
      this.beaconMeshes.push(g);
    });
  }
  adjustCountyResolution(seconds: number) {
    if (!this.county || !seconds) return;
    this.frameCost = this.frameCost * 0.92 + Math.min(seconds, 0.2) * 0.08;
    const ratio = this.renderer.getPixelRatio();
    if (this.frameCost > 0.042 && ratio > 0.67) {
      this.renderer.setPixelRatio(Math.max(0.67, ratio - 0.1));
      this.resize();
      this.frameCost = 0.025;
    } else if (this.frameCost < 0.012 && ratio < 1 && this.qualityHigh) {
      this.renderer.setPixelRatio(Math.min(1, ratio + 0.05));
      this.resize();
      this.frameCost = 0.025;
    }
  }
  draw(time: number, aerialTime = Date.now() / 1000, reducedMotion = false) {
    for (const { model, path } of this.blimpMeshes) {
      model.position.set(...blimpPosition(path, aerialTime));
      model.visible =
        model.position.distanceTo(this.camera.position) <
        (path.kind === "buoy" ? 170 : 340);
    }
    this.beaconMeshes.forEach((b, i) => {
      if (b.visible) {
        b.rotation.y = time * 0.6;
        b.children[3].position.y = 1.6 + Math.sin(time * 2 + i) * 0.15;
      }
    });
    for (const child of this.cityGroup.children) {
      if (
        this.beaconMeshes.includes(child as T.Group) ||
        child.userData.blimp ||
        child.userData.rubble ||
        child.userData.aerial
      )
        continue;
      const center = child.userData.detailCenter || child.userData.farCenter;
      if (center) {
        const dist = Math.hypot(
          center[0] - this.camera.position.x,
          center[1] - this.camera.position.z,
        );
        child.visible = child.userData.farCenter
          ? dist > 145
          : dist <= (child.userData.detailRange ?? 145);
      } else if (child.position.x || child.position.z)
        child.visible =
          Math.hypot(
            child.position.x - this.camera.position.x,
            child.position.z - this.camera.position.z,
          ) < 180;
    }
    this.sunlight?.update(this.camera, this.renderer, this.cityGroup, time);
    this.inkPost.uniforms.clip.value.set(this.camera.near, this.camera.far);
    this.renderer.setRenderTarget(this.inkTarget);
    this.renderer.render(this.scene, this.camera);
    const optics = this.inkPost.uniforms;
    optics.sunEffects.value = 0;
    if (this.county && !reducedMotion && !this.motionPreference.matches) {
      this.sunInView
        .copy(coastSun)
        .transformDirection(this.camera.matrixWorldInverse);
      if (this.sunInView.z < 0) {
        this.sunInView.applyMatrix4(this.camera.projectionMatrix);
        if (Math.abs(this.sunInView.x) < 1 && Math.abs(this.sunInView.y) < 1) {
          optics.sunUv.value.set(
            this.sunInView.x * 0.5 + 0.5,
            this.sunInView.y * 0.5 + 0.5,
          );
          optics.sunEffects.value = this.qualityHigh ? 2 : 1;
        }
      }
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.inkScene, this.inkCamera);
  }
}
export function disposeGroup(group: T.Group) {
  group.parent?.remove(group);
  const geos = new Set<T.BufferGeometry>(),
    mats = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  group.traverse((o) => {
    const m = o as T.Mesh;
    if ((m as T.InstancedMesh).isInstancedMesh)
      (m as T.InstancedMesh).dispose();
    if (m.geometry) geos.add(m.geometry);
    if (m.material)
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mats.add(mat);
        const map = (mat as T.MeshBasicMaterial).map;
        if (map) textures.add(map);
      }
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  group.clear();
}
