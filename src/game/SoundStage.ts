import { Vector3, type PerspectiveCamera } from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import type { SfxName } from '../audio/spatial/Sfx';
import type { SourceState } from '../audio/spatial/WipeoutAudioEngine';
import { HOVER_HEIGHT } from '../config';
import type { Race } from '../race/Race';
import type { Ship } from '../race/Ship';
import { createFrame } from '../track/Track';

/** Distance au-delà de laquelle les bruitages des autres vaisseaux ne sont pas joués. */
const EARSHOT = 220;
const LOW_SHIELD = 25;
const ALERT_EVERY = 2.5;
const SCRAPE_EVERY = 0.07;

type MutableSource = { -readonly [K in keyof SourceState]: SourceState[K] };

/**
 * Pont entre la course et le moteur audio : construit à chaque image l'état des sources
 * (vaisseaux) et de l'auditeur (caméra), et traduit les évènements de course en bruitages positionnés.
 */
export class SoundStage {
  private readonly sources: MutableSource[];
  private readonly listener: { position: Vector3; forward: Vector3; up: Vector3; s: number };
  private readonly frame = createFrame();
  private alertTimer = 0;
  private scrapeTimer = 0;

  constructor(private readonly audio: AudioEngine, private readonly race: Race, private readonly camera: PerspectiveCamera) {
    this.sources = race.ships.map((ship, id) => ({
      id, s: 0, x: 0, lift: HOVER_HEIGHT, position: new Vector3(), velocity: new Vector3(),
      speed: 0, thrust: 0, airbrake: 0, active: false, isPlayer: ship.isPlayer,
    }));
    this.listener = { position: new Vector3(), forward: new Vector3(), up: new Vector3(), s: 0 };
    this.bindEvents();
  }

  /**
   * @param live faux au menu et en pause : les moteurs se taisent, sauf le vaisseau du joueur
   *             quand le banc d'essai (panneau F2) est actif.
   */
  update(dt: number, live: boolean): void {
    const sfx = this.audio.sfx;
    if (!sfx) return;
    const bench = sfx.manual.enabled;
    if (!live && !bench) {
      sfx.silence();
      return;
    }
    const race = this.race;
    race.ships.forEach((ship, i) => this.fill(this.sources[i], ship, live || ship.isPlayer));

    const cam = this.camera;
    const l = this.listener;
    l.position.copy(cam.position);
    cam.getWorldDirection(l.forward);
    l.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    l.s = race.player.s;
    sfx.update({ track: race.track, listener: l, sources: this.sources, dt });

    if (!live) return;
    // alerte bouclier faible, répétée tant que le bouclier reste bas
    const p = race.player;
    this.alertTimer -= dt;
    this.scrapeTimer -= dt;
    if (race.phase === 'racing' && !p.dead && !p.finished && p.energy < LOW_SHIELD && this.alertTimer <= 0) {
      this.alertTimer = ALERT_EVERY;
      sfx.play('shieldAlert');
    }
  }

  /** Frottement contre un mur, au point de contact (appelé par le jeu pendant l'étincelle). */
  scrape(ship: Ship, at: Vector3): void {
    if (this.scrapeTimer > 0 || !this.audible(ship)) return;
    this.scrapeTimer = SCRAPE_EVERY;
    this.audio.sfx?.play('scrape', { position: at, s: ship.s }, Math.min(1, ship.speed / 60));
  }

  private fill(src: MutableSource, ship: Ship, active: boolean): void {
    const f = this.race.track.frameAt(ship.s, this.frame);
    src.s = ship.s;
    src.x = ship.x;
    src.position.copy(f.p).addScaledVector(f.r, ship.x).addScaledVector(f.u, HOVER_HEIGHT + ship.h);
    // vitesse monde : (u, w) exprimés dans le repère du vaisseau, tourné de psi
    const c = Math.cos(ship.psi);
    const sn = Math.sin(ship.psi);
    const vs = ship.u * c - ship.w * sn;
    const vx = ship.u * sn + ship.w * c;
    src.velocity.copy(f.t).multiplyScalar(vs).addScaledVector(f.r, vx);
    src.speed = ship.speed / ship.perf.vmax;
    src.thrust = ship.input.thrust;
    src.airbrake = Math.max(ship.input.airbrakeLeft, ship.input.airbrakeRight);
    src.active = active && !ship.dead;
  }

  private audible(ship: Ship): boolean {
    return ship.isPlayer || Math.abs(this.race.track.wrapDiff(ship.s - this.race.player.s)) < EARSHOT;
  }

  private at(ship: Ship): { position: Vector3; s: number } {
    return { position: this.race.track.pointAt(ship.s, ship.x, HOVER_HEIGHT + ship.h, new Vector3()), s: ship.s };
  }

  private playAt(name: SfxName, ship: Ship, intensity = 1): void {
    if (this.audible(ship)) this.audio.sfx?.play(name, this.at(ship), intensity);
  }

  private bindEvents(): void {
    const ev = this.race.events;
    const ui = (name: SfxName) => this.audio.sfx?.play(name);
    const isPlayer = (s: Ship) => s.isPlayer;
    ev.on('countdown', () => ui('countdown'));
    ev.on('go', () => ui('go'));
    ev.on('boost', ({ ship }) => this.playAt('speedPad', ship));
    ev.on('pickup', ({ ship }) => isPlayer(ship) && ui('pickup'));
    ev.on('itemUsed', ({ ship, item }) => {
      const sound: Record<typeof item, SfxName> = { TURBO: 'speedPad', IMPULSION: 'plasma', MINES: 'mines', BOUCLIER: 'shieldUp' };
      this.playAt(sound[item], ship);
    });
    ev.on('wallHit', ({ ship, impact }) => {
      if (!this.audible(ship)) return;
      const f = this.race.track.frameAt(ship.s, this.frame);
      const side = Math.sign(ship.x) || 1;
      const at = f.p.clone().addScaledVector(f.r, this.race.track.halfWidth * side).addScaledVector(f.u, 0.8);
      this.audio.sfx?.play('collision', { position: at, s: ship.s }, impact / 25);
    });
    ev.on('bump', ({ a, b }) => (isPlayer(a) || isPlayer(b) || this.audible(a)) && this.playAt('collision', a, 0.35));
    ev.on('shipHit', ({ ship, shielded }) => this.playAt('collision', ship, shielded ? 0.3 : 1));
    ev.on('lap', ({ ship }) => isPlayer(ship) && ui('lap'));
    ev.on('finish', ({ ship }) => isPlayer(ship) && ui('fanfare'));
    ev.on('eliminated', ({ ship }) => this.playAt('explosion', ship));
  }
}
