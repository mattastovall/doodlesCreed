import { drawRegionalLandscape } from "./county-landscape.ts";
import {
  countySky,
  countyTextures,
  coastSun,
  panoramaSampling,
} from "./county-atmosphere.ts";
import {
  clearOfLotsAndRoads,
  dryCountry,
  landColor,
} from "./county-landcover.ts";
import { terrainHeight } from "./county-plan.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { palmGeometry } from "./county-palm.ts";
import { loadFleet } from "./county-car.ts";
import { isCountyPiece } from "./county-architecture.ts";
import { countyBuildings } from "./county-buildings.ts";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";
import { inkMaterial, INK } from "./render.ts";
import { elevation, countyCars } from "./county.ts";
import { drawCountyRoads } from "./county-roads.ts";
import { randomSeed, type City } from "./world.ts";

// At the playable edge the first ring shares every 20 m terrain vertex.
// Wider bands beyond it give the skyline parallax at a fixed geometry cost.
function outerRidges(limit: number) {
  const vertices: number[] = [],
    indices: number[] = [];
  const side = (2 * limit) / 20,
    perimeter = 4 * side;
  for (const offset of [
    0, 45, 120, 225, 390, 600, 840, 1130, 1520, 1920, 2350,
  ]) {
    const extent = limit + offset;
    for (let i = 0; i < perimeter; i++) {
      const t = ((i % side) / side) * 2 - 1,
        edge = Math.floor(i / side);
      const x = extent * [t, 1, -t, -1][edge],
        z = extent * [-1, t, 1, -t][edge];
      const swell =
        Math.sin(x / 210 + z / 420) * 0.5 +
        Math.cos(z / 172 - x / 380) * 0.3 +
        Math.sin(x / 81 + z / 97) * 0.2;
      const crest =
        Math.exp(-(((offset - 610 - swell * 180) / 270) ** 2)) *
          (120 + swell * 103) +
        Math.exp(-(((offset - 1420 + swell * 210) / 380) ** 2)) *
          (225 + swell * 170);
      const blend = Math.min(1, offset / 225);
      vertices.push(
        x,
        elevation(x, z) * (1 - blend) + (30 + swell * 24 + crest) * blend,
        z,
      );
      if (offset) {
        const j = vertices.length / 3 - 1,
          k = i + 1 === perimeter ? j + 1 - perimeter : j + 1;
        indices.push(j - perimeter, k - perimeter, j, k - perimeter, k, j);
      }
    }
  }
  return { vertices, indices };
}

function groundGeometry(vertices: number[], indices: number[]) {
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const uv: number[] = [],
    colors: number[] = [],
    dry: number[] = [];
  const tint = new T.Color();
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i],
      z = vertices[i + 2];
    uv.push(x / 18, z / 18);
    tint.setHex(landColor(x, z));
    colors.push(tint.r, tint.g, tint.b);
    dry.push(dryCountry(x, z));
  }
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setAttribute("dry", new T.Float32BufferAttribute(dry, 1));
  return geo;
}

export async function drawCounty(city: City, group: T.Group) {
  const loader = new GLTFLoader();
  async function geometry(name: string) {
    const model = await loader.loadAsync(assetUrl("models/" + name + ".glb"));
    const mesh = model.scene.getObjectByProperty("isMesh", true) as T.Mesh;
    const geo = mesh.geometry;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }
  const textures = await countyTextures();
  const terrainTint = new T.MeshLambertMaterial({
    map: textures.scrubland,
    vertexColors: true,
  });
  terrainTint.onBeforeCompile = (shader) => {
    shader.uniforms.panorama = { value: textures.sky };
    shader.vertexShader =
      "attribute float dry; varying float vDry; varying vec3 vTerrain;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvDry=dry; vTerrain=(modelMatrix*vec4(position,1.)).xyz;",
      );
    shader.fragmentShader =
      "varying float vDry; varying vec3 vTerrain; uniform sampler2D panorama;\n" +
      panoramaSampling +
      "\n" +
      shader.fragmentShader
        .replace(
          "#include <map_fragment>",
          `
      // Warp the fine repeat with a second, broader rock/scrub pattern.
      vec3 broadPattern = texture2D(map, mat2(.78,-.62,.62,.78)*vMapUv*.19).rgb;
      vec3 scrub = texture2D(map, vMapUv + broadPattern.rb*.24).rgb;
      float eyeDistance = length(vTerrain-cameraPosition);
      scrub = mix(scrub,broadPattern,.24+.50*smoothstep(55.,450.,eyeDistance));
      float grain = dot(scrub, vec3(.21,.72,.07));
      vec3 sand = vec3(.34 + .98 * grain);
      vec3 surfaceNormal = normalize(cross(dFdx(vTerrain),dFdy(vTerrain)));
      float exposure = smoothstep(.18,.65,length(surfaceNormal.xz))
                     * (1.-smoothstep(460.,1300.,eyeDistance));
      // Eroded beds follow the hillside; the gently tilted layers pinch
      // and thicken around outcropping rock instead of striping the flats.
      float bed = vTerrain.y + .018*vTerrain.x + 2.4*sin(vTerrain.z*.014)
                + 1.2*sin(vTerrain.x*.027) + 1.7*broadPattern.r;
      float shelf = .5+.5*sin(bed*.88+.82*sin(bed*.36));
      float seam = smoothstep(.68,.95,shelf)*(1.-smoothstep(.15,1.2,fwidth(bed)));
      sand *= mix(vec3(1.),vec3(.99,.81,.69)*(1.-.23*seam),exposure);
      diffuseColor.rgb *= mix(scrub, sand, vDry);
    `,
        )
        .replace(
          "#include <fog_fragment>",
          `
      vec3 sight=vTerrain-cameraPosition;
      float distanceToEye=length(sight);
      float haze=1.-exp(-pow(fogDensity * distanceToEye,2.));
      vec3 air=fogColor;
      if (distanceToEye>700.) {
        vec3 horizon=samplePanorama(panorama,normalize(vec3(sight.x,.012*length(sight.xz),sight.z)));
        air=mix(air,horizon,smoothstep(700.,2800.,distanceToEye)*.88);
      }
      gl_FragColor.rgb=mix(gl_FragColor.rgb,air,haze);
    `,
        );
  };
  const normal = new T.Vector3(),
    sun = coastSun;
  group.add(countySky(textures.sky));
  countyBuildings(group, city.boxes.filter(isCountyPiece));
  const [vehicle, lamp, rock] = await Promise.all([
    loadFleet(textures.sky),
    geometry("lamp"),
    geometry("outcrop"),
  ]);
  const terrainCells = new Map<string, T.BufferGeometry[]>();
  for (const box of city.boxes) {
    if (box.kind !== "ground") continue;
    const [cx, cy, cz] = box.p,
      [w, h, d] = box.s;
    const vertices = box.mesh?.vertices ?? [
      cx - w / 2,
      cy + h / 2,
      cz - d / 2,
      cx - w / 2,
      cy + h / 2,
      cz + d / 2,
      cx + w / 2,
      cy + h / 2,
      cz + d / 2,
      cx + w / 2,
      cy + h / 2,
      cz - d / 2,
    ];
    const geo = groundGeometry(
      vertices,
      box.mesh?.indices ?? [0, 1, 2, 0, 2, 3],
    );
    const cell = Math.floor(cx / 480) + "," + Math.floor(cz / 480);
    if (!terrainCells.has(cell)) terrainCells.set(cell, []);
    terrainCells.get(cell)!.push(geo);
  }
  for (const tiles of terrainCells.values()) {
    const hill = new T.Mesh(mergeGeometries(tiles)!, terrainTint);
    hill.receiveShadow = true;
    group.add(hill);
    tiles.forEach((tile) => tile.dispose());
  }
  const ridge = outerRidges(city.bounds);
  group.add(
    new T.Mesh(groundGeometry(ridge.vertices, ridge.indices), terrainTint),
  );
  const cars = countyCars().map((c, i) => {
    const m = vehicle(
      c.kind,
      c.kind === "taxi" ? 1 : c.kind === "delivery" ? 3 : i,
      c.patrol,
    );
    m.rotation.y = c.yaw;
    m.position.fromArray(c.p);
    group.add(m);
    return m;
  });
  drawRegionalLandscape(group, city);
  const lightPositions = drawCountyRoads(group, city.plan.streets, textures);
  const rng = randomSeed("county-landscape");
  const matrix = new T.Object3D();
  const lamps = new T.InstancedMesh(
    lamp,
    new T.MeshLambertMaterial({ color: 0x647786 }),
    lightPositions.length,
  );
  lightPositions.forEach((p, i) => {
    matrix.position.fromArray(p);
    matrix.updateMatrix();
    lamps.setMatrixAt(i, matrix.matrix);
  });
  lamps.castShadow = true;
  group.add(lamps);
  const trunkGeo = new T.CylinderGeometry(0.14, 0.24, 3.3, 8);
  const trunkMat = new T.MeshBasicMaterial({ color: 0x776d65 });
  const crown = new T.SphereGeometry(1, 14, 9),
    colors = [];
  const vertex = crown.getAttribute("position"),
    leaf = new T.Color();
  for (let i = 0; i < vertex.count; i++) {
    normal.fromBufferAttribute(crown.attributes.normal, i);
    const { x, y, z } = normal;
    const radius =
      1 +
      0.13 * Math.sin(5 * x + 2 * z) * Math.cos(5 * y - 3 * z) +
      0.08 * Math.sin(7 * z - 4 * y);
    vertex.setXYZ(i, x * radius, y * radius, z * radius);
    const light = normal.dot(sun) + 0.12 * Math.sin(x * 7 + y * 4);
    leaf.setHex(light > 0.55 ? 0x89a476 : light > -0.12 ? 0x618367 : 0x48695d);
    colors.push(leaf.r, leaf.g, leaf.b);
  }
  crown.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  const leafMat = new T.MeshBasicMaterial({ vertexColors: true });
  const cells = new Map<string, typeof city.boxes>();
  for (const tree of city.boxes.filter((b) => b.kind === "county-tree")) {
    const cell = Math.floor(tree.p[0] / 96) + "," + Math.floor(tree.p[2] / 96);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push(tree);
  }
  const palm = palmGeometry(),
    distantPalm = palmGeometry(true),
    palmMat = new T.MeshLambertMaterial({
      vertexColors: true,
      side: T.DoubleSide,
    });
  for (const trees of cells.values()) {
    const palms = trees.filter(
      (b) => Math.sin(b.p[0] * 2.7 + b.p[2] * 0.32) > -0.45,
    );
    if (palms.length) {
      const instances = new T.InstancedMesh(palm, palmMat, palms.length);
      const silhouette = new T.InstancedMesh(
        distantPalm,
        palmMat,
        palms.length,
      );
      for (const [i, tree] of palms.entries()) {
        matrix.position.set(tree.p[0], 0, tree.p[2]);
        matrix.rotation.set(0, rng() * Math.PI * 2, 0);
        matrix.scale.setScalar(0.86 + rng() * 0.36);
        matrix.updateMatrix();
        instances.setMatrixAt(i, matrix.matrix);
        silhouette.setMatrixAt(i, matrix.matrix);
      }
      instances.castShadow = true;
      instances.computeBoundingSphere();
      const { x, z } = instances.boundingSphere!.center;
      instances.userData.detailCenter = silhouette.userData.farCenter = [x, z];
      instances.userData.detailRange = silhouette.userData.detailRange = 142;
      group.add(instances, silhouette);
    }
    const broadleaf = trees.filter((b) => !palms.includes(b));
    if (!broadleaf.length) continue;
    const trunks = new T.InstancedMesh(trunkGeo, trunkMat, broadleaf.length),
      leaves = new T.InstancedMesh(crown, leafMat, broadleaf.length);
    broadleaf.forEach(({ p }, i) => {
      matrix.position.set(p[0], 1.65, p[2]);
      matrix.scale.set(1, 1, 1);
      matrix.updateMatrix();
      trunks.setMatrixAt(i, matrix.matrix);
      const slim = rng() > 0.65;
      matrix.position.y = 4.15 + rng() * 0.75;
      matrix.scale.set(slim ? 1.4 : 2.2, slim ? 2.8 : 2.05, slim ? 1.45 : 2);
      matrix.rotation.y = rng() * 6.28;
      matrix.updateMatrix();
      leaves.setMatrixAt(i, matrix.matrix);
    });
    trunks.castShadow = leaves.castShadow = true;
    group.add(trunks, leaves);
  }
  const stoneMat = new T.MeshLambertMaterial({ color: 0x9e9b88 });
  for (let i = 0; i < 150;) {
    const x = (rng() - 0.5) * 1560,
      z = (rng() - 0.5) * 1560;
    if (terrainHeight(x, z) < 1 || !clearOfLotsAndRoads(city.plan, x, z))
      continue;
    const stone = new T.Mesh(rock, stoneMat);
    stone.position.set(x, terrainHeight(x, z) - 0.3, z);
    stone.rotation.y = rng() * Math.PI * 2;
    stone.scale.setScalar(
      (2 + rng() * 7) / rock.boundingBox!.getSize(new T.Vector3()).length(),
    );
    group.add(stone);
    i++;
  }
  for (const point of city.beacons) {
    const token = new T.Mesh(
      new T.OctahedronGeometry(0.6),
      inkMaterial("#dfa52b", 0.55),
    );
    token.position.fromArray(point);
    token.position.y += 1.4;
    group.add(token);
    token.name = "county-mark";
  }
  return cars;
}
