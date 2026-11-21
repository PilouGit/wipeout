import { describe, expect, it } from 'vitest';
import { IMuse } from '../src/audio/imuse/IMuse';
import type { HookEvent, MusicOutput, PartDef } from '../src/audio/imuse/types';
import { HOOK, JUMP, MAIN, MARKER, SOUND, SOUNDTRACK } from '../src/audio/score';
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

describe('notation', () => {
  it('convertit les noms de notes', () => {
    expect(noteNumber('C4')).toBe(60);
    expect(noteNumber('F2')).toBe(41);
    expect(noteNumber('Ab3')).toBe(56);
    expect(noteNumber('Bb0')).toBe(22);
    expect(() => noteNumber('H2')).toThrow();
  });
});

describe('partition', () => {
  it.each(SOUNDTRACK.map((f) => [f.name, f] as const))('%s est cohérente', (_name, file) => {
    const ids = new Set(file.chunks.map((c) => c.id));
    const parts = new Set(file.parts.map((p) => p.name));
    expect(ids.has(file.startChunk)).toBe(true);
    for (const c of file.chunks) {
      if (c.next !== null) expect(ids.has(c.next), `${c.name}.next`).toBe(true);
      for (const ev of c.events) {
        expect(ev.tick).toBeLessThanOrEqual(c.length);
        if (ev.kind === 'note') {
          expect(parts.has(ev.part), `${c.name}: partie ${ev.part}`).toBe(true);
          expect(ev.tick).toBeLessThan(c.length);
        }
        if (ev.kind === 'hook') {
          if (ev.action.type === 'jump') expect(ids.has(ev.action.chunk)).toBe(true);
          if (ev.action.type === 'parts') for (const p of Object.keys(ev.action.parts)) expect(parts.has(p), p).toBe(true);
        }
      }
    }
  });

  it('chaque section de course peut rejoindre l’outro à chaque mesure', () => {
    const main = SOUNDTRACK.find((s) => s.id === SOUND.MAIN)!;
    for (const id of [MAIN.GRID, MAIN.CRUISE, MAIN.FILL_UP, MAIN.DRIVE, MAIN.BREAKDOWN, MAIN.FILL_FINAL, MAIN.FINAL]) {
      const chunk = main.chunks.find((c) => c.id === id)!;
      const finishHooks = chunk.events.filter((e): e is HookEvent => e.kind === 'hook' && e.cls === HOOK.JUMP && e.id === JUMP.FINISH);
      expect(finishHooks, chunk.name).toHaveLength(chunk.bars);
    }
  });
});

describe('Neon Ridge piloté comme dans le jeu', () => {
  function play() {
    const out = new Out();
    const imuse = new IMuse(out, SOUNDTRACK);
    const runTo = (t: number) => {
      while (out.t < t) {
        out.t += 0.025;
        imuse.update();
      }
    };
    const chunk = () => imuse.position(SOUND.MAIN)?.chunk;
    return { out, imuse, runTo, chunk };
  }

  const BAR = (4 * 60) / 138;

  it("parcourt grille → croisière → montée → final → outro → jingle de victoire", () => {
    const { out, imuse, runTo, chunk } = play();
    imuse.startSound(SOUND.MAIN, MAIN.GRID);
    imuse.setHook(SOUND.MAIN, HOOK.LAYER, 1);
    runTo(1);
    expect(chunk()).toBe(MAIN.GRID);

    // « GO » : départ au temps suivant (≤ une noire)
    const go = out.t;
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.CRUISE);
    runTo(go + 60 / 138 + 0.2);
    expect(chunk()).toBe(MAIN.CRUISE);

    // intensité : saut en fin de phrase (≤ 4 mesures) via le roulement FILL_UP
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.DRIVE);
    runTo(out.t + 4 * BAR + 0.2);
    expect([MAIN.FILL_UP, MAIN.DRIVE]).toContain(chunk());
    runTo(out.t + BAR + 0.2);
    expect(chunk()).toBe(MAIN.DRIVE);

    // dernier tour : modulation d'un ton écrite à la fin de FILL_FINAL
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.FINAL);
    runTo(out.t + 5 * BAR + 0.5);
    expect(chunk()).toBe(MAIN.FINAL);
    expect(imuse.getParam(SOUND.MAIN, 'transpose')).toBe(2);

    // arrivée : saut vers l'outro à la mesure suivante, jingle au marqueur de fin
    imuse.setTrigger(SOUND.MAIN, MARKER.OUTRO_END, { op: 'startSound', sound: SOUND.VICTORY });
    imuse.setHook(SOUND.MAIN, HOOK.JUMP, JUMP.FINISH);
    runTo(out.t + BAR + 0.2);
    expect(chunk()).toBe(MAIN.OUTRO);
    runTo(out.t + 2 * BAR + 0.3);
    expect(imuse.isPlaying(SOUND.MAIN)).toBe(false);
    expect(imuse.isPlaying(SOUND.VICTORY)).toBe(true);
    // le jingle commence pile à la fin de l'outro
    const lastMain = Math.max(...out.notes.filter((n) => n.sound === SOUND.MAIN).map((n) => n.time));
    const firstVictory = Math.min(...out.notes.filter((n) => n.sound === SOUND.VICTORY).map((n) => n.time));
    expect(firstVictory).toBeGreaterThan(lastMain);
  });

  it("l'orchestration suit les hooks LAYER", () => {
    const { out, imuse, runTo } = play();
    imuse.startSound(SOUND.MAIN, MAIN.CRUISE);
    imuse.setHook(SOUND.MAIN, HOOK.LAYER, 1);
    runTo(2 * BAR - 0.3);
    const quiet = new Set(out.notes.map((n) => n.part));
    expect(quiet.has('acid')).toBe(false);
    expect(quiet.has('break')).toBe(true);
    imuse.setHook(SOUND.MAIN, HOOK.LAYER, 4);
    runTo(4 * BAR - 0.3);
    const full = new Set(out.notes.filter((n) => n.time >= 2 * BAR - 1e-6).map((n) => n.part));
    for (const p of ['acid', 'stab', 'arp', 'perc', 'clap']) expect(full.has(p), p).toBe(true);
  });
});
