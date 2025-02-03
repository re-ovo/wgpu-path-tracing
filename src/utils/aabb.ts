import { vec3, Vec3 } from 'wgpu-matrix';

type AxisX = 0;
type AxisY = 1;
type AxisZ = 2;
export type Axis = AxisX | AxisY | AxisZ;

export default class AABB {
  min: Vec3;
  max: Vec3;

  constructor(min: Vec3, max: Vec3) {
    this.min = min;
    this.max = max;
  }

  merge(other: AABB): AABB {
    return new AABB(
      vec3.create(
        Math.min(this.min[0], other.min[0]),
        Math.min(this.min[1], other.min[1]),
        Math.min(this.min[2], other.min[2]),
      ),
      vec3.create(
        Math.max(this.max[0], other.max[0]),
        Math.max(this.max[1], other.max[1]),
        Math.max(this.max[2], other.max[2]),
      ),
    );
  }

  expand(point: Vec3): void {
    this.min = vec3.create(
      Math.min(this.min[0], point[0]),
      Math.min(this.min[1], point[1]),
      Math.min(this.min[2], point[2]),
    );
    this.max = vec3.create(
      Math.max(this.max[0], point[0]),
      Math.max(this.max[1], point[1]),
      Math.max(this.max[2], point[2]),
    );
  }

  getSurfaceArea(): number {
    const dx = this.max[0] - this.min[0];
    const dy = this.max[1] - this.min[1];
    const dz = this.max[2] - this.min[2];
    return 2.0 * (dx * dy + dy * dz + dz * dx);
  }

  getMaxExtentAxis(): Axis {
    const axisXLength = this.max[0] - this.min[0];
    const axisYLength = this.max[1] - this.min[1];
    const axisZLength = this.max[2] - this.min[2];

    if (axisXLength > axisYLength && axisXLength > axisZLength) {
      return 0;
    }

    if (axisYLength > axisXLength && axisYLength > axisZLength) {
      return 1;
    }

    return 2;
  }
}
