/**
 * Banc de charge du thread audio : ouvrir /bench/audio.html sur le serveur de dev (`?lite` pour le mode allégé).
 * Rend 20 s de musique (Neon Ridge en DRIVE, toutes couches) hors temps réel et mesure
 * temps de calcul / durée audio (au-delà de ~25 % sur ordinateur, un téléphone décroche)
 * et le niveau crête en sortie (> 1 : saturation numérique).
 */
import { IMuse } from '../src/audio/imuse/IMuse';
import { MusicPulse } from '../src/audio/imuse/MusicPulse';
import { WebAudioOutput } from '../src/audio/imuse/WebAudioOutput';
import { HOOK, MAIN, SOUND } from '../src/audio/score';
import { NEON_RIDGE } from '../src/audio/score/neonRidge';
import { WipeoutAudioEngine, type SourceState } from '../src/audio/spatial/WipeoutAudioEngine';
import { TRACK_HALF_WIDTH } from '../src/config';
import { CIRCUITS } from '../src/track/circuits';
import { Track } from '../src/track/Track';
import { Vector3 } from 'three';

const track = new Track(CIRCUITS[0].layout, TRACK_HALF_WIDTH);

const SECONDS = 20;

async function run(): Promise<string> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 48000 * SECONDS, sampleRate: 48000 });
  const q = new URLSearchParams(location.search);
  if (q.has('noreverb')) (ctx as any).createConvolver = () => ctx.createGain();
  if (q.has('noosc')) { const o = ctx.createOscillator.bind(ctx); (ctx as any).createOscillator = () => { const n = o(); n.connect = ((d: any) => d) as any; return n; }; }
  if (q.get('sfx') === 'only') q.set('only', '__none__');
  const only = q.get('only');
  let t = 0;
  class Clocked extends WebAudioOutput {
    override now(): number { return t; }
    override note(...a: Parameters<WebAudioOutput['note']>): void {
      if (!only || a[1].name === only) super.note(...a);
    }
  }
  const master = new GainNode(ctx, { gain: 0.55 });
  master.connect(ctx.destination);
  const music = new GainNode(ctx, { gain: 0.85 });
  music.connect(master);
  const imuse = new IMuse(new MusicPulse(new Clocked(ctx as unknown as AudioContext, music, q.has('lite') ? 1.6 : 2.8)), [NEON_RIDGE]);
  const sfxMode = q.get('sfx'); // null : musique seule · 'only' : moteurs seuls · autre : les deux
  const lite = q.has('lite');
  const sfx = sfxMode !== null ? new WipeoutAudioEngine(ctx as unknown as AudioContext, master, lite) : null;
  const ships = Array.from({ length: 8 }, (_, i) => ({
    id: i, s: 40 + i * 25, x: (i % 3) - 1, lift: 0.6, position: new Vector3(), velocity: new Vector3(),
    speed: 0.9, thrust: 1, airbrake: i % 4 === 1 ? 0.5 : 0, active: true, isPlayer: i === 0,
  }));
  const listener = { position: new Vector3(), forward: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0), s: 0 };
  const moveShips = (dt: number): void => {
    for (const sh of ships) {
      const before = sh.position.clone();
      sh.s = track.mod(sh.s + 95 * dt * (1 + sh.id * 0.01));
      track.pointAt(sh.s, sh.x, sh.lift, sh.position);
      sh.velocity.subVectors(sh.position, before).divideScalar(dt);
    }
    track.pointAt(ships[0].s - 8, 0, 3, listener.position);
    listener.forward.subVectors(ships[0].position, listener.position).normalize();
    listener.s = ships[0].s;
    sfx!.update({ track, listener, sources: ships as SourceState[], dt });
  };
  imuse.startSound(SOUND.MAIN, MAIN.DRIVE);
  imuse.setHook(SOUND.MAIN, HOOK.LAYER, 4);
  // planification au fil du rendu, comme en jeu (LOOKAHEAD d'avance) : rendu suspendu toutes les 50 ms
  const STEP = (128 * 6) / 48000; // ~16 ms, aligné sur les blocs de rendu
  let ms = 0;
  let mark = 0;
  for (let k = 1; k * STEP < SECONDS; k++) {
    void ctx.suspend(k * STEP).then(() => {
      ms += performance.now() - mark;
      t = k * STEP;
      imuse.update();
      if (sfx) moveShips(STEP);
      mark = performance.now();
      void ctx.resume();
    });
  }
  imuse.update();
  mark = performance.now();
  const buf = await ctx.startRendering();
  ms += performance.now() - mark;
  let peak = 0, over = 0;
  for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) { const a = Math.abs(v); if (a > peak) peak = a; if (a > 1) over++; }
  return `charge ${(ms / 10 / SECONDS).toFixed(1)} % (${ms.toFixed(0)} ms pour ${SECONDS} s) · crête ${peak.toFixed(2)} · échantillons > 1 : ${over}`;
}

const lines: string[] = [];
for (let i = 0; i < 1; i++) lines.push(await run());
document.getElementById('out')!.textContent = lines.join('\n');
