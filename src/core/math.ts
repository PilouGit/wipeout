export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** Ramène un angle dans ]-π, π]. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Facteur de lissage exponentiel indépendant du framerate. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
