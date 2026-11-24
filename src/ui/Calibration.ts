import type { AudioEngine } from '../audio/AudioEngine';

/** Métronome de calibration : 120 BPM, 4 temps d'écoute puis des frappes. */
const INTERVAL = 0.5;
const CLICKS = 28;
const WARMUP = 4;
const TARGET_TAPS = 16;
/** Une frappe à plus de 200 ms d'un clic n'est pas une tentative (rien à voir avec le temps). */
const MAX_OFFSET = 0.2;

export interface CalibrationResult {
  /** Retard médian (s), positif = les frappes arrivent après le clic entendu. */
  readonly offset: number;
  /** Dispersion (écart absolu médian, s). */
  readonly spread: number;
  readonly taps: number;
}

/** Retard médian et dispersion d'une série d'écarts (s). null s'il y a trop peu de frappes. */
export function analyzeTaps(offsets: readonly number[], minTaps = 8): CalibrationResult | null {
  const valid = offsets.filter((o) => Math.abs(o) <= MAX_OFFSET);
  if (valid.length < minTaps) return null;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const offset = median(valid);
  return { offset, spread: median(valid.map((o) => Math.abs(o - offset))), taps: valid.length };
}

/**
 * Écran de calibration du rythme : un métronome, le joueur frappe sur le temps (Maj, Espace,
 * clic, toucher). Le retard médian de ses frappes sur ce que le jeu croit qu'il entend — casque
 * Bluetooth, téléviseur, temps de réaction — devient le retard calibré, appliqué au jugement des
 * actions rythmiques et à la synchro de la musique. On mesure avec exactement la même horloge que
 * celle qui juge en course : ce qui est calibré, c'est le jeu tel qu'il sera joué.
 */
export class Calibration {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly result: HTMLElement;
  private readonly accept: HTMLButtonElement;
  private start = 0;
  private offsets: number[] = [];
  private measured: CalibrationResult | null = null;
  private timer = 0;
  private open = false;

  constructor(
    private readonly audio: AudioEngine,
    private readonly hooks: { onOpen(): void; onClose(): void },
  ) {
    const root = (this.root = document.getElementById('calib')!);
    this.count = root.querySelector('.calib-count')!;
    this.result = root.querySelector('.calib-result')!;
    this.accept = root.querySelector('#calibAccept')!;
    document.getElementById('calibBtn')!.addEventListener('click', () => this.show());
    root.querySelector('#calibRetry')!.addEventListener('click', () => this.run());
    root.querySelector('#calibCancel')!.addEventListener('click', () => this.hide());
    root.querySelector('#calibReset')!.addEventListener('click', () => {
      this.audio.calibration = 0;
      this.hide();
    });
    this.accept.addEventListener('click', () => {
      if (this.measured) this.audio.calibration = this.measured.offset;
      this.hide();
    });
    root.querySelector('.calib-pad')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.tap((e as PointerEvent).timeStamp);
    });
    // pendant la calibration, les touches ne vont pas au jeu (capture sur window)
    addEventListener(
      'keydown',
      (e) => {
        if (!this.open) return;
        e.stopImmediatePropagation();
        if (e.code === 'Escape') this.hide();
        else if (!e.repeat && (e.key === 'Shift' || e.code === 'Space' || e.code === 'Enter')) {
          e.preventDefault();
          this.tap(e.timeStamp);
        }
      },
      { capture: true },
    );
    addEventListener('keyup', (e) => this.open && e.stopImmediatePropagation(), { capture: true });
    this.refreshLabel();
  }

  private show(): void {
    this.audio.init();
    this.open = true;
    this.root.classList.remove('hidden');
    this.hooks.onOpen();
    this.run();
  }

  private hide(): void {
    this.open = false;
    clearInterval(this.timer);
    this.root.classList.add('hidden');
    this.hooks.onClose();
    this.refreshLabel();
  }

  private run(): void {
    const ctx = this.audio.context;
    if (!ctx) return;
    clearInterval(this.timer);
    this.offsets = [];
    this.measured = null;
    this.accept.disabled = true;
    this.result.textContent = 'Écoutez quatre clics, puis frappez sur chaque clic.';
    this.start = ctx.currentTime + 0.6;
    for (let k = 0; k < CLICKS; k++) this.audio.click(this.start + k * INTERVAL, k % 4 === 0);
    this.updateCount();
    // fin de la série : bilan (même si le joueur n'a pas frappé)
    this.timer = window.setInterval(() => {
      if (ctx.currentTime > this.start + CLICKS * INTERVAL + 0.3) this.finish();
    }, 100);
  }

  /** Une frappe : instant de l'événement ramené à l'horloge « entendue » du jeu, sans calibration. */
  private tap(eventTime: number): void {
    if (!this.open || this.measured) return;
    const heard = this.audio.rawHeardTime() - Math.max(0, performance.now() - eventTime) / 1000;
    const k = Math.round((heard - this.start) / INTERVAL);
    if (k < WARMUP || k >= CLICKS) return;
    this.offsets.push(heard - (this.start + k * INTERVAL));
    this.updateCount();
    if (this.offsets.filter((o) => Math.abs(o) <= MAX_OFFSET).length >= TARGET_TAPS) this.finish();
  }

  private updateCount(): void {
    const n = this.offsets.filter((o) => Math.abs(o) <= MAX_OFFSET).length;
    this.count.textContent = `${n} / ${TARGET_TAPS}`;
  }

  private finish(): void {
    if (this.measured || !this.open) return;
    clearInterval(this.timer);
    const r = analyzeTaps(this.offsets);
    if (!r) {
      this.result.textContent = 'Pas assez de frappes sur le temps. Recommencez.';
      return;
    }
    this.measured = r;
    this.accept.disabled = false;
    const ms = (s: number) => Math.round(s * 1000);
    const steady = r.spread < 0.03 ? 'très régulier' : r.spread < 0.06 ? 'régulier' : 'irrégulier : recommencez si possible';
    this.result.textContent = `Retard mesuré : ${ms(r.offset)} ms (${steady}, ±${ms(r.spread)} ms). Actuel : ${ms(this.audio.calibration)} ms.`;
  }

  private refreshLabel(): void {
    const el = document.getElementById('calibValue');
    if (el) el.textContent = `${Math.round(this.audio.calibration * 1000)} ms`;
  }
}
