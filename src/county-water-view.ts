import * as T from "three";
import { coastSun, panoramaSampling } from "./county-atmosphere.ts";
import {
  countyWaterBounds,
  sampleCountySediment,
  sampleCountyWater,
} from "./county-hydrology.ts";

interface SurfaceVertex {
  x: number;
  y: number;
  z: number;
  depth: number;
  current: number;
  sand: number;
  silt: number;
}

function shorePoint(a: SurfaceVertex, b: SurfaceVertex): SurfaceVertex {
  const t = a.depth / (a.depth - b.depth);
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    z: a.z + t * (b.z - a.z),
    current: a.current + t * (b.current - a.current),
    sand: a.sand + t * (b.sand - a.sand),
    silt: a.silt + t * (b.silt - a.silt),
    depth: 0,
  };
}

function waterMaterial(sky: T.Texture, time: { value: number }) {
  const material = new T.MeshBasicMaterial({
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterSky = { value: sky };
    shader.uniforms.sunDirection = { value: coastSun };
    shader.vertexShader =
      `attribute vec4 waterData;
      varying vec3 surfacePosition; varying vec4 surfaceData;\n` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nsurfacePosition = (modelMatrix * vec4(position, 1.)).xyz; surfaceData = waterData;",
      );
    shader.fragmentShader =
      `varying vec3 surfacePosition; varying vec4 surfaceData;
      uniform float waterTime; uniform sampler2D waterSky; uniform vec3 sunDirection;
      ${panoramaSampling}\n` +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
      vec2 p = surfacePosition.xz;
      float depth = max(surfaceData.x, 0.);
      float t = waterTime;
      // Interfering wave trains perturb the reflection. Fade unresolved waves
      // with screen footprint so ripples stay stable from a moving car.
      float drift = t * (.36 + surfaceData.y * .24);
      vec2 bend = vec2(sin(dot(p, vec2(.046,.023))), cos(dot(p, vec2(-.017,.054))));
      vec2 q = p + 2.1 * bend;
      vec3 phase = vec3(dot(q, vec2(.44,.76)) - drift,
                        dot(q, vec2(-.91,.31)) + drift*.73,
                        dot(q, vec2(1.37,-1.72)) - drift*1.6);
      vec3 waves = sin(phase) * (1. - smoothstep(vec3(.35), vec3(2.6), fwidth(phase)));
      vec3 n = normalize(vec3(dot(waves,vec3(.015,-.010,.006)), 1.,
                              dot(waves,vec3(.026,.012,-.008))));
      vec3 eye = normalize(cameraPosition-surfacePosition);
      vec3 reflected = reflect(-eye,n);
      reflected.y = max(.014,reflected.y);
      vec3 skyTint = samplePanorama(waterSky,normalize(reflected));
      vec3 bedTint = vec3(.115,.19,.17) + surfaceData.z*vec3(.14,.11,.055) - surfaceData.w*vec3(.04,.055,.062);
      vec3 body = mix(bedTint, vec3(.036,.118,.157), 1.-exp(-depth*.66));
      float grazing = pow(1.-clamp(dot(n,eye),0.,1.),4.);
      vec3 water = mix(body, skyTint, .07+.27*grazing);
      float glint = pow(max(0.,dot(normalize(sunDirection+eye),n)),580.);
      diffuseColor.rgb = water + vec3(.27,.25,.20)*glint;
      `,
      );
  };
  return material;
}

// Clip against the actual bed triangles so the bank follows both the visible
// land and the collision surface at every water level, including sloped creeks.
export class CountyWaterView {
  readonly time = { value: 0 };
  private regions = countyWaterBounds.map(() => ({
    positions: [] as number[],
    data: [] as number[],
    faces: [] as number[],
  }));
  private material: T.Material;
  constructor(sky: T.Texture) {
    this.material = waterMaterial(sky, this.time);
  }

  addTile(
    x: number,
    z: number,
    w: number,
    d: number,
    vertices: number[],
    indices: number[],
  ) {
    const region = countyWaterBounds.findIndex(
      (b) =>
        x + w / 2 >= b.minX &&
        x - w / 2 <= b.maxX &&
        z + d / 2 >= b.minZ &&
        z - d / 2 <= b.maxZ,
    );
    if (region < 0) return;
    const samples: SurfaceVertex[] = [];
    for (let i = 0; i < vertices.length; i += 3) {
      const px = vertices[i],
        bed = vertices[i + 1],
        pz = vertices[i + 2];
      const water = sampleCountyWater(px, pz);
      const y = water?.surfaceY ?? bed - 1;
      const deposit = water && sampleCountySediment(px, pz);
      samples.push({
        x: px,
        y,
        z: pz,
        depth: y - bed,
        sand: deposit?.sand ?? 0,
        silt: deposit?.silt ?? 0,
        current: water?.kind === "creek" ? 1 : 0,
      });
    }
    const { positions, data, faces } = this.regions[region];
    for (let i = 0; i < indices.length; i += 3) {
      const a = samples[indices[i]],
        b = samples[indices[i + 1]],
        c = samples[indices[i + 2]];
      if (a.depth <= 0 && b.depth <= 0 && c.depth <= 0) continue;
      const polygon: SurfaceVertex[] = [];
      let prev = c;
      for (const curr of [a, b, c]) {
        if (prev.depth > 0 !== curr.depth > 0)
          polygon.push(shorePoint(prev, curr));
        if (curr.depth > 0) polygon.push(curr);
        prev = curr;
      }
      const base = positions.length / 3;
      for (const v of polygon) {
        positions.push(v.x, v.y, v.z);
        data.push(v.depth, v.current, v.sand, v.silt);
      }
      for (let j = 1; j < polygon.length - 1; j++)
        faces.push(base, base + j, base + j + 1);
    }
  }

  addTo(group: T.Group) {
    for (const { positions, data, faces } of this.regions) {
      if (!faces.length) continue;
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      geo.setAttribute("waterData", new T.Float32BufferAttribute(data, 4));
      geo.setIndex(faces);
      const mesh = new T.Mesh(geo, this.material);
      mesh.name = "county-water";
      group.add(mesh);
    }
  }
}
