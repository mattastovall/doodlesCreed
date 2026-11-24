import { MathUtils } from "three";

// Render-rate presentation. No camera state participates in vehicle prediction.
export class CountyDriveCamera {
  heading = 0;
  boom = 6;
  bank = 0;
  vibration = 0;
  zoom = 0;
  private lastSpeed?: number;
  private pull = 0;
  private skid = 0;
  private phase = 0;

  reset() {
    this.lastSpeed = undefined;
  }
  update(
    dt: number,
    yaw: number,
    speed: number,
    slip: number,
    reduced: boolean,
  ) {
    if (this.lastSpeed === undefined || reduced) {
      this.heading = yaw;
      this.boom = 6;
      this.pull =
        this.skid =
        this.bank =
        this.zoom =
        this.vibration =
        this.phase =
          0;
      this.lastSpeed = speed;
      if (reduced) return;
    }
    const acceleration = (speed - this.lastSpeed) / Math.max(dt, 1 / 240);
    this.lastSpeed = speed;
    this.pull = MathUtils.damp(
      this.pull,
      MathUtils.clamp(acceleration / 9, -1, 1),
      5,
      dt,
    );
    const pace = MathUtils.smoothstep(Math.abs(speed), 2, 50);
    this.skid = MathUtils.damp(
      this.skid,
      MathUtils.smoothstep(Math.abs(slip), 0.12, 0.72) *
        MathUtils.smoothstep(speed, 3, 16),
      7,
      dt,
    );
    const target = yaw - MathUtils.clamp(slip * 0.86, -0.68, 0.68);
    const angle = Math.atan2(
      Math.sin(target - this.heading),
      Math.cos(target - this.heading),
    );
    this.heading += angle * (1 - Math.exp(-(8 - 4 * this.skid) * dt));
    this.boom = MathUtils.damp(
      this.boom,
      5.5 + 1.9 * pace + 0.8 * this.pull + 0.75 * this.skid,
      5,
      dt,
    );
    this.bank = MathUtils.damp(
      this.bank,
      MathUtils.clamp(slip * 0.073, -0.05, 0.05),
      5,
      dt,
    );
    this.zoom = this.pull * 2.5 + this.skid * 3;
    this.phase += dt * (23 + 8 * pace);
    this.vibration =
      this.skid *
      (0.025 * Math.sin(this.phase) + 0.011 * Math.sin(this.phase * 1.71));
  }
}
