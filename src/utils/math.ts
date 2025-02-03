export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function lerp(start: number, end: number, t: number) {
  return start + t * (end - start);
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function toRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

export function toDegrees(radians: number) {
  return radians * (180 / Math.PI);
}
