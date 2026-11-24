import { clamp } from '../core/math';
import type { BeatSample } from '../race/Groove';
import type { Race } from '../race/Race';
import type { Ship } from '../race/Ship';
import type { Track } from '../track/Track';
import { byId } from './dom';
import { formatTime } from './format';
import { Minimap } from './Minimap';

const SLOW_REFRESH_EVERY = 8;

/** Affichage tête haute (DOM) : position, tour, chrono, vitesse, bouclier, arme, messages. */
export class Hud {
  private readonly root = byId('hud');
  private readonly pos = byId('pos');
  private readonly lap = byId('lap');
  private readonly time = byId('time');
  private readonly laps = byId('laps');
  private readonly best = byId('best');
  private readonly speed = byId('speed');
  private readonly speedBar = byId('speedbar');
  private readonly energyBar = byId('energybar');
  private readonly energyText = byId('energyTxt');
  private readonly item = byId('item');
  private readonly wrongWay = byId('wrong');
  private readonly msg = byId('msg');
  private readonly sub = byId('sub');
  private minimap: Minimap;
  private msgTimer = 0;
  private subTimer = 0;
  private frame = 0;
  private readonly beatDots: HTMLElement[];
  private readonly streakLabel: HTMLElement;
  private lastDot = -1;

  constructor(race: Race) {
    this.minimap = new Minimap(byId<HTMLCanvasElement>('minimap'), race.track);
    const beat = document.createElement('div');
    beat.id = 'beat';
    beat.innerHTML = '<i class="down"></i><i></i><i></i><i></i><b></b>';
    this.root.appendChild(beat);
    this.beatDots = [...beat.querySelectorAll('i')];
    this.streakLabel = beat.querySelector('b')!;
  }

  /** Indicateur de rythme : le point du temps en cours s'allume au début du temps ; la série s'affiche. */
  beat(sample: BeatSample | null, streak: number): void {
    const on = sample ? sample.beats - Math.floor(sample.beats) < 0.22 : false;
    const dot = sample ? Math.floor(sample.inBar + 1e-6) % 4 : -1;
    const key = on ? dot : -1;
    if (key !== this.lastDot) {
      this.beatDots.forEach((d, i) => d.classList.toggle('on', i === key));
      this.lastDot = key;
    }
    this.streakLabel.textContent = streak > 1 ? `×${streak}` : '';
    this.streakLabel.classList.toggle('show', streak > 1);
  }

  /** Nouveau circuit : on redessine la mini-carte. */
  setTrack(track: Track): void {
    this.minimap = new Minimap(byId<HTMLCanvasElement>('minimap'), track);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  message(text: string, duration = 1.2): void {
    this.msg.textContent = text;
    this.msg.classList.add('show');
    this.msgTimer = duration;
  }

  subtitle(text: string, duration = 1.5): void {
    this.sub.textContent = text;
    this.sub.classList.add('show');
    this.subTimer = duration;
  }

  /** Fait expirer les messages (temps de jeu, donc figé en pause). */
  tick(dt: number): void {
    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) this.msg.classList.remove('show');
    if (this.subTimer > 0 && (this.subTimer -= dt) <= 0) this.sub.classList.remove('show');
  }

  /**
   * Dernière valeur écrite par élément et par propriété : on ne touche au DOM que si l'affichage
   * change (chaque écriture, même identique, coûte un recalcul de style, voire de mise en page).
   */
  private readonly shown = new Map<HTMLElement, Record<string, string>>();

  private put(el: HTMLElement, kind: 'html' | 'text' | 'width' | 'display' | 'low', value: string): void {
    let last = this.shown.get(el);
    if (!last) this.shown.set(el, (last = {}));
    if (last[kind] === value) return;
    last[kind] = value;
    if (kind === 'html') el.innerHTML = value;
    else if (kind === 'text') el.textContent = value;
    else if (kind === 'width') el.style.width = value;
    else if (kind === 'display') el.style.display = value;
    else el.classList.toggle('low', value === '1');
  }

  update(race: Race, ship: Ship): void {
    const counting = race.phase === 'countdown';
    this.put(this.pos, 'html', `${race.position(ship)}<small>/${race.ships.length}</small>`);
    this.put(this.lap, 'html', `${race.currentLap(ship)}<small>/${race.laps}</small>`);
    this.put(this.time, 'text', formatTime(counting ? 0 : ship.finished ? ship.finishTime : race.time));

    if (this.frame++ % SLOW_REFRESH_EVERY === 0) {
      const current = ship.finished ? '' : `<div>T${race.currentLap(ship)} ${formatTime(counting ? 0 : race.time - ship.lapStart)}</div>`;
      this.put(this.laps, 'html', ship.lapTimes.map((t, i) => `<div>T${i + 1} ${formatTime(t)}</div>`).join('') + current);
      this.put(this.best, 'text', ship.lapTimes.length ? 'MEILLEUR ' + formatTime(Math.min(...ship.lapTimes)) : '');
      this.minimap.draw(race.ships);
    }

    this.put(this.speed, 'html', `${Math.round(ship.speed * 3.6)}<span>KM/H</span>`);
    // largeurs arrondies au demi-pour-cent : invisible à l'œil, et la plupart des images n'écrivent rien
    this.put(this.speedBar, 'width', `${Math.round(clamp((ship.speed / (ship.perf.vmax * 1.3)) * 100, 0, 100) * 2) / 2}%`);
    const energy = Math.max(0, ship.energy);
    this.put(this.energyBar, 'width', `${Math.round(energy * 2) / 2}%`);
    this.put(this.energyBar, 'low', energy < 30 ? '1' : '0');
    this.put(this.energyText, 'text', `${Math.round(energy)}%`);
    this.put(this.item, 'text', ship.item ?? '—');
    const wrong = race.phase === 'racing' && !ship.dead && Math.cos(ship.psi) < -0.2 && ship.u > 5;
    this.put(this.wrongWay, 'display', wrong ? 'block' : 'none');
  }
}
