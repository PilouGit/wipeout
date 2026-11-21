import type { TouchState } from '../core/Input';

/** Course du doigt (px) pour un braquage complet. */
const STEER_RANGE = 60;
const STEER_DEADZONE = 0.08;

/**
 * Commandes tactiles en paysage.
 * - Moitié gauche : stick flottant (il apparaît sous le pouce), glisser à gauche / droite pour diriger.
 * - À droite : aérofreins gauche et droit, frein, arme. L'accélération est automatique.
 * - En haut : pause.
 * Plusieurs doigts à la fois (Pointer Events, un identifiant par doigt).
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly base: HTMLElement;
  private readonly fireLabel: HTMLElement;
  private steerPointer: number | null = null;
  private steerOrigin = 0;
  private lastItem: string | null | undefined;

  constructor(private readonly state: TouchState, actions: { fire(): void; pause(): void }) {
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div class="t-steer"><div class="t-base"><div class="t-knob"></div></div><span class="t-hint">◀ DIRIGER ▶</span></div>
      <button class="t-btn t-fire" data-k="fire"><span>ARME</span><b>—</b></button>
      <button class="t-btn t-brake" data-k="brake">FREIN</button>
      <button class="t-btn t-abl" data-k="abl">◀ AÉRO</button>
      <button class="t-btn t-abr" data-k="abr">AÉRO ▶</button>
      <button class="t-pause" data-k="pause">II</button>`;
    document.body.appendChild(root);
    const zone = root.querySelector<HTMLElement>('.t-steer')!;
    this.base = root.querySelector<HTMLElement>('.t-base')!;
    this.knob = root.querySelector<HTMLElement>('.t-knob')!;
    this.fireLabel = root.querySelector<HTMLElement>('.t-fire b')!;

    // direction : stick flottant
    zone.addEventListener('pointerdown', (e) => {
      if (this.steerPointer !== null) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.steerPointer = e.pointerId;
      this.steerOrigin = e.clientX;
      const r = zone.getBoundingClientRect();
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      zone.classList.add('active');
      this.setSteer(0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer) return;
      this.setSteer((e.clientX - this.steerOrigin) / STEER_RANGE);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = null;
      zone.classList.remove('active');
      this.setSteer(0);
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    // boutons maintenus
    const held: Record<string, Set<number>> = { brake: new Set(), abl: new Set(), abr: new Set() };
    const sync = () => {
      state.brake = held.brake.size ? 1 : 0;
      state.thrust = held.brake.size ? 0 : 1;
      state.airbrakeLeft = held.abl.size ? 1 : 0;
      state.airbrakeRight = held.abr.size ? 1 : 0;
    };
    root.querySelectorAll<HTMLButtonElement>('.t-btn, .t-pause').forEach((b) => {
      const k = b.dataset.k!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        if (k === 'fire') actions.fire();
        else if (k === 'pause') actions.pause();
        else held[k].add(e.pointerId);
        sync();
      });
      const up = (e: PointerEvent) => {
        b.classList.remove('down');
        held[k]?.delete(e.pointerId);
        sync();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
    // pas de menu contextuel sur appui long
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.visible = false;
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
    this.state.active = v;
    if (!v) this.reset();
  }

  /** Affiche l'arme disponible sur le bouton de tir. */
  update(item: string | null): void {
    if (item === this.lastItem) return;
    this.lastItem = item;
    this.fireLabel.textContent = item ?? '—';
    this.root.querySelector('.t-fire')!.classList.toggle('armed', item !== null);
  }

  private setSteer(v: number): void {
    const c = Math.max(-1, Math.min(1, v));
    this.state.steer = Math.abs(c) < STEER_DEADZONE ? 0 : c;
    this.knob.style.transform = `translate(calc(-50% + ${c * STEER_RANGE * 0.6}px), -50%)`;
  }

  private reset(): void {
    this.steerPointer = null;
    this.setSteer(0);
    Object.assign(this.state, { thrust: 1, brake: 0, airbrakeLeft: 0, airbrakeRight: 0 });
    this.root.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
  }
}
