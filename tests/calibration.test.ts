import { describe, expect, it } from 'vitest';
import { analyzeTaps } from '../src/ui/Calibration';

describe('calibration du rythme', () => {
  it('retient le retard médian, insensible aux frappes égarées', () => {
    const taps = [0.118, 0.131, 0.124, 0.109, 0.127, 0.12, 0.115, 0.133, 0.122, 0.119, 0.4, -0.35, 0.03];
    const r = analyzeTaps(taps)!;
    expect(r.offset).toBeGreaterThan(0.115);
    expect(r.offset).toBeLessThan(0.125);
    // les frappes à plus de 200 ms ne comptent pas
    expect(r.taps).toBe(11);
    expect(r.spread).toBeLessThan(0.02);
  });

  it('refuse de conclure avec trop peu de frappes', () => {
    expect(analyzeTaps([0.1, 0.11, 0.09])).toBeNull();
  });
});
