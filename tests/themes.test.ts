import { describe, expect, it } from 'vitest';
import { IMuse } from '../src/audio/imuse/IMuse';
import type { MusicOutput, NoteEvent, PartDef, SoundFile } from '../src/audio/imuse/types';
import { buildThemes, DEFAULT_THEMES, DRAGON, HOOK, JUMP, MAIN, MARKER, SOUND, STINGERS } from '../src/audio/score';
import { generateMaterial, generateTheme } from '../src/audio/score/generator';
import { noteNumber } from '../src/audio/score/notation';

class Out implements MusicOutput {
  t = 0;
  notes: { sound: number; part: string; time: number }[] = [];
  now() { return this.t; }
  createSound() {}
  destroySound() {}
  note(sound: number, part: PartDef, time: number) { this.notes.push({ sound, part: part.name, time }); }
  setPartGain() {}
  setSoundGain() {}
  controller() {}
  allNotesOff() {}
}

function play(theme: SoundFile) {
  const out = new Out();
  const imuse = new IMuse(out, [theme, ...STINGERS]);
  const runTo = (t: number) => {
    while (out.t < t) {
      out.t += 0.025;
      imuse.update();
    }
  };
  return { out, imuse, runTo, chunk: () => imuse.position(theme.id)?.chunk, BAR: (4 * 60) / theme.bpm };
}

const notes = (f: SoundFile, part?: string) =>
  f.chunks.flatMap((c) => c.events.filter((e): e is NoteEvent => e.kind === 'note' && (!part || e.part === part)));

const recipe = (seed: number) => ({ id: 20, name: 'Test', seed, style: 'breakbeat' as const });

describe('thèmes générés', () => {
  it('une graine donne toujours le même morceau', () => {
    expect(generateTheme(recipe(42))).toEqual(generateTheme(recipe(42)));
  });

  it('deux graines donnent deux morceaux différents', () => {
    const fingerprint = (seed: number) => {
      const m = generateMaterial(recipe(seed));
      return JSON.stringify([m.bpm, m.chords, m.lead, m.acidA, m.drums]);
    };
    const prints = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(fingerprint));
    expect(prints.size).toBe(8);
  });

  it('chaque circuit a son propre thème, distinct des autres', () => {
    expect([...DEFAULT_THEMES.keys()]).toEqual(['neon', 'glacier', 'magma', 'selene']);
    const ids = new Set([...DEFAULT_THEMES.values()].map((t) => t.id));
    expect(ids.size).toBe(4);
    const leads = new Set([...DEFAULT_THEMES.values()].map((t) => JSON.stringify(notes(t, 'lead').slice(0, 24).map((n) => n.note))));
    expect(leads.size).toBe(4);
    const bpms = [...DEFAULT_THEMES.values()].map((t) => t.bpm);
    expect(new Set(bpms).size).toBeGreaterThan(2);
  });

  it('une graine imposée régénère tous les circuits, de façon reproductible', () => {
    const a = buildThemes(1234);
    const b = buildThemes(1234);
    const c = buildThemes(99);
    expect(a.get('neon')!.name).toBe('Neon Ridge');
    expect(a.get('neon')).toEqual(b.get('neon'));
    expect(a.get('neon')).not.toEqual(c.get('neon'));
    expect(a.get('neon')).not.toBe(DEFAULT_THEMES.get('neon'));
  });

  it.each([1, 7, 31337, 0xdeadbeef])('graine %i : notes dans des registres jouables', (seed) => {
    for (const style of ['breakbeat', 'trance', 'industrial', 'space'] as const) {
      const f = generateTheme({ ...recipe(seed), style });
      for (const n of notes(f)) {
        expect(n.note).toBeGreaterThanOrEqual(20);
        expect(n.note).toBeLessThanOrEqual(100);
      }
      for (const n of notes(f, 'lead')) {
        expect(n.note).toBeGreaterThanOrEqual(60);
        expect(n.note).toBeLessThanOrEqual(90);
      }
      expect(notes(f, 'dragon').length).toBeGreaterThan(0);
      expect(f.bpm).toBeGreaterThanOrEqual(130);
      expect(f.bpm).toBeLessThanOrEqual(170);
    }
  });

  it('la mélodie et les accords restent dans la gamme du morceau', () => {
    const m = generateMaterial(recipe(5));
    const chordPcs = new Set(Object.values(m.chords).flat().map((n) => noteNumber(n) % 12));
    const leadPcs = new Set(m.lead.join(' ').split(/\s+/).filter((t) => /^[A-G]/.test(t)).map((t) => noteNumber(t) % 12));
    // 7 notes de gamme + la sensible de la dominante au plus
    expect(new Set([...chordPcs, ...leadPcs]).size).toBeLessThanOrEqual(8);
  });
});

describe('mélodies générées', () => {
  const onsets = (barText: string) => barText.split(/\s+/).flatMap((t, i) => (/^[A-G]/.test(t) ? [i] : []));
  const notesOf = (barText: string) => barText.split(/\s+/).filter((t) => /^[A-G]/.test(t)).map((t) => noteNumber(t));

  it.each([3, 17, 256, 9001])('graine %i : un motif répété et varié, des cadences, l’accord sur les temps forts', (seed) => {
    const m = generateMaterial(recipe(seed));
    const L = m.lead;
    // A A' … A A'' : même rythme
    expect(onsets(L[1])).toEqual(onsets(L[0]));
    expect(onsets(L[4])).toEqual(onsets(L[0]));
    expect(onsets(L[5])).toEqual(onsets(L[0]));
    // cadences : blanche pointée, croche, blanche pointée
    expect(onsets(L[3])).toEqual([0, 6, 8]);
    expect(onsets(L[7])).toEqual([0, 6, 8]);
    // temps forts sur les notes de l'accord de la mesure
    m.progression.forEach(([chord], b) => {
      const pcs = new Set(m.chords[chord].map((n) => noteNumber(n) % 12));
      const tokens = L[b].split(/\s+/);
      for (let i = 0; i < 16; i += 4) if (/^[A-G]/.test(tokens[i])) expect(pcs.has(noteNumber(tokens[i]) % 12), `mesure ${b}, pas ${i}`).toBe(true);
    });
    // la phrase finit sur la sensible (tierce de la dominante), qui appelle la tonique
    const dom = m.chords[m.progression[7][0]].map(noteNumber);
    expect(notesOf(L[7]).at(-1)! % 12).toBe(dom[1] % 12);
    // pas de grands sauts : intervalle médian ≤ une tierce
    const all = L.flatMap(notesOf);
    const jumps = all.slice(1).map((n, i) => Math.abs(n - all[i])).sort((x, y) => x - y);
    expect(jumps[Math.floor(jumps.length / 2)]).toBeLessThanOrEqual(4);
  });
});

describe.each([...DEFAULT_THEMES.entries()])('thème de %s piloté comme dans le jeu', (_circuit, theme) => {
  it('parcourt grille → croisière → montée → final → outro → jingle', () => {
    const { out, imuse, runTo, chunk, BAR } = play(theme);
    const S = theme.id;
    imuse.startSound(S, MAIN.GRID);
    imuse.setHook(S, HOOK.LAYER, 1);
    runTo(1);
    imuse.setHook(S, HOOK.JUMP, JUMP.CRUISE);
    runTo(out.t + BAR / 4 + 0.2);
    expect(chunk()).toBe(MAIN.CRUISE);
    imuse.setHook(S, HOOK.JUMP, JUMP.DRIVE);
    runTo(out.t + 5 * BAR + 0.3);
    expect(chunk()).toBe(MAIN.DRIVE);
    imuse.setHook(S, HOOK.JUMP, JUMP.FINAL);
    runTo(out.t + 5 * BAR + 0.5);
    expect(chunk()).toBe(MAIN.FINAL);
    expect(imuse.getParam(S, 'transpose')).toBeGreaterThan(0);
    imuse.setTrigger(S, MARKER.OUTRO_END, { op: 'startSound', sound: SOUND.VICTORY });
    imuse.setHook(S, HOOK.JUMP, JUMP.FINISH);
    runTo(out.t + 3 * BAR + 0.5);
    expect(imuse.isPlaying(S)).toBe(false);
    expect(imuse.isPlaying(SOUND.VICTORY)).toBe(true);
  });

  it('le rugissement des dragons entre et sort à la mesure (hook DRAGON)', () => {
    const { out, imuse, runTo, BAR } = play(theme);
    const S = theme.id;
    imuse.startSound(S, MAIN.CRUISE);
    imuse.setHook(S, HOOK.LAYER, 2);
    imuse.setHook(S, HOOK.DRAGON, DRAGON.OFF);
    runTo(2 * BAR - 0.3);
    const roar = () => out.notes.filter((n) => n.part === 'dragon' || n.part === 'dragonhit');
    expect(roar()).toHaveLength(0);

    // les dragons jaillissent au milieu de la mesure 2 : le rugissement attend la mesure 3
    runTo(2.5 * BAR);
    imuse.setHook(S, HOOK.DRAGON, DRAGON.ON);
    runTo(4 * BAR - 0.3);
    const on = roar();
    expect(on.length).toBeGreaterThan(0);
    const first = Math.min(...on.map((n) => n.time));
    expect(first).toBeGreaterThanOrEqual(3 * BAR - 1e-6);
    expect(first).toBeLessThan(3 * BAR + 0.05);

    // ils replongent : silence à partir de la mesure suivante
    imuse.setHook(S, HOOK.DRAGON, DRAGON.OFF);
    runTo(6 * BAR - 0.3);
    expect(roar().filter((n) => n.time >= 5 * BAR - 1e-6)).toHaveLength(0);
  });
});
