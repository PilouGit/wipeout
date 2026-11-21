import type { AudioEngine } from '../audio/AudioEngine';
import type { IMuse } from '../audio/imuse/IMuse';
import { CC_BRIGHTNESS, NORMAL_SPEED } from '../audio/imuse/types';
import { HOOK, JUMP, MAIN, MARKER, SOUND, TENSION, type MainChunk } from '../audio/score';
import { NEON_RIDGE } from '../audio/score/neonRidge';
import { clamp } from '../core/math';
import type { Race } from '../race/Race';

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
const LEVEL_HOLD = 3;
const LOW_MOMENTUM_DELAY = 2.5;
const FINAL_LAP_SPEED = 134;

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
  private finalSpeedSet = false;

  constructor(private readonly audio: AudioEngine, private readonly race: Race) {
    const player = race.player;
    race.events.on('shipHit', ({ ship, shielded }) => ship === player && !shielded && this.duck());
    race.events.on('finish', ({ ship, position }) => ship === player && this.end(position <= 3));
    race.events.on('eliminated', ({ ship }) => ship === player && this.end(false));
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
    this.finalSpeedSet = false;
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
  }

  // ------------------------------------------------------------------ internes

  private launch(m: IMuse): void {
    this.launched = true;
    if (this.mode === 'menu') {
      m.stopAllSounds();
      m.startSound(SOUND.MAIN, MAIN.INTRO);
      return;
    }
    if (this.mode !== 'race') return;
    // Depuis le menu, l'intro rejoint la grille à la prochaine mesure (hook GRID) ;
    // sinon (relance, résultats) on repart directement de la grille.
    const pos = m.position(SOUND.MAIN);
    if (!pos || SECTION_OF[pos.chunk as MainChunk] !== 'INTRO') {
      m.stopAllSounds();
      m.startSound(SOUND.MAIN, MAIN.GRID);
    } else {
      m.stopSound(SOUND.VICTORY);
      m.stopSound(SOUND.DEFEAT);
    }
    m.setParam(SOUND.MAIN, 'speed', NORMAL_SPEED);
    m.setParam(SOUND.MAIN, 'volume', NEON_RIDGE.volume);
    m.setHook(SOUND.MAIN, HOOK.LAYER, 1);
    m.setHook(SOUND.MAIN, HOOK.TENSION, TENSION.OFF);
  }

  /** Calcule l'état souhaité et le pose dans les hooks ; appelé à chaque image. */
  private steer(m: IMuse, dt: number): void {
    const pos = m.position(SOUND.MAIN);
    if (!pos) return;
    const r = this.race;
    const p = r.player;
    const racing = r.phase === 'racing';
    const speedRatio = clamp(p.speed / p.perf.vmax, 0, 1.3);

    // Intensité : vitesse, rang, adversaires proches, boost
    const rank = 1 - (r.position(p) - 1) / (r.ships.length - 1);
    const near = r.ships.filter((o) => o !== p && !o.dead && Math.abs(r.track.wrapDiff(o.s - p.s)) < 60).length;
    const target = racing ? 0.45 * Math.min(1, speedRatio) + 0.3 * rank + 0.25 * Math.min(1, near / 2) + (p.boostTime > 0 ? 0.15 : 0) : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.8);

    // Niveau d'orchestration avec hystérésis : un changement doit être franc et durable
    this.levelHeld += dt;
    const raw = 1 + Math.floor(clamp(this.intensity, 0, 0.999) * 4);
    const center = (this.level - 0.5) / 4;
    if (raw !== this.level && this.levelHeld > LEVEL_HOLD && Math.abs(this.intensity - center) > 0.16) {
      this.level = raw;
      this.levelHeld = 0;
    }
    m.setHook(SOUND.MAIN, HOOK.LAYER, this.level);
    m.setHook(SOUND.MAIN, HOOK.TENSION, p.energy < 30 ? TENSION.ON : TENSION.OFF);

    // Perte d'élan (gros choc, contresens, arrêt) → respiration musicale
    const stalled = racing && (speedRatio < 0.35 || Math.cos(p.psi) < 0);
    this.lowMomentum = stalled ? this.lowMomentum + dt : speedRatio > 0.5 ? 0 : this.lowMomentum;

    let desired: Section;
    if (r.phase === 'countdown') desired = 'GRID';
    else if (p.lapsDone >= r.laps - 1) desired = 'FINAL';
    else if (this.lowMomentum > LOW_MOMENTUM_DELAY) desired = 'BREAKDOWN';
    else desired = this.level >= 3 ? 'DRIVE' : 'CRUISE';

    const current = SECTION_OF[pos.chunk as MainChunk];
    m.setHook(SOUND.MAIN, HOOK.JUMP, desired === current ? 0 : JUMP_VALUE[desired] ?? 0);

    // Dernier tour : le tempo monte légèrement (MdSetSpeed via un fondu)
    if (current === 'FINAL' && !this.finalSpeedSet) {
      this.finalSpeedSet = true;
      m.fade(SOUND.MAIN, 'speed', FINAL_LAP_SPEED, 6);
    }

    // Brillance des synthés liée à la vitesse (contrôleur MIDI, comme MdSendMessage)
    this.ccTimer -= dt;
    if (this.ccTimer <= 0) {
      this.ccTimer = CC_INTERVAL;
      const value = Math.round(clamp(36 + 80 * Math.min(1, speedRatio) + (p.boostTime > 0 ? 20 : 0), 0, 127));
      for (const part of BRIGHT_PARTS) m.execute({ op: 'sendMessage', sound: SOUND.MAIN, part, controller: CC_BRIGHTNESS, value });
    }
  }

  /** Touché : la musique « encaisse » puis revient (fondu immédiat + fondu différé). */
  private duck(): void {
    const m = this.audio.imuse;
    if (!m || this.mode !== 'race') return;
    m.fade(SOUND.MAIN, 'volume', 64, 0.08);
    m.deferCommand(0.5, { op: 'fade', sound: SOUND.MAIN, param: 'volume', value: NEON_RIDGE.volume, seconds: 1.5 });
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
    if (!m.isPlaying(SOUND.MAIN)) {
      m.startSound(stinger);
      return;
    }
    const key = m.getParam(SOUND.MAIN, 'transpose');
    m.clearTrigger(SOUND.MAIN, MARKER.OUTRO_END);
    m.setTrigger(SOUND.MAIN, MARKER.OUTRO_END, { op: 'startSound', sound: stinger });
    m.setTrigger(SOUND.MAIN, MARKER.OUTRO_END, { op: 'setParam', sound: stinger, param: 'transpose', value: key });
    m.setParam(SOUND.MAIN, 'volume', NEON_RIDGE.volume);
    m.fade(SOUND.MAIN, 'speed', NORMAL_SPEED, 1);
    m.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.FINISH);
  }
}
