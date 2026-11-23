import { describe, expect, it } from 'vitest';
import { MAX_QUALITY_DROP, PerformanceMonitor } from '../src/game/Performance';

const run = (m: PerformanceMonitor, seconds: number, fps: number) => {
  for (let t = 0; t < seconds; t += 1 / fps) m.frame(1 / fps);
};

describe('qualité adaptative', () => {
  it('ne touche à rien à 60 images/s', () => {
    const drops: number[] = [];
    const m = new PerformanceMonitor((l) => drops.push(l));
    run(m, 30, 60);
    expect(drops).toEqual([]);
    expect(m.avgMs).toBeCloseTo(1000 / 60, 0);
  });

  it('ignore les à-coups du démarrage (compilation des shaders)', () => {
    const drops: number[] = [];
    const m = new PerformanceMonitor((l) => drops.push(l));
    run(m, 4, 20);
    run(m, 20, 60);
    expect(drops).toEqual([]);
  });

  it('baisse d’un palier à la fois, en laissant chaque palier faire ses preuves, jusqu’au dernier', () => {
    const drops: { level: number; t: number }[] = [];
    let t = 0;
    const m = new PerformanceMonitor((level) => drops.push({ level, t }));
    for (; t < 60; t += 1 / 30) m.frame(1 / 30);
    expect(drops.map((d) => d.level)).toEqual([1, 2, 3]);
    for (let i = 1; i < drops.length; i++) expect(drops[i].t - drops[i - 1].t).toBeGreaterThan(4);
    expect(m.drop).toBe(MAX_QUALITY_DROP);
  });

  it('s’arrête dès que la cadence est tenue', () => {
    const drops: number[] = [];
    const m = new PerformanceMonitor((l) => drops.push(l));
    run(m, 9, 30); // baisse vers 8 s (5 s de démarrage + 3 s de mesure)
    run(m, 30, 60); // le palier 1 suffit
    expect(drops).toEqual([1]);
  });

  it('`?qualite=max` : mesure sans jamais baisser', () => {
    const drops: number[] = [];
    const m = new PerformanceMonitor((l) => drops.push(l), false);
    run(m, 30, 20);
    expect(drops).toEqual([]);
    expect(m.avgMs).toBeCloseTo(50, 0);
  });
});
