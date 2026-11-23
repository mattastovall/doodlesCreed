import * as T from "three";
import model from "./models/fist.json";

function bytes(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function unpack(data: typeof model.view) {
  const geometry = new T.BufferGeometry();
  const points = new Int16Array(bytes(data.points).buffer);
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      Float32Array.from(points, (p) => p / 100000),
      3,
    ),
  );
  geometry.setAttribute(
    "cavity",
    new T.Uint8BufferAttribute(bytes(data.shade), 1, true),
  );
  geometry.setIndex(
    new T.Uint16BufferAttribute(
      new Uint16Array(bytes(data.triangles).buffer),
      1,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
}
let view: T.BufferGeometry, actor: T.BufferGeometry;
export function handMesh(side: number, material: T.Material, closeUp = false) {
  const template = closeUp
    ? (view ??= unpack(model.view))
    : (actor ??= unpack(model.actor));
  const mesh = new T.Mesh(template.clone(), material);
  mesh.scale.x = side;
  return mesh;
}

// A stable three-tone ramp keeps the finger joints legible as they move across the screen.
export function fistMaterial(sleeve = false) {
  const palette = sleeve
    ? ["#253483", "#485caf", "#7587c6"]
    : ["#717ba9", "#c4c7d7", "#f5f1e5"];
  return new T.ShaderMaterial({
    uniforms: {
      shadow: { value: new T.Color(palette[0]) },
      mid: { value: new T.Color(palette[1]) },
      light: { value: new T.Color(palette[2]) },
    },
    vertexShader: `varying vec3 n; varying float ao;
    ${sleeve ? "" : "attribute float cavity;"}
    void main(){n=normalMatrix*normal;ao=${sleeve ? "smoothstep(.87,.9,position.y)*.55" : "cavity"};gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 shadow,mid,light;varying vec3 n;varying float ao;
    void main(){
      vec3 normal=normalize(n);
      float value=dot(normal,normalize(vec3(-.63,.75,.25)))-ao*.85;
      vec3 c=mix(shadow,mid,smoothstep(-.44,-.13,value));
      c=mix(c,light,smoothstep(.24,.72,value));
      c*=1.-ao*.38;
      gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
    }`,
  });
}
