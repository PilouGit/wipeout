import type { AudioEngine } from '../audio/AudioEngine';
import type { IMuse } from '../audio/imuse/IMuse';
import { CC_BRIGHTNESS, NORMAL_SPEED } from '../audio/imuse/types';
import type { SoundFile } from '../audio/imuse/types';
import { DRAGON, HOOK, JUMP, MAIN, MARKER, SOUND, SPEED, TENSION, type MainChunk } from '../audio/score';
import { clamp } from '../core/math';
import type { Race } from '../race/Race';
import type { Track } from '../track/Track';
import { arrivalTime, musicCues, planDrop, trimDrop, type MusicCues } from './DropSync';

type Mode = 'menu' | 'race' | 'ending';
type Section = 'INTRO' | 'GRID' | 'CRUISE' | 'DRIVE' | 'BREAKDOWN' | 'FINAL' | 'OUTRO';

/** Section « musicale » de chaque chunk (une transition compte comme sa destination). */
const SECTION_OF: Readonly<Record<MainChunk, Section>> = {
  [MAIN.INTRO]: 'INTRO',
  [MAIN.GRID]: 'GRID',
  [MAIN.CRUISE]: 'CRUISE',
  [MAIN.FILL_UP]: 'DRIVE',
  [MAIN.DRIVE]: 'DRIVE',
  [MAIN.BREAKDOWN]: 'BREAKDOWN',
  [MAIN.FILL_FINAL]: 'FINAL',
  [MAIN.FINAL]: 'FINAL',
  [MAIN.OUTRO]: 'OUTRO',
};

const JUMP_VALUE: Readonly<Partial<Record<Section, number>>> = {
  GRID: JUMP.GRID,
  CRUISE: JUMP.CRUISE,
  DRIVE: JUMP.DRIVE,
  BREAKDOWN: JUMP.BREAKDOWN,
  FINAL: JUMP.FINAL,
  OUTRO: JUMP.FINISH,
};

/** Parties dont la brillance (CC74) suit la vitesse du joueur. */
const BRIGHT_PARTS = ['acid', 'sub', 'stab', 'arp', 'pad'] as const;
const CC_INTERVAL = 0.1;
const LEVEL_HOLD = 1.5;
const LOW_MOMENTUM_DELAY = 2.5;
/** Tempo (MdSetSpeed) selon la vitesse : de -5 % à l'arrêt à +13 % à fond, +5 % en boost, +4 % au dernier tour. */
const TEMPO_MIN = 0.95;
const TEMPO_RANGE = 0.13;
const TEMPO_BOOST = 0.05;
const TEMPO_FINAL = 1.04;
const TEMPO_INTERVAL = 0.25;
/** Paliers de vitesse (fraction de la vitesse de pointe) des couches rythmiques, et tenue minimale. */
const SPEED_TIERS: readonly [number, number][] = [[0.92, SPEED.MAX], [0.75, SPEED.FASTER], [0.5, SPEED.FAST]];
const SPEED_HOLD = 1;
/** Fenêtre d'approche d'un rendez-vous (s) : la synchro du drop prend la main sur le tempo. */
const SYNC_APPROACH = 14;
/** Vitesse minimale (m/s) pour viser un rendez-vous (en dessous, l'arrivée est imprévisible). */
const SYNC_MIN_SPEED = 25;
/** Après un drop synchronisé, DRIVE est tenu au moins ce temps (s). */
const DROP_HOLD = 9;

/**
 * Directeur musical : observe la course et la traduit en commandes iMUSE.
 *
 * Il ne coupe ni ne lance jamais une section lui-même pendant la course : il exprime
 * un *souhait* (valeurs de hooks), et la partition décide quand c'est musicalement possible
 * (fin de phrase, de mesure, de temps). Seuls la fin de course (trigger sur marqueur)
 * et les accents ponctuels (fondus, contrôleurs) sont des actions directes.
 */
export class MusicDirector {
  private mode: Mode = 'menu';
  private launched = false;
  private paused = false;
  private intensity = 0;
  private level = 1;
  private levelHeld = 0;
  private lowMomentum = 0;
  private ccTimer = 0;
  private tempoTimer = 0;
  private tempo = NORMAL_SPEED;
  private speedTier: number = SPEED.SLOW;
  private speedHeld = 0;
  /** Thème du circuit affiché. */
  private theme: SoundFile;
  /** Source « des dragons sont sortis du sol » (le décor du circuit affiché). */
  private dragons: () => boolean = () => false;
  private dragonsOut = false;
  /** Rendez-vous musicaux du circuit (drops sur les tremplins et sorties de tunnel). */
  private cues: MusicCues | null = null;
  private cuesTrack: Track | null = null;
  /** Rendez-vous visé (abscisse cumulée) et état de la synchro. */
  private syncTarget: number | null = null;
  private syncFactor = 1;
  /** La montée vers le rendez-vous est programmée : plus de nouveau saut, seulement le tempo. */
  private syncCommitted = false;
  /** Le hook DROP a été posé pour ce rendez-vous (une montée « naturelle » ne compte pas). */
  private syncArmed = false;
  private dropHold = 0;
  /** Accélération lissée du joueur (m/s²), pour prévoir son heure d'arrivée. */
  private accel = 0;
  private lastSpeed = 0;
  /** Barre visée (mesures restantes avant le saut) et dernière position dans la mesure. */
  private syncBars: number | null = null;
  /**
   * Vitesse de l'horloge audio par rapport au temps réel (le jeu avance en temps réel, la musique
   * en temps audio : sur certaines sorties, l'écart atteint plusieurs pour cent).
   */
  private audioRate = 1;
  private rateRef: { audio: number; real: number } | null = null;
  private lastInBar = 0;
  /** Dernier écart mesuré entre le drop entendu et l'arrivée sur le rendez-vous (s), pour le débogage. */
  lastDropError: number | null = null;

  constructor(private readonly audio: AudioEngine, private readonly race: Race) {
    this.theme = [...audio.themes.values()][0];
    audio.themeSound = this.theme.id;
    const player = race.player;
    race.events.on('shipHit', ({ ship, shielded }) => ship === player && !shielded && this.duck());
    race.events.on('finish', ({ ship, position }) => ship === player && this.end(position <= 3));
    race.events.on('eliminated', ({ ship }) => ship === player && this.end(false));
  }

  private get sound(): number {
    return this.theme.id;
  }

  /**
   * Change de thème (choix d'un circuit, ou nouvelle graine au banc d'essai). Le nouveau thème
   * prend le relais tout de suite, en fondu, à la même section ; les hooks sont reposés à l'image suivante.
   */
  setTheme(theme: SoundFile): void {
    if (theme === this.theme) return;
    const old = this.theme.id;
    this.theme = theme;
    this.audio.themeSound = theme.id;
    const m = this.audio.imuse;
    if (!m || !this.launched || this.mode === 'ending') return;
    const chunk = m.position(old)?.chunk ?? MAIN.INTRO;
    m.stopSound(old);
    m.startSound(theme.id, chunk);
    m.setParam(theme.id, 'volume', 0);
    m.fade(theme.id, 'volume', theme.volume, 1.5);
  }

  /** Branche la musique sur les dragons du décor : quand ils jaillissent, leur rugissement entre à la mesure. */
  setDragonSource(active: () => boolean): void {
    this.dragons = active;
  }

  enterMenu(): void {
    this.setPaused(false);
    this.mode = 'menu';
    this.launched = false;
  }

  enterRace(): void {
    this.setPaused(false);
    this.mode = 'race';
    this.launched = false;
    this.intensity = 0;
    this.level = 1;
    this.levelHeld = 0;
    this.lowMomentum = 0;
    this.tempoTimer = 0;
    this.tempo = NORMAL_SPEED;
    this.speedTier = SPEED.SLOW;
    this.speedHeld = 0;
    this.syncTarget = null;
    this.syncFactor = 1;
    this.syncCommitted = false;
    this.syncArmed = false;
    this.dropHold = 0;
  }

  /** Pause du jeu ↔ compteur de pause imbriqué d'iMUSE (toujours équilibré). */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const m = this.audio.imuse;
    if (!m) return;
    if (paused) m.pause();
    else m.resume();
  }

  update(dt: number): void {
    const m = this.audio.imuse;
    if (!m || this.paused) return;
    if (!this.launched) this.launch(m);
    if (this.mode === 'race') this.steer(m, dt);
    // Les dragons ↔ la musique : la partition fait entrer le rugissement à la prochaine mesure
    this.dragonsOut = this.mode !== 'ending' && this.dragons();
    m.setHook(this.sound, HOOK.DRAGON, this.dragonsOut ? DRAGON.ON : DRAGON.OFF);
  }

  // ------------------------------------------------------------------ internes

  private launch(m: IMuse): void {
    this.launched = true;
    if (this.mode === 'menu') {
      m.stopAllSounds();
      m.startSound(this.sound, MAIN.INTRO);
      m.setParam(this.sound, 'volume', this.theme.volume);
      return;
    }
    if (this.mode !== 'race') return;
    // Depuis le menu, l'intro rejoint la grille à la prochaine mesure (hook GRID) ;
    // sinon (relance, résultats) on repart directement de la grille.
    const pos = m.position(this.sound);
    if (!pos || SECTION_OF[pos.chunk as MainChunk] !== 'INTRO') {
      m.stopAllSounds();
      m.startSound(this.sound, MAIN.GRID);
    } else {
      m.stopSound(SOUND.VICTORY);
      m.stopSound(SOUND.DEFEAT);
    }
    m.setParam(this.sound, 'speed', NORMAL_SPEED);
    m.setParam(this.sound, 'volume', this.theme.volume);
    m.setHook(this.sound, HOOK.LAYER, 1);
    m.setHook(this.sound, HOOK.TENSION, TENSION.OFF);
    m.setHook(this.sound, HOOK.SPEED, SPEED.SLOW);
  }

  /** Calcule l'état souhaité et le pose dans les hooks ; appelé à chaque image. */
  private steer(m: IMuse, dt: number): void {
    const pos = m.position(this.sound);
    if (!pos) return;
    const r = this.race;
    const p = r.player;
    const racing = r.phase === 'racing';
    const speedRatio = clamp(p.speed / p.perf.vmax, 0, 1.3);

    // Intensité : vitesse, rang, adversaires proches, boost, série rythmique
    const rank = 1 - (r.position(p) - 1) / (r.ships.length - 1);
    const near = r.ships.filter((o) => o !== p && !o.dead && Math.abs(r.track.wrapDiff(o.s - p.s)) < 60).length;
    // la série rythmique du joueur nourrit l'intensité : jouer en rythme fait monter la musique
    const groove = Math.min(0.25, r.groove.streak * 0.04);
    const target = racing ? 0.55 * Math.min(1, speedRatio) + 0.25 * rank + 0.2 * Math.min(1, near / 2) + (p.boostTime > 0 ? 0.2 : 0) + groove : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.5);

    // Niveau d'orchestration avec hystérésis : un changement doit être franc et durable
    this.levelHeld += dt;
    const raw = 1 + Math.floor(clamp(this.intensity, 0, 0.999) * 4);
    const center = (this.level - 0.5) / 4;
    if (raw !== this.level && this.levelHeld > LEVEL_HOLD && Math.abs(this.intensity - center) > 0.13) {
      this.level = raw;
      this.levelHeld = 0;
    }
    m.setHook(this.sound, HOOK.LAYER, this.level);
    m.setHook(this.sound, HOOK.TENSION, p.energy < 30 ? TENSION.ON : TENSION.OFF);

    // Perte d'élan (gros choc, contresens, arrêt) → respiration musicale
    const stalled = racing && (speedRatio < 0.35 || Math.cos(p.psi) < 0);
    this.lowMomentum = stalled ? this.lowMomentum + dt : speedRatio > 0.5 ? 0 : this.lowMomentum;

    const current = SECTION_OF[pos.chunk as MainChunk];
    const finalLap = p.lapsDone >= r.laps - 1;
    const sync = racing && !finalLap ? this.syncDrop(dt) : null;

    let desired: Section;
    if (r.phase === 'countdown') desired = 'GRID';
    else if (finalLap) desired = 'FINAL';
    else if (this.lowMomentum > LOW_MOMENTUM_DELAY) desired = 'BREAKDOWN';
    else if (this.dropHold > 0) desired = 'DRIVE';
    else if (sync?.calm) desired = 'BREAKDOWN';
    // un rendez-vous approche : on garde le drop pour lui (pas de montée naturelle d'ici là)
    else if (sync && !sync.approach && sync.eta < SYNC_APPROACH + 10 && current !== 'DRIVE') desired = current === 'BREAKDOWN' ? 'BREAKDOWN' : 'CRUISE';
    // avant un rendez-vous, on redescend pour que le drop soit un vrai contraste
    else if (sync?.approach && sync.eta > 6) desired = current === 'BREAKDOWN' ? 'BREAKDOWN' : 'CRUISE';
    else desired = this.level >= 3 ? 'DRIVE' : 'CRUISE';

    let jump = desired === current ? 0 : JUMP_VALUE[desired] ?? 0;
    if (sync?.approach) jump = sync.arm ? JUMP.DROP : desired === 'BREAKDOWN' || desired === 'CRUISE' ? jump : 0;
    if (pos.chunk === MAIN.FILL_UP) jump = 0;
    m.setHook(this.sound, HOOK.JUMP, jump);

    // Couches rythmiques selon la vitesse (hooks SPEED, réévalués à chaque mesure), avec tenue minimale
    this.speedHeld += dt;
    const boostRatio = p.boostTime > 0 ? 1 : speedRatio;
    const tier = racing ? SPEED_TIERS.find(([min]) => boostRatio >= min)?.[1] ?? SPEED.SLOW : SPEED.SLOW;
    if (tier !== this.speedTier && this.speedHeld > SPEED_HOLD) {
      this.speedTier = tier;
      this.speedHeld = 0;
    }
    m.setHook(this.sound, HOOK.SPEED, this.speedTier);

    // Tempo lié à la vitesse (MdSetSpeed par petits fondus), un peu plus vif au dernier tour
    this.tempoTimer -= dt;
    if (this.tempoTimer <= 0) {
      this.tempoTimer = TEMPO_INTERVAL;
      const factor = sync?.approach
        ? this.syncFactor
        : racing
          ? (TEMPO_MIN + TEMPO_RANGE * Math.min(1, speedRatio) + (p.boostTime > 0 ? TEMPO_BOOST : 0)) * (current === 'FINAL' ? TEMPO_FINAL : 1)
          : 1;
      const tempo = Math.round(NORMAL_SPEED * factor);
      if (Math.abs(tempo - this.tempo) >= 1) {
        this.tempo = tempo;
        // en synchro, le tempo doit suivre vite (la cible bouge avec la vitesse du joueur)
        m.fade(this.sound, 'speed', tempo, sync?.approach ? 0.2 : 0.6);
      }
    }

    // Brillance des synthés liée à la vitesse (contrôleur MIDI, comme MdSendMessage)
    this.ccTimer -= dt;
    if (this.ccTimer <= 0) {
      this.ccTimer = CC_INTERVAL;
      const value = Math.round(clamp(36 + 80 * Math.min(1, speedRatio) + (p.boostTime > 0 ? 20 : 0), 0, 127));
      for (const part of BRIGHT_PARTS) m.execute({ op: 'sendMessage', sound: this.sound, part, controller: CC_BRIGHTNESS, value });
    }
  }

  /**
   * Synchro du drop sur le prochain rendez-vous du circuit : choisit la barre du saut, pose le hook
   * DROP au bon moment, et règle le tempo pour rattraper l'écart. Pendant la montée (FILL_UP),
   * seul le tempo est ajusté. Les tunnels qui précèdent un rendez-vous sont des breakdowns.
   */
  private syncDrop(dt: number): { approach: boolean; arm: boolean; calm: boolean; eta: number } | null {
    const r = this.race;
    const p = r.player;
    if (this.cuesTrack !== r.track) {
      this.cuesTrack = r.track;
      this.cues = musicCues(r.track);
      this.syncTarget = null;
    }
    this.dropHold = Math.max(0, this.dropHold - dt);
    const cues = this.cues!;
    const L = r.track.length;
    const sm = r.track.mod(p.s);
    const calm = cues.calms.some((z) => sm >= z.from && sm <= z.to);
    const clock = this.audio.heardClock();
    if (!clock || cues.drops.length === 0) return { approach: false, arm: false, calm, eta: Infinity };
    const baseBps = this.theme.bpm / 60;
    const speed = Math.max(1, p.speed);
    if (dt > 0) this.accel += ((p.speed - this.lastSpeed) / dt - this.accel) * Math.min(1, dt * 2);
    this.lastSpeed = p.speed;
    const vmax = p.perf.vmax * (p.boostTime > 0 ? 1.15 : 1);
    // l'accélération ne sert qu'à prévoir la reprise de vitesse (départ, sortie de virage) ;
    // les à-coups (pads, chocs) sont rattrapés par la replanification
    const climbing = p.speed < vmax * 0.92 ? Math.min(10, Math.max(0, this.accel)) : 0;
    this.measureAudioRate();
    // heure d'arrivée convertie en temps audio : c'est sur cette horloge que la musique avance
    const arrival = (d: number) => arrivalTime(d, speed, climbing, vmax) * this.audioRate;

    // rendez-vous en cours : on le garde jusqu'à le franchir
    if (this.syncTarget !== null && p.s >= this.syncTarget) {
      this.syncTarget = null;
      if (this.syncCommitted) this.dropHold = DROP_HOLD;
    }
    if (this.syncTarget === null) {
      const ahead = cues.drops.map((s) => p.s + ((s - sm + L) % L)).filter((s) => s - p.s > 1);
      const next = Math.min(...ahead);
      const nextEta = arrival(next - p.s);
      if (nextEta < SYNC_APPROACH && p.speed > SYNC_MIN_SPEED) {
        this.syncTarget = next;
        this.syncCommitted = this.syncArmed = false;
        this.syncBars = null;
      } else return { approach: false, arm: false, calm, eta: nextEta };
    }
    const eta = arrival(this.syncTarget - p.s);
    if (p.speed < SYNC_MIN_SPEED * 0.6) {
      // le joueur s'est arrêté : on abandonne ce rendez-vous
      this.syncTarget = null;
      return { approach: false, arm: false, calm, eta };
    }

    // montée lancée : on ne règle plus que le tempo jusqu'au drop entendu. L'horloge donne la section
    // programmée ; juste après un saut, ses temps sont négatifs tant que l'ancienne s'entend encore.
    const beats = clock.bar * 4 + clock.beat;
    if (clock.chunk === MAIN.FILL_UP && this.syncArmed) this.syncCommitted = true;
    if (this.syncCommitted) {
      const beatsLeft = clock.chunk === MAIN.FILL_UP ? 4 - beats : clock.chunk === MAIN.DRIVE && beats < 0 ? -beats : 0;
      if (beatsLeft > 0) {
        this.syncFactor = trimDrop(eta, beatsLeft, baseBps);
        this.lastDropError = beatsLeft / (this.syncFactor * baseBps) - eta;
      }
      return { approach: true, arm: false, calm: false, eta };
    }
    // une barre de mesure franchie : la barre visée se rapproche d'une mesure
    if (this.syncBars !== null && clock.beat < this.lastInBar - 2) this.syncBars--;
    this.lastInBar = clock.beat;
    // l'horloge entendue et la position de l'ordonnanceur se rapportent à la même section :
    // l'écart de leurs numéros de mesure est le nombre de barres lues mais pas encore entendues
    const sched = this.audio.imuse?.position(this.sound);
    const ahead = sched ? Math.max(0, sched.measure - clock.bar) : 1;
    const plan = planDrop(eta, clock.beat, baseBps, this.syncFactor, ahead, this.syncBars);
    if (!plan) return { approach: false, arm: false, calm, eta };
    this.syncFactor = plan.factor;
    this.syncBars = plan.bars;
    this.lastDropError = plan.error;
    // une montée naturelle en cours : pas de nouveau saut avant d'en être sorti
    if (clock.chunk === MAIN.FILL_UP) return { approach: true, arm: false, calm, eta };
    if (plan.arm) this.syncArmed = true;
    return { approach: true, arm: plan.arm, calm, eta };
  }

  private measureAudioRate(): void {
    const ctx = this.audio.context;
    if (!ctx) return;
    const now = { audio: ctx.currentTime, real: performance.now() / 1000 };
    const ref = this.rateRef;
    if (!ref || now.real - ref.real > 5 || now.real < ref.real) {
      this.rateRef = now;
      return;
    }
    const span = now.real - ref.real;
    if (span < 1) return;
    const rate = (now.audio - ref.audio) / span;
    if (rate > 0.5 && rate < 1.5) this.audioRate += (rate - this.audioRate) * 0.5;
    this.rateRef = now;
  }

  /** Touché : la musique « encaisse » puis revient (fondu immédiat + fondu différé). */
  private duck(): void {
    const m = this.audio.imuse;
    if (!m || this.mode !== 'race') return;
    m.fade(this.sound, 'volume', 64, 0.08);
    m.deferCommand(0.5, { op: 'fade', sound: this.sound, param: 'volume', value: this.theme.volume, seconds: 1.5 });
  }

  /**
   * Fin de course, sur le modèle de la sortie de combat d'iMUSE : on active le hook de saut
   * vers l'outro et on accroche au marqueur de fin d'outro le lancement du jingle.
   */
  private end(victory: boolean): void {
    if (this.mode !== 'race') return;
    this.mode = 'ending';
    const m = this.audio.imuse;
    if (!m) return;
    const stinger = victory ? SOUND.VICTORY : SOUND.DEFEAT;
    if (!m.isPlaying(this.sound)) {
      m.startSound(stinger);
      return;
    }
    const key = m.getParam(this.sound, 'transpose');
    m.clearTrigger(this.sound, MARKER.OUTRO_END);
    m.setTrigger(this.sound, MARKER.OUTRO_END, { op: 'startSound', sound: stinger });
    m.setTrigger(this.sound, MARKER.OUTRO_END, { op: 'setParam', sound: stinger, param: 'transpose', value: key });
    m.setParam(this.sound, 'volume', this.theme.volume);
    m.fade(this.sound, 'speed', NORMAL_SPEED, 1);
    m.setHook(this.sound, HOOK.JUMP, JUMP.FINISH);
  }
}
