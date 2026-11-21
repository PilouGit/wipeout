import { describe, expect, it } from 'vitest';
import { Fade } from '../src/audio/imuse/Fade';
import { GroupVolumes } from '../src/audio/imuse/GroupVolumes';
import { IMuse, LOOKAHEAD } from '../src/audio/imuse/IMuse';
import { TICKS_PER_BAR, type MusicOutput, type PartDef, type SoundFile } from '../src/audio/imuse/types';
import { ChunkBuilder } from '../src/audio/score/notation';

/** Sortie factice : horloge manuelle, enregistre les notes. */
class FakeOutput implements MusicOutput {
  t = 0;
  notes: { sound: number; part: string; time: number; note: number }[] = [];
  soundGains = new Map<number, number>();
  partGains = new Map<string, number>();
  now() { return this.t; }
  createSound() {}
  destroySound() {}
  note(sound: number, part: PartDef, time: number, note: number) { this.notes.push({ sound, part: part.name, time, note }); }
  setPartGain(sound: number, part: string, gain: number) { this.partGains.set(`${sound}:${part}`, gain); }
  setSoundGain(sound: number, gain: number) { this.soundGains.set(sound, gain); }
  controller() {}
  allNotesOff() {}
}

const PARTS: PartDef[] = [
  { name: 'hat', instrument: 'hat', volume: 100, drum: true },
  { name: 'lead', instrument: 'lead', volume: 100, enabled: false },
];

/** 120 BPM : une noire = 0,5 s, une mesure = 2 s. */
function testSong(id = 1): SoundFile {
  const a = new ChunkBuilder(0, 'A', 2);
  a.drums('hat', 'x...x...x...x...', { note: 40 });
  a.line('lead', 'C4 - - - - - - - - - - - - - - -');
  a.hookAtBars([0, 1], 'layer', 1, { type: 'parts', parts: { lead: true } });
  a.hookAtBars([0, 1], 'layer', 2, { type: 'parts', parts: { lead: false } });
  a.hookAtBars([1, 2], 'jump', 5, { type: 'jump', chunk: 1 });
  a.marker(TICKS_PER_BAR, 7);
  const b = new ChunkBuilder(1, 'B', 1).then(null);
  b.drums('hat', 'x...x...x...x...', { note: 70 });
  b.marker(b.length, 9);
  return { id, name: `song${id}`, bpm: 120, priority: 10, volume: 127, parts: PARTS, startChunk: 0, chunks: [a.build(), b.build()] };
}

function setup(...files: SoundFile[]) {
  const out = new FakeOutput();
  const imuse = new IMuse(out, files.length ? files : [testSong()]);
  /** Avance l'horloge jusqu'à `t` par pas de 25 ms, comme le setInterval du jeu. */
  const runTo = (t: number) => {
    while (out.t < t - 1e-9) {
      out.t = Math.min(t, out.t + 0.025);
      imuse.update();
    }
  };
  return { out, imuse, runTo };
}

const times = (out: FakeOutput, filter: (n: FakeOutput['notes'][number]) => boolean) =>
  out.notes.filter(filter).map((n) => Number(n.time.toFixed(4)));

describe('Fade (arithmétique entière à 60 Hz)', () => {
  it.each([[0, 127, 60], [127, 0, 45], [100, 37, 7], [10, 10, 5], [0, 3, 50]])('%i → %i en %i pas arrive exactement', (from, to, steps) => {
    const f = new Fade(1, 'volume', from, to, steps);
    const values: number[] = [];
    while (!f.finished) values.push(f.step());
    expect(values).toHaveLength(steps);
    expect(values.at(-1)).toBe(to);
    for (const v of values) expect(Number.isInteger(v)).toBe(true);
    // monotone
    const dir = Math.sign(to - from);
    for (let i = 1; i < values.length; i++) expect(Math.sign(values[i] - values[i - 1]) * dir).toBeGreaterThanOrEqual(0);
  });
});

describe('GroupVolumes', () => {
  it('applique la formule ((vol + 1) * master) >> 7', () => {
    const g = new GroupVolumes();
    expect(g.effective('music')).toBe(127);
    g.set('master', 64);
    expect(g.effective('music')).toBe(64);
    expect(g.set('music', 63)).toBe(127);
    expect(g.effective('music')).toBe(32);
    expect(g.set('music', -1)).toBe(63);
    expect(() => g.set('sfx', 200)).toThrow();
  });
});

describe('IMuse', () => {
  it('joue les notes au bon moment', () => {
    const { out, imuse, runTo } = setup();
    imuse.startSound(1);
    runTo(1.9);
    expect(times(out, (n) => n.part === 'hat')).toEqual([0, 0.5, 1, 1.5, 2]); // 2.0 est dans l'avance de planification
    expect(LOOKAHEAD).toBeGreaterThan(0.1);
  });

  it("n'active une partie qu'au hook suivant (frontière de phrase)", () => {
    const { out, imuse, runTo } = setup();
    imuse.startSound(1);
    runTo(0.3);
    imuse.setHook(1, 'layer', 1);
    runTo(3);
    const lead = times(out, (n) => n.part === 'lead');
    expect(lead[0]).toBe(2); // pas avant la mesure 1
  });

  it("ne saute qu'au point prévu, puis consomme la valeur du hook", () => {
    const { out, imuse, runTo } = setup();
    imuse.startSound(1);
    runTo(0.3);
    imuse.setHook(1, 'jump', 5);
    runTo(1.5);
    expect(imuse.position(1)?.chunk).toBe(0);
    runTo(2.5);
    expect(imuse.position(1)?.chunk).toBe(1);
    expect(imuse.getHook(1, 'jump')).toBe(0);
    // les notes de B commencent exactement à la frontière de mesure
    expect(times(out, (n) => n.note === 70)[0]).toBe(2);
    expect(times(out, (n) => n.note === 40).every((t) => t < 2)).toBe(true);
  });

  it('exécute les triggers au marqueur, une seule fois, calés sur le temps musical', () => {
    const other = { ...testSong(2), name: 'other' };
    const { out, imuse, runTo } = setup(testSong(1), other);
    imuse.startSound(1);
    imuse.setTrigger(1, 9, { op: 'startSound', sound: 2 });
    expect(imuse.checkTrigger(1, 9)).toBe(1);
    imuse.setHook(1, 'jump', 5);
    runTo(5);
    // A : mesure 0 (0-2 s), saut vers B (2-4 s), fin de B à 4 s → marqueur 9 → son 2 démarre à 4 s pile
    expect(imuse.isPlaying(1)).toBe(false);
    expect(imuse.isPlaying(2)).toBe(true);
    expect(times(out, (n) => n.sound === 2)[0]).toBe(4);
    expect(imuse.checkTrigger(1, 9)).toBe(0);
  });

  it('atteint un marqueur après un long silence écrit dans la partition', () => {
    const quiet = new ChunkBuilder(0, 'Q', 3).then(null);
    quiet.hit('hat', 0, 0, 40);
    quiet.marker(quiet.length, 9);
    const file: SoundFile = { ...testSong(1), chunks: [quiet.build()] };
    const { imuse, runTo } = setup(file, testSong(2));
    imuse.startSound(1);
    imuse.setTrigger(1, 9, { op: 'startSound', sound: 2 });
    runTo(6.3);
    expect(imuse.isPlaying(1)).toBe(false);
    expect(imuse.isPlaying(2)).toBe(true);
  });

  it('se recale au lieu de rattraper quand les mises à jour ont pris du retard', () => {
    const { out, imuse } = setup();
    imuse.startSound(1);
    out.t = 0.025;
    imuse.update();
    out.t = 3; // onglet en arrière-plan : 3 s sans mise à jour
    imuse.update();
    const late = out.notes.filter((n) => n.time < 2.9 && n.time > 0.2);
    expect(late).toHaveLength(0);
  });

  it('continue sans interruption à un marqueur sans trigger', () => {
    const { imuse, runTo } = setup();
    imuse.startSound(1);
    runTo(6);
    expect(imuse.isPlaying(1)).toBe(true);
    expect(imuse.position(1)?.chunk).toBe(0);
  });

  it('a un compteur de pause imbriqué et reprend là où il en était', () => {
    const { out, imuse, runTo } = setup();
    imuse.startSound(1);
    runTo(0.6);
    imuse.pause();
    imuse.pause();
    runTo(10);
    imuse.resume();
    expect(imuse.paused).toBe(true);
    runTo(20);
    imuse.resume();
    expect(imuse.paused).toBe(false);
    const before = out.notes.length;
    runTo(20.6);
    // la noire suivante (prévue à 1,0 s avant la pause) arrive 19,4 s plus tard
    const resumed = times(out, (n) => n.part === 'hat').slice(before > 0 ? 0 : 0);
    expect(resumed).toContain(20.4);
  });

  it("change le tempo avec le paramètre speed (128 = tel que composé)", () => {
    const { out, imuse, runTo } = setup();
    imuse.startSound(1);
    imuse.setParam(1, 'speed', 64);
    runTo(3);
    expect(times(out, (n) => n.part === 'hat').slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('exécute une commande différée une seule fois, et un fondu de volume va au bout', () => {
    const { out, imuse, runTo } = setup();
    imuse.startSound(1);
    imuse.deferCommand(0.5, { op: 'fade', sound: 1, param: 'volume', value: 0, seconds: 1 });
    runTo(0.4);
    expect(imuse.getParam(1, 'volume')).toBe(127);
    runTo(1.0);
    const mid = imuse.getParam(1, 'volume');
    expect(mid).toBeLessThan(127);
    expect(mid).toBeGreaterThan(0);
    runTo(3);
    expect(imuse.getParam(1, 'volume')).toBe(0);
    expect(out.soundGains.get(1)).toBe(0);
  });

  it('libère le son le moins prioritaire quand il n’y a plus de place', () => {
    const files = [1, 2, 3, 4, 5].map((id) => ({ ...testSong(id), priority: id * 10 }));
    const { imuse } = setup(...files);
    for (const id of [2, 3, 4, 5]) expect(imuse.startSound(id)).toBe(true);
    expect(imuse.startSound(1)).toBe(false); // trop faible
    expect(imuse.activeSounds()).toEqual([2, 3, 4, 5]);
  });
});
