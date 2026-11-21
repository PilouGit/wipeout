export type PadType = 'boost' | 'item';

export interface Pad {
  readonly id: number;
  /** Abscisse sur la piste (dans [0, length[). */
  readonly s: number;
  readonly x: number;
  readonly type: PadType;
}

export const PAD_TRIGGER_HALF_LENGTH = 3.6;
export const PAD_TRIGGER_HALF_WIDTH = 2.3;

/** [fraction du tour, décalage latéral] */
const BOOST_LAYOUT: readonly (readonly [number, number])[] = [
  [0.05, 0], [0.13, -5], [0.24, 5], [0.36, 0], [0.47, -6], [0.58, 6], [0.69, 0], [0.8, -5], [0.9, 5],
];
const ITEM_ROWS: readonly number[] = [0.18, 0.42, 0.63, 0.85];
const ITEM_LANES: readonly number[] = [-7, 0, 7];

export function createPads(trackLength: number): Pad[] {
  const pads: Pad[] = [];
  for (const [frac, x] of BOOST_LAYOUT) pads.push({ id: pads.length, s: trackLength * frac, x, type: 'boost' });
  for (const frac of ITEM_ROWS) {
    for (const x of ITEM_LANES) pads.push({ id: pads.length, s: trackLength * frac, x, type: 'item' });
  }
  return pads;
}
