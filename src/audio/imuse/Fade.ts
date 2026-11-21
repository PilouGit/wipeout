/** Fréquence de mise à jour des fondus (iMUSE : FdIntHandler à 60 Hz). */
export const FADE_HZ = 60;

/**
 * Fondu en arithmétique entière, comme FdFade d'iMUSE :
 *   slope = height / time ; slopeMod = height % time ; modOvfloCounter = 0
 * À chaque pas : val += slope, et le reste s'accumule jusqu'à déborder
 * (accumulateur de type Bresenham) — on arrive exactement sur la cible au dernier pas.
 */
export class Fade {
  readonly steps: number;
  private readonly slope: number;
  private readonly slopeMod: number;
  private readonly nudge: number;
  private modOvfloCounter = 0;
  private done = 0;
  private val: number;

  constructor(readonly sound: number, readonly param: string, from: number, readonly target: number, steps: number) {
    this.steps = Math.max(1, Math.round(steps));
    const height = Math.round(target) - Math.round(from);
    this.val = Math.round(from);
    this.slope = Math.trunc(height / this.steps);
    this.slopeMod = Math.abs(height % this.steps);
    this.nudge = Math.sign(height);
  }

  get value(): number {
    return this.val;
  }

  get finished(): boolean {
    return this.done >= this.steps;
  }

  /** Avance d'un pas de 1/60 s et retourne la nouvelle valeur. */
  step(): number {
    if (this.finished) return this.val;
    this.val += this.slope;
    this.modOvfloCounter += this.slopeMod;
    if (this.modOvfloCounter >= this.steps) {
      this.modOvfloCounter -= this.steps;
      this.val += this.nudge;
    }
    this.done++;
    return this.val;
  }
}
