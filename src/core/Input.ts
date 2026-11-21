import type { ShipInput } from '../race/Ship';
import { clamp } from './math';
import { Emitter } from './Emitter';

/** Actions ponctuelles (déclenchées à l'appui). */
export interface InputActions extends Record<string, unknown> {
  fire: undefined;
  pause: undefined;
  mute: undefined;
  camera: undefined;
  restart: undefined;
  confirm: undefined;
  audioDebug: undefined;
}

/** Commandes continues écrites par les contrôles tactiles (actif seulement quand ils sont affichés). */
export interface TouchState {
  active: boolean;
  steer: number;
  thrust: number;
  brake: number;
  airbrakeLeft: number;
  airbrakeRight: number;
}

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F2']);
const STICK_DEADZONE = 0.15;

/**
 * Clavier + manette.
 * Les flèches utilisent `code` (position physique) ; les lettres utilisent `key`
 * pour que les aérofreins A/E fonctionnent en AZERTY comme en QWERTY (Q/E).
 */
export class Input {
  readonly actions = new Emitter<InputActions>();
  readonly touch: TouchState = { active: false, steer: 0, thrust: 1, brake: 0, airbrakeLeft: 0, airbrakeRight: 0 };
  private readonly codes = new Set<string>();
  private readonly letters = new Set<string>();
  private readonly prevButtons = new Map<number, boolean>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e));
    target.addEventListener('keyup', (e) => {
      this.codes.delete(e.code);
      this.letters.delete(e.key.toLowerCase());
    });
    target.addEventListener('blur', () => {
      this.codes.clear();
      this.letters.clear();
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.codes.add(e.code);
    const key = e.key.toLowerCase();
    this.letters.add(key);
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'ControlRight') this.actions.emit('fire', undefined);
    else if (e.code === 'Escape' || key === 'p') this.actions.emit('pause', undefined);
    else if (key === 'm') this.actions.emit('mute', undefined);
    else if (key === 'c') this.actions.emit('camera', undefined);
    else if (key === 'r') this.actions.emit('restart', undefined);
    else if (e.code === 'Enter') this.actions.emit('confirm', undefined);
    else if (e.code === 'F2') this.actions.emit('audioDebug', undefined);
  }

  /** Lit les commandes continues dans `out` et émet les actions manette (à appeler à chaque frame). */
  poll(out: ShipInput): void {
    let steer = (this.codes.has('ArrowRight') ? 1 : 0) - (this.codes.has('ArrowLeft') ? 1 : 0);
    let thrust = this.codes.has('ArrowUp') ? 1 : 0;
    let brake = this.codes.has('ArrowDown') ? 1 : 0;
    let abL = this.letters.has('a') || this.letters.has('q') ? 1 : 0;
    let abR = this.letters.has('e') ? 1 : 0;

    const pad = navigator.getGamepads?.().find((g) => g) ?? null;
    if (pad) {
      const b = (i: number) => pad.buttons[i]?.value ?? 0;
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > STICK_DEADZONE) steer = ax;
      thrust = Math.max(thrust, b(7), b(0));
      brake = Math.max(brake, b(6));
      abL = Math.max(abL, b(4));
      abR = Math.max(abR, b(5));
      if (this.pressed(2, b(2) > 0.5 || b(1) > 0.5)) this.actions.emit('fire', undefined);
      if (this.pressed(9, b(9) > 0.5)) this.actions.emit('pause', undefined);
    }

    const t = this.touch;
    if (t.active) {
      if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
      thrust = brake > 0 || t.brake > 0 ? 0 : Math.max(thrust, t.thrust);
      brake = Math.max(brake, t.brake);
      abL = Math.max(abL, t.airbrakeLeft);
      abR = Math.max(abR, t.airbrakeRight);
    }

    out.steer = clamp(steer, -1, 1);
    out.thrust = thrust;
    out.brake = brake;
    out.airbrakeLeft = abL;
    out.airbrakeRight = abR;
  }

  /** Détection de front montant d'un bouton de manette. */
  private pressed(id: number, down: boolean): boolean {
    const was = this.prevButtons.get(id) ?? false;
    this.prevButtons.set(id, down);
    return down && !was;
  }
}
