/**
 * Modèle de données d'un moteur de musique interactive inspiré d'iMUSE
 * (cf. meshula/LabMidi — LabMuse/imuse-technical.md).
 *
 * - SoundFile : la partition statique (≈ « soundfile » MIDI + marqueurs).
 * - Chunk     : une séquence jouée d'un bloc (intro, boucle, transition, fin…).
 * - Part      : une partie instrumentale (≈ canal MIDI) activable, avec trim et transposition.
 * - Hook      : point de branchement conditionnel écrit dans la partition ; ne s'exécute
 *               que si la valeur posée par le jeu pour sa classe correspond à son id.
 * - Marker    : point de la partition où s'exécutent les commandes que le jeu a mises
 *               en file avec setTrigger (sinon la lecture continue sans interruption).
 */

/** Temps musical : 480 ticks par noire, mesures en 4/4. */
export const TICKS_PER_BEAT = 480;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;
/** Une double croche. */
export const TICKS_PER_STEP = TICKS_PER_BEAT / 4;

/** Vitesse « telle que composée » (iMUSE : MdSetSpeed, 128 = tempo d'origine). */
export const NORMAL_SPEED = 128;
export const MAX_VOLUME = 127;

export type InstrumentId =
  | 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'perc'
  | 'acid' | 'reese' | 'stab' | 'pad' | 'pluck' | 'lead'
  | 'riser' | 'impact' | 'alarm';

export interface PartDef {
  readonly name: string;
  readonly instrument: InstrumentId;
  /** Trim par défaut, 0..127. */
  readonly volume: number;
  /** -1 (gauche) .. 1 (droite) */
  readonly pan?: number;
  /** Partie active au lancement du son (avant tout hook). */
  readonly enabled?: boolean;
  /** Les batteries ignorent la transposition. */
  readonly drum?: boolean;
  readonly reverb?: number;
  readonly delay?: number;
}

export interface NoteEvent {
  readonly kind: 'note';
  readonly tick: number;
  readonly part: string;
  /** Numéro de note MIDI (60 = Do4). */
  readonly note: number;
  /** 1..127 */
  readonly velocity: number;
  /** Durée en ticks. */
  readonly duration: number;
  /** Glissando depuis la note précédente (basse acide). */
  readonly slide?: boolean;
}

export type HookAction =
  /** Saut vers une position musicale. sustain=false coupe les notes qui sonnent. */
  | { readonly type: 'jump'; readonly chunk: number; readonly tick?: number; readonly sustain?: boolean }
  /** Active/désactive des parties. */
  | { readonly type: 'parts'; readonly parts: Readonly<Record<string, boolean>> }
  | { readonly type: 'partTrim'; readonly part: string; readonly trim: number }
  /** Transposition du son entier, en demi-tons (absolue). */
  | { readonly type: 'transpose'; readonly semitones: number };

export interface HookEvent {
  readonly kind: 'hook';
  readonly tick: number;
  /** Classe du hook : chaque classe a sa propre valeur posée par le jeu. */
  readonly cls: string;
  /** 0 = s'exécute toujours ; sinon seulement si la valeur de la classe vaut cet id. */
  readonly id: number;
  readonly action: HookAction;
}

export interface MarkerEvent {
  readonly kind: 'marker';
  readonly tick: number;
  readonly id: number;
}

export type ScoreEvent = NoteEvent | HookEvent | MarkerEvent;

export interface Chunk {
  readonly id: number;
  readonly name: string;
  readonly bars: number;
  /** Longueur en ticks. */
  readonly length: number;
  /** Triés par tick ; à tick égal : marqueurs, puis hooks, puis notes. */
  readonly events: readonly ScoreEvent[];
  /** Chunk enchaîné à la fin ; lui-même = boucle ; null = fin du son. */
  readonly next: number | null;
}

export interface SoundFile {
  readonly id: number;
  readonly name: string;
  readonly bpm: number;
  /** Plus haut = prioritaire quand les voix manquent. */
  readonly priority: number;
  readonly volume: number;
  readonly parts: readonly PartDef[];
  readonly chunks: readonly Chunk[];
  readonly startChunk: number;
}

/** Paramètres « fadables » (ImFade). trim:<partie> = trim d'une partie. */
export type FadeParam = 'volume' | 'speed' | 'transpose' | `trim:${string}`;

/** Groupes de volume (bus) : master, sfx, music, musicDip (atténuation automatique). */
export type VolumeGroup = 'master' | 'sfx' | 'music' | 'musicDip';

/**
 * Commandes : appelables directement, différables dans le temps (deferCommand)
 * ou en attente d'un marqueur (setTrigger).
 */
export type Command =
  | { readonly op: 'startSound'; readonly sound: number; readonly chunk?: number }
  | { readonly op: 'stopSound'; readonly sound: number }
  | { readonly op: 'stopAllSounds' }
  | { readonly op: 'setHook'; readonly sound: number; readonly cls: string; readonly value: number }
  | { readonly op: 'jump'; readonly sound: number; readonly chunk: number; readonly tick?: number; readonly sustain?: boolean }
  | { readonly op: 'scan'; readonly sound: number; readonly chunk: number; readonly tick: number }
  | { readonly op: 'fade'; readonly sound: number; readonly param: FadeParam; readonly value: number; readonly seconds: number }
  | { readonly op: 'setParam'; readonly sound: number; readonly param: FadeParam; readonly value: number }
  | { readonly op: 'sendMessage'; readonly sound: number; readonly part: string; readonly controller: number; readonly value: number }
  | { readonly op: 'setGroupVol'; readonly group: VolumeGroup; readonly volume: number };

/** Position musicale lisible (mesure, temps, tick dans le temps). */
export interface MusicalPosition {
  readonly chunk: number;
  readonly measure: number;
  readonly beat: number;
  readonly tick: number;
}

/**
 * Sortie audio du moteur. Séparée pour que le séquenceur soit testable sans Web Audio.
 * Tous les temps sont en secondes dans l'horloge de la sortie.
 */
export interface MusicOutput {
  now(): number;
  createSound(soundId: number, file: SoundFile): void;
  destroySound(soundId: number, time: number): void;
  note(soundId: number, part: PartDef, time: number, note: number, velocity: number, duration: number, slide: boolean): void;
  setPartGain(soundId: number, part: string, gain: number, time: number): void;
  setSoundGain(soundId: number, gain: number, time: number): void;
  controller(soundId: number, part: string, controller: number, value: number, time: number): void;
  allNotesOff(soundId: number, time: number): void;
}

/** Contrôleur MIDI « brillance » (CC74), lu par les synthés filtrés. */
export const CC_BRIGHTNESS = 74;
