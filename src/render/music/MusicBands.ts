import type { MusicFeatures } from '../../audio/imuse/MusicPulse';

/** Lissage asymétrique : montée nerveuse, descente fluide (taux en 1/s). */
export function follow(current: number, target: number, dt: number, attack: number, release: number): number {
  const rate = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

/**
 * Spectre « musical » à six bandes, du grave à l'aigu, tiré des enveloppes iMUSE :
 * kick, basse, caisse claire, nappe, mélodie, charleston.
 */
export const SPECTRUM_SIZE = 6;
/** Crête minimale du contrôle de gain : en dessous, un son reste faible (pas de bruit amplifié). */
const PEAK_FLOOR = 0.3;
/** Décroissance de la crête (par seconde) : le gain remonte en quelques secondes après un passage fort. */
const PEAK_DECAY = 0.08;

/**
 * Réduit l'état de la musique en grandeurs prêtes pour l'animation : graves / médiums / aigus
 * lissés, spectre à 6 bandes, et détection des « drops » (graves forts) et des accalmies.
 */
export class MusicBands {
  bass = 0;
  mid = 0;
  high = 0;
  /** Moyenne lente des graves (≈ 2 s) : distingue un passage chargé d'un coup isolé. */
  bassAverage = 0;
  /** Lissé du spectre, même ordre que SPECTRUM_SIZE. */
  readonly spectrum = new Float32Array(SPECTRUM_SIZE);
  /**
   * Spectre normalisé par un contrôle automatique de gain (crête glissante par bande) :
   * une bande jouée doucement bouge autant qu'une bande forte, et l'amplitude reste homogène
   * d'une section à l'autre.
   */
  readonly spectrumNorm = new Float32Array(SPECTRUM_SIZE);
  /** Graves / médiums / aigus tirés du spectre normalisé (0..1). */
  bassN = 0;
  midN = 0;
  highN = 0;
  private readonly peak = new Float32Array(SPECTRUM_SIZE).fill(PEAK_FLOOR);
  /** Vrai sur l'image où les graves franchissent le seuil de drop. */
  drop = false;
  /** Secondes écoulées depuis que les graves sont calmes. */
  calmFor = 0;
  energy = 0;
  features!: MusicFeatures;
  private wasAbove = false;

  update(f: MusicFeatures, dt: number): void {
    this.features = f;
    const e = f.env;
    const level = f.level > 0 ? 1 : 0;
    const raw = [e.kick, e.bass, e.snare, e.pad, e.lead, e.hat];
    for (let i = 0; i < SPECTRUM_SIZE; i++) {
      const r = raw[i] * level;
      this.spectrum[i] = follow(this.spectrum[i], r, dt, 30, 4);
      this.peak[i] = Math.max(r, PEAK_FLOOR, this.peak[i] - PEAK_DECAY * dt);
      this.spectrumNorm[i] = follow(this.spectrumNorm[i], Math.min(1, r / this.peak[i]), dt, 30, 3.2);
    }
    const n = this.spectrumNorm;
    this.bassN = Math.max(n[0], n[1]);
    this.midN = Math.max(n[2], n[3] * 0.8, n[4]);
    this.highN = Math.max(n[5], n[4] * 0.6);

    const bass = Math.max(e.kick, e.bass * 0.9, e.impact) * level;
    const mid = Math.max(e.snare, e.lead * 0.9, e.pad * 0.7) * level;
    const high = Math.max(e.hat, e.lead * (f.leadNote >= 76 ? 0.8 : 0.3)) * level;
    this.bass = follow(this.bass, bass, dt, 35, 5);
    this.mid = follow(this.mid, mid, dt, 25, 4);
    this.high = follow(this.high, high, dt, 40, 8);
    this.bassAverage = follow(this.bassAverage, bass, dt, 0.6, 0.5);
    this.energy = follow(this.energy, f.energy * level, dt, 2, 0.8);

    // drop : attaque grave forte dans un passage aux graves soutenus et à l'orchestration dense,
    // un kick accentué, ou un impact
    const onset = bass > 0.65;
    const above = (onset && this.bassAverage > 0.25 && this.energy > 0.45) || (bass > 0.95 && this.energy > 0.3) || e.impact > 0.7;
    this.drop = above && !this.wasAbove;
    this.wasAbove = above;
    this.calmFor = this.bassAverage < 0.18 ? this.calmFor + dt : 0;
  }
}
