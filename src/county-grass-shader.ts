// The three lattice corners share their sampled patches with the neighboring
// triangle. Their weights go to zero at the opposite edge, so no seam appears
// as a pixel crosses a cell; explicit gradients preserve the texture mip level.
export const countyGrassSampling = `
vec3 pastureHash(vec2 cell) {
  vec3 p = fract(cell.xyx * vec3(.1031,.1030,.0973));
  p += dot(p,p.yxz + 33.33);
  return fract((p.xxy + p.yzz) * p.zyx);
}
vec3 pasturePatch(sampler2D tex, vec2 uv, vec2 cell, vec2 dx, vec2 dy) {
  vec3 random = pastureHash(cell);
  vec2 axis = random.z < .5 ? vec2(1.,0.) : vec2(0.,1.);
  axis *= random.x < .5 ? -1. : 1.;
  mat2 turn = mat2(axis,vec2(-axis.y,axis.x));
  return textureGrad(tex,turn*uv + random.xy,turn*dx,turn*dy).rgb;
}
vec3 pastureGround(sampler2D tex, vec2 uv) {
  vec2 grid = mat2(1.,0.,-.57735,1.1547)*uv;
  vec2 cell = floor(grid), f = fract(grid);
  float upper = step(1., f.x + f.y);
  vec2 corner = vec2(upper);
  vec3 weights = vec3(abs(1.-f.x-f.y), abs(f.x-upper), abs(f.y-upper));
  weights *= weights;
  weights /= dot(weights,vec3(1.));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec3 grass = weights.x * pasturePatch(tex,uv,cell+corner,dx,dy)
             + weights.y * pasturePatch(tex,uv,cell+vec2(1.-upper,upper),dx,dy)
             + weights.z * pasturePatch(tex,uv,cell+vec2(upper,1.-upper),dx,dy);
  return grass;
}
float pasturePatches(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.-2.*f);
  return mix(mix(pastureHash(i).x,pastureHash(i+vec2(1.,0.)).x,f.x),
             mix(pastureHash(i+vec2(0.,1.)).x,pastureHash(i+1.).x,f.x),f.y);
}
`;

export const countyGrassSurface = `
      vec3 scrub = pastureGround(map,vMapUv);
      vec2 ground = vTerrain.xz;
      float field = pasturePatches(ground / 119.);
      float tussocks = pasturePatches(mat2(.8,-.6,.6,.8)*ground/32. + field);
      float cover = smoothstep(.23,.78,field*.66 + tussocks*.34);
      vec3 broadPattern = vec3(mix(.14,.44,tussocks));
      // This color field spans grass hummocks and entire meadows. It persists
      // when grazing angles and distance filter the individual blades away.
      scrub *= mix(vec3(1.15,1.01,.84),vec3(.87,1.07,.95),cover);
      float eyeDistance = length(vTerrain-cameraPosition);
`;
