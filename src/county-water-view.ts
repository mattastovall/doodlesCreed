import * as T from "three";
import { coastSun, panoramaSampling } from "./county-atmosphere.ts";
import { countyWaterBounds, sampleCountyWater } from "./county-hydrology.ts";

interface SurfaceVertex {
  x: number;
  y: number;
  z: number;
  depth: number;
  current: number;
}

function shorePoint(a: SurfaceVertex, b: SurfaceVertex): SurfaceVertex {
  const t = a.depth / (a.depth - b.depth);
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    z: a.z + t * (b.z - a.z),
    current: a.current + t * (b.current - a.current),
    depth: 0,
  };
}

function waterMaterial(sky: T.Texture, time: { value: number }) {
  const material = new T.MeshBasicMaterial({
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterSky = { value: sky };
    shader.uniforms.sunDirection = { value: coastSun };
    shader.vertexShader =
      `attribute vec2 waterData;
      varying vec3 surfacePosition; varying vec2 surfaceData;\n` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nsurfacePosition = (modelMatrix * vec4(position, 1.)).xyz; surfaceData = waterData;",
      );
    shader.fragmentShader =
      `varying vec3 surfacePosition; varying vec2 surfaceData;
      uniform float waterTime; uniform sampler2D waterSky; uniform vec3 sunDirection;
      ${panoramaSampling}\n` +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
      vec2 p = surfacePosition.xz;
      float depth = max(surfaceData.x, 0.);
      float t = waterTime;
      float wind = dot(p,vec2(.32,.76)) + 1.37*sin(dot(p,vec2(.08,-.095)));
      float swell = sin(wind - t*.85);
      float crossWave = sin(dot(p,vec2(-.55,.18)) + t*.53 + .45*swell);
      float capillaryPhase = dot(p,vec2(.75,2.3)) + swell*1.6 - t*1.14 + surfaceData.y*.65*sin(wind-t*1.4);
      float fine = 1.-smoothstep(.32,1.8,fwidth(capillaryPhase));
      float capillary = sin(capillaryPhase)*fine;
      vec3 n = normalize(vec3(.022*crossWave+.009*capillary, 1., .03*swell+.017*capillary));
      vec3 eye = normalize(cameraPosition-surfacePosition);
      vec3 reflected = reflect(-eye,n);
      reflected.y = max(.012,reflected.y);
      vec3 skyTint = samplePanorama(waterSky,normalize(reflected));
      vec3 shoal = vec3(.235,.47,.415);
      vec3 deep = vec3(.028,.185,.225);
      vec3 body = mix(shoal,deep,1.-exp(-depth*.48));
      float fresnel = .17+.50*pow(1.-clamp(dot(n,eye),0.,1.),3.);
      vec3 water = mix(body,skyTint,fresnel);
      float sun = pow(max(0.,dot(normalize(sunDirection+eye),n)),145.);
      water += vec3(1.,.90,.76)*sun*.35;
      // Sparse silver strokes break across the wind and dissolve in the distance.
      float stroke = smoothstep(.85,.99,capillary)*smoothstep(.48,.90,crossWave)*fine;
      water += vec3(.20,.31,.33)*stroke*(.24+.50*surfaceData.y);
      diffuseColor.rgb = water;
      diffuseColor.a = mix(.08,1.,smoothstep(0.,1.65,depth));
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
      samples.push({
        x: px,
        y,
        z: pz,
        depth: y - bed,
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
        data.push(v.depth, v.current);
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
      geo.setAttribute("waterData", new T.Float32BufferAttribute(data, 2));
      geo.setIndex(faces);
      const mesh = new T.Mesh(geo, this.material);
      mesh.name = "county-water";
      group.add(mesh);
    }
  }
}
