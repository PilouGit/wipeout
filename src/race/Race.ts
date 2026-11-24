import { AI_SKILLS, FIELD_SIZE, LAPS, RECHARGE_ZONE, type Difficulty } from '../config';
import { Emitter } from '../core/Emitter';
import type { Track } from '../track/Track';
import { AIDriver, type AIContext } from './AIDriver';
import { Groove, GrooveAI, type BeatSample, type GrooveResult } from './Groove';
import { createPads, PAD_TRIGGER_HALF_LENGTH, PAD_TRIGGER_HALF_WIDTH, type Pad } from './pads';
import { stepShip } from './physics';
import { Ship, type ItemKind } from './Ship';
import { TEAMS, type Team } from './teams';
import { randomItem, WeaponSystem, type HitSpec } from './WeaponSystem';

export type RacePhase = 'idle' | 'countdown' | 'racing';

export interface RaceEvents extends Record<string, unknown> {
  countdown: { n: number };
  go: Record<string, never>;
  boost: { ship: Ship };
  pickup: { ship: Ship; item: ItemKind };
  itemUsed: { ship: Ship; item: ItemKind };
  wallHit: { ship: Ship; impact: number };
  /** Retour sur la piste après un saut ; impact = vitesse verticale (m/s). */
  land: { ship: Ship; impact: number };
  bump: { a: Ship; b: Ship; dv: number };
  shipHit: { ship: Ship; shielded: boolean };
  lap: { ship: Ship; lap: number; time: number };
  finish: { ship: Ship; position: number };
  eliminated: { ship: Ship };
  /** Action rythmique du joueur jugée (touche de rythme, pad ou atterrissage). */
  groove: { ship: Ship; result: GrooveResult };
}

export interface RaceSetup {
  /** Circuit ; par défaut celui de la course précédente. */
  readonly track?: Track;
  /** Écurie du joueur ; par défaut celle de la course précédente. */
  readonly team?: Team;
  /** Tirage des écuries adverses (injectable pour les tests). */
  readonly rand?: () => number;
}

export interface ResultRow {
  readonly ship: Ship;
  readonly status: 'finished' | 'estimated' | 'eliminated';
  readonly time: number;
}

const COUNTDOWN_SECONDS = 3;
const GRID_ROW_GAP = 14;
const COLLISION_LENGTH = 4.4;
const COLLISION_WIDTH = 2.6;

/**
 * Simulation complète d'une course, sans dépendance au rendu ni au DOM.
 * Le joueur est piloté de l'extérieur via `player.input` ; une fois arrivé il passe en pilote automatique.
 */
export class Race {
  readonly events = new Emitter<RaceEvents>();
  readonly ships: Ship[];
  readonly player: Ship;
  pads: Pad[];
  readonly weapons: WeaponSystem;
  readonly laps = LAPS;

  phase: RacePhase = 'idle';
  time = 0;
  /** Rythme du joueur (série d'actions sur le temps). */
  readonly groove = new Groove();
  /** Les IA jouent le temps elles aussi (probabilité selon la difficulté). */
  private readonly grooveAI = new GrooveAI();
  private grooveChance = 0;
  /** Position musicale entendue, fournie par le jeu ; null = pas de musique, pas de jugement. */
  beat: () => BeatSample | null = () => null;

  private readonly drivers = new Map<Ship, AIDriver>();
  private countdownLeft = 0;
  private lastCount = -1;
  private aiContext: AIContext;

  /** Le joueur part dernier sur la grille, derrière FIELD_SIZE - 1 adversaires. */
  constructor(public track: Track, difficulty: Difficulty, playerTeam: Team = TEAMS[0]) {
    const rivals = TEAMS.filter((t) => t !== playerTeam);
    this.ships = Array.from({ length: FIELD_SIZE - 1 }, (_, i) => new Ship(false, rivals[i % rivals.length], difficulty));
    this.player = new Ship(true, playerTeam, difficulty);
    this.ships.push(this.player);
    for (const s of this.ships) this.drivers.set(s, new AIDriver(1));
    this.pads = createPads(track.length);
    this.weapons = new WeaponSystem(track);
    this.aiContext = this.makeAIContext();
  }

  private makeAIContext(): AIContext {
    return { track: this.track, ships: this.ships, pads: this.pads, rubberBand: this.player };
  }

  /** Change de circuit (pads, armes, contexte IA). */
  setTrack(track: Track): void {
    if (track === this.track) return;
    this.track = track;
    this.pads = createPads(track.length);
    this.weapons.track = track;
    this.aiContext = this.makeAIContext();
  }

  start(difficulty: Difficulty, setup: RaceSetup = {}): void {
    if (setup.track) this.setTrack(setup.track);
    const playerTeam = setup.team ?? this.player.team;
    // adversaires : les autres écuries, tirées au sort
    const rand = setup.rand ?? Math.random;
    const rivals = TEAMS.filter((t) => t !== playerTeam)
      .map((t) => [rand(), t] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t);
    let r = 0;
    this.ships.forEach((ship, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const team = ship.isPlayer ? playerTeam : rivals[r++ % rivals.length];
      ship.reset(-10 - row * GRID_ROW_GAP, col ? 5 : -5, difficulty, this.track.length, team);
      const skill = ship.isPlayer ? 1 : difficulty.ai * (AI_SKILLS[i] ?? 1);
      this.drivers.get(ship)!.reset(skill);
    });
    this.weapons.clear();
    this.groove.reset();
    this.grooveAI.reset();
    this.grooveChance = difficulty.groove;
    this.time = 0;
    this.countdownLeft = COUNTDOWN_SECONDS + 1;
    this.lastCount = -1;
    this.phase = 'countdown';
  }

  /** Arrête la simulation (retour au menu). */
  stop(): void {
    this.phase = 'idle';
    this.weapons.clear();
  }

  /** Distance totale d'une course. */
  get raceLength(): number {
    return this.laps * this.track.length;
  }

  step(dt: number): void {
    if (this.phase === 'idle') return;
    if (this.phase === 'countdown') {
      this.stepCountdown(dt);
      return;
    }
    this.time += dt;

    for (const ship of this.ships) {
      if (ship.dead) continue;
      if (!ship.isPlayer || ship.finished) this.drivers.get(ship)!.update(ship, dt, this.aiContext);
      if (ship.input.fire) {
        ship.input.fire = false;
        const used = this.weapons.use(ship);
        if (used) this.events.emit('itemUsed', { ship, item: used });
      }
      if (ship.input.pulse) {
        ship.input.pulse = false;
        const at = ship.input.pulseBeat;
        ship.input.pulseBeat = undefined;
        if (ship.isPlayer && !ship.finished) this.judge('pulse', ship, at === undefined ? this.beat() : at);
      }
      const impact = stepShip(ship, this.track, dt);
      if (impact > 0) this.events.emit('wallHit', { ship, impact });
      if (ship.landImpact > 0) {
        this.events.emit('land', { ship, impact: ship.landImpact });
        if (ship.isPlayer && ship.landImpact >= 2) this.judge('land', ship);
      }
    }

    const sample = this.beat();
    this.groove.update(dt, sample);
    this.grooveAI.update(this.ships, sample, this.grooveChance);
    this.resolveCollisions();
    this.handlePads(dt);
    this.weapons.update(dt, this.ships, (ship, hit, by) => this.applyHit(ship, hit, by));
    this.handleLapsAndEnergy();
  }

  private stepCountdown(dt: number): void {
    this.countdownLeft -= dt;
    const n = Math.ceil(this.countdownLeft - 1);
    if (n === this.lastCount) return;
    this.lastCount = n;
    if (n >= 1 && n <= COUNTDOWN_SECONDS) this.events.emit('countdown', { n });
    if (n <= 0) {
      this.phase = 'racing';
      this.events.emit('go', {});
    }
  }

  private resolveCollisions(): void {
    const ships = this.ships;
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i];
        const b = ships[j];
        if (a.dead || b.dead) continue;
        const d = this.track.wrapDiff(a.s - b.s);
        const dx = a.x - b.x;
        if (Math.abs(d) >= COLLISION_LENGTH || Math.abs(dx) >= COLLISION_WIDTH) continue;
        const sgn = dx === 0 ? 1 : Math.sign(dx);
        // le plus lourd bouge moins : part de la poussée reçue proportionnelle à la masse de l'autre
        const ma = a.perf.mass;
        const mb = b.perf.mass;
        const shareA = (2 * mb) / (ma + mb);
        const shareB = (2 * ma) / (ma + mb);
        const push = (COLLISION_WIDTH - Math.abs(dx)) / 2;
        a.x += sgn * push * shareA;
        b.x -= sgn * push * shareB;
        const ahead = d > 0 ? a : b;
        const behind = d > 0 ? b : a;
        const dv = behind.u - ahead.u;
        if (dv > 0) {
          behind.u -= dv * 0.6 * (ahead === a ? shareB : shareA);
          ahead.u += dv * 0.35 * (ahead === a ? shareA : shareB);
        }
        a.w += sgn * 2.5 * shareA;
        b.w -= sgn * 2.5 * shareB;
        if (dv > 4) this.events.emit('bump', { a, b, dv });
      }
    }
  }

  private handlePads(dt: number): void {
    for (const ship of this.ships) {
      if (ship.dead) continue;
      const sm = this.track.mod(ship.s);
      for (const pad of this.pads) {
        if (Math.abs(this.track.wrapDiff(sm - pad.s)) > PAD_TRIGGER_HALF_LENGTH) continue;
        if (Math.abs(ship.x - pad.x) > PAD_TRIGGER_HALF_WIDTH) continue;
        if (ship.lastPadId === pad.id && this.time - ship.lastPadTime < 1.5) continue;
        ship.lastPadId = pad.id;
        ship.lastPadTime = this.time;
        if (pad.type === 'boost') {
          ship.boostTime = Math.max(ship.boostTime, 1.3);
          ship.u += 14;
          this.events.emit('boost', { ship });
          if (ship.isPlayer) this.judge('pad', ship);
        } else if (!ship.item) {
          ship.item = randomItem();
          this.drivers.get(ship)!.onItemPicked();
          this.events.emit('pickup', { ship, item: ship.item });
        }
      }
      if (sm < RECHARGE_ZONE && ship.s > RECHARGE_ZONE && !ship.finished) {
        ship.energy = Math.min(100, ship.energy + 14 * dt);
      }
    }
  }

  private judge(action: 'pulse' | 'pad' | 'land', ship: Ship, sample: BeatSample | null = this.beat()): void {
    const result = this.groove.act(action, ship, sample);
    if (result) this.events.emit('groove', { ship, result });
  }

  private applyHit(ship: Ship, hit: HitSpec, by: Ship): void {
    if (ship.shielded) {
      this.events.emit('shipHit', { ship, shielded: true });
      return;
    }
    ship.u *= hit.speedFactor;
    ship.stunTime = 0.9;
    ship.energy -= hit.damage * by.perf.firepower * ship.perf.armor;
    this.events.emit('shipHit', { ship, shielded: false });
  }

  private handleLapsAndEnergy(): void {
    for (const ship of this.ships) {
      if (ship.dead) continue;
      if (ship.energy <= 0) {
        if (ship.isPlayer) {
          ship.dead = true;
          this.events.emit('eliminated', { ship });
        } else {
          // les IA ne sont pas éliminées : elles repartent ralenties
          ship.energy = 60;
          ship.stunTime = 1.2;
          ship.u *= 0.3;
        }
        continue;
      }
      const lapsDone = Math.floor(ship.s / this.track.length);
      if (lapsDone <= ship.lapsDone) continue;
      ship.lapsDone = lapsDone;
      if (ship.finished) continue;
      if (lapsDone >= 1) {
        const lapTime = this.time - ship.lapStart;
        ship.lapTimes.push(lapTime);
        ship.lapStart = this.time;
        if (lapsDone < this.laps) this.events.emit('lap', { ship, lap: lapsDone + 1, time: lapTime });
      }
      if (lapsDone >= this.laps) {
        ship.finished = true;
        ship.finishTime = this.time;
        this.events.emit('finish', { ship, position: this.standings().indexOf(ship) + 1 });
      }
    }
  }

  /** Classement courant : arrivés (par temps), puis en course (par distance), puis éliminés. */
  standings(): Ship[] {
    return [...this.ships].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.dead !== b.dead) return a.dead ? 1 : -1;
      return b.s - a.s;
    });
  }

  /** Classement final ; les temps des vaisseaux encore en course sont estimés. */
  results(): ResultRow[] {
    const avgSpeed = this.player.perf.vmax * 0.85;
    return this.standings().map((ship): ResultRow => {
      if (ship.finished) return { ship, status: 'finished', time: ship.finishTime };
      if (ship.dead) return { ship, status: 'eliminated', time: NaN };
      return { ship, status: 'estimated', time: this.time + (this.raceLength - ship.s) / avgSpeed };
    });
  }

  position(ship: Ship): number {
    return this.standings().indexOf(ship) + 1;
  }

  currentLap(ship: Ship): number {
    return Math.min(this.laps, Math.max(1, ship.lapsDone + 1));
  }
}
