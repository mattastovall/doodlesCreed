// Presentation only: never feeds springs or recoil recovery back into raw look.
const damp = (rate: number, dt: number) => Math.exp(-rate * dt);
export const sensitivityScale = (fov: number, hip: number) =>
  Math.tan((fov * Math.PI) / 360) / Math.tan((hip * Math.PI) / 360);
// Speed at the top of each camera ramp (m/s), followed by its maximum FOV gain.
const speedLens = {
  run: [13.2, 6],
  slide: [20, 9],
  wall: [17, 8],
  air: [23, 9],
  swing: [34, 14],
  cockpit: [38, 10],
  chase: [38, 16],
} as const;
export type LensMode = keyof typeof speedLens;
export class ViewMotion {
  private speedOffset = 0;
  ads = 0;
  fov = 82;
  phase = 0;
  bob = 0;
  swayX = 0;
  swayY = 0;
  kick = 0;
  fireWeight = 0;
  eyeY = 0;
  private heightOffset = 0;
  private lastEye: number | undefined;
  private revision = -1;
  private amplitude = 0;
  trackHeight(
    eye: number,
    grounded: boolean,
    revision: number,
    dt: number,
    continuousDelta?: number,
  ) {
    if (
      this.lastEye === undefined ||
      revision !== this.revision ||
      Math.abs(eye - this.lastEye) > 1
    ) {
      this.heightOffset = 0;
    } else {
      // Absorb collision steps in either direction; airborne motion stays immediate.
      this.heightOffset +=
        this.lastEye -
        eye +
        (continuousDelta ?? (grounded ? 0 : eye - this.lastEye));
      this.heightOffset = Math.max(-1.5, Math.min(1.5, this.heightOffset));
    }
    this.heightOffset *= damp(22, dt);
    this.eyeY = eye + this.heightOffset;
    this.lastEye = eye;
    this.revision = revision;
  }
  look(x: number, y: number) {
    this.swayX = Math.max(-0.012, Math.min(0.012, this.swayX - x * 0.00012));
    this.swayY = Math.max(-0.009, Math.min(0.009, this.swayY + y * 0.0001));
  }
  shot(weapon: number) {
    this.kick = Math.min(1.15, this.kick + [0.6, 0.95, 0.5, 1.05][weapon]);
    this.fireWeight = 1;
  }
  update(
    dt: number,
    aiming: boolean,
    speed: number,
    grounded: boolean,
    reduced: boolean,
    hipFov: number,
    adsFov = 57,
    mode: LensMode = grounded ? "run" : "air",
  ) {
    this.ads += (Number(aiming) - this.ads) * (1 - damp(22, dt));
    this.fireWeight *= damp(7, dt);
    this.kick *= damp(20, dt);
    this.swayX *= damp(28 + this.ads * 35, dt);
    this.swayY *= damp(28 + this.ads * 35, dt);
    // Integrated phase cannot jump at the walk/sprint threshold or on a shot.
    this.phase += speed * 1.55 * dt;
    this.amplitude +=
      ((grounded ? Math.min(speed * 0.0015, 0.018) : 0) - this.amplitude) *
      (1 - damp(18, dt));
    this.bob =
      Math.sin(this.phase) *
      this.amplitude *
      (1 - this.ads * 0.85) *
      (1 - this.fireWeight * 0.7) *
      Number(!reduced);
    const [fullSpeed, gain] = speedLens[mode];
    const t = Math.min(1, Math.abs(speed) / fullSpeed);
    const target = gain * t * t * (3 - 2 * t);
    this.speedOffset = reduced
      ? 0
      : this.speedOffset +
        (target - this.speedOffset) *
          (1 - damp(target > this.speedOffset ? 5 : 7, dt));
    // The cockpit uses a longer lens so the windscreen frames the road.
    // Scale the projection, preserving the player's chosen base field of view.
    const base =
      mode === "cockpit"
        ? (360 / Math.PI) * Math.atan(0.72 * Math.tan((hipFov * Math.PI) / 360))
        : hipFov;
    this.fov =
      base + (adsFov - base) * this.ads + this.speedOffset * (1 - this.ads);
  }
}
