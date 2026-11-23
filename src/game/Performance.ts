/**
 * Surveillance des performances : moyenne et pire image glissantes, et baisse automatique de
 * qualité par paliers quand le jeu ne tient pas la cadence. On ne remonte jamais en cours de partie
 * (pas d'oscillation) ; les premières secondes (compilation des shaders) ne comptent pas.
 *
 * Paliers : 0 pleine qualité · 1 ciel allégé, pas d'atmosphère des planètes · 2 bloom à demi-résolution ·
 * 3 définition réduite.
 */
export const MAX_QUALITY_DROP = 3;
/** Durée moyenne d'image (ms) au-delà de laquelle on baisse d'un palier (≈ 45 images/s). */
const SLOW_FRAME_MS = 22;
const WINDOW_S = 3;
const WARMUP_S = 5;
/** Après une baisse, on laisse le temps à la nouvelle qualité de faire ses preuves. */
const SETTLE_S = 4;

export class PerformanceMonitor {
  /** Palier de baisse de qualité courant (0 = pleine qualité). */
  drop = 0;
  /** Durée moyenne d'image sur la fenêtre (ms) et pire image (ms). */
  avgMs = 0;
  worstMs = 0;
  private readonly frames: number[] = [];
  private elapsed = 0;
  private settle = 0;

  constructor(private readonly onDrop: (level: number) => void, private readonly adaptive = true) {}

  /** À appeler à chaque image avec sa durée réelle (s). */
  frame(dt: number, hidden = false): void {
    if (dt <= 0 || hidden) return;
    this.elapsed += dt;
    this.settle = Math.max(0, this.settle - dt);
    // les images du démarrage ne comptent pas (sauf pour l'affichage tant qu'on n'a rien d'autre)
    if (this.elapsed < WARMUP_S) {
      this.avgMs = this.worstMs = dt * 1000;
      return;
    }
    this.frames.push(dt * 1000);
    let total = this.frames.reduce((a, b) => a + b, 0);
    while (total > WINDOW_S * 1000 && this.frames.length > 1) total -= this.frames.shift()!;
    this.avgMs = total / this.frames.length;
    this.worstMs = Math.max(...this.frames);
    if (!this.adaptive || this.settle > 0 || this.drop >= MAX_QUALITY_DROP) return;
    if (total >= WINDOW_S * 1000 * 0.9 && this.avgMs > SLOW_FRAME_MS) {
      this.drop++;
      this.settle = SETTLE_S;
      this.frames.length = 0;
      this.onDrop(this.drop);
    }
  }
}
