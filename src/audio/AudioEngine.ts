import { LITE } from '../core/device';
import { IMuse } from './imuse/IMuse';
import { WebAudioOutput } from './imuse/WebAudioOutput';
import { SOUNDTRACK } from './score';
import { WipeoutAudioEngine } from './spatial/WipeoutAudioEngine';

const MASTER_VOLUME = 0.55;
const MUSIC_TICK_MS = 25;

/**
 * Point d'entrée audio du jeu. Le contexte Web Audio n'existe qu'après init() (politique
 * d'autoplay) ; d'ici là `sfx` et `imuse` valent null. Aucun fichier audio : tout est synthétisé.
 * - `sfx` : moteurs, bruitages, spatialisation 3D et acoustique des circuits
 * - `imuse` : musique interactive
 */
export class AudioEngine {
  imuse: IMuse | null = null;
  sfx: WipeoutAudioEngine | null = null;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private _muted = false;

  /** À appeler suite à une action utilisateur (politique d'autoplay des navigateurs). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : MASTER_VOLUME;
    this.master.connect(ctx.destination);
    this.sfx = new WipeoutAudioEngine(ctx, this.master, LITE);
    const music = new GainNode(ctx, { gain: 0.85 });
    music.connect(this.master);
    const imuse = (this.imuse = new IMuse(new WebAudioOutput(ctx, music), SOUNDTRACK));
    setInterval(() => imuse.update(), MUSIC_TICK_MS);
  }

  /** Le contexte joue réellement (sur iOS il peut rester suspendu après le premier geste). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : MASTER_VOLUME;
  }
}
