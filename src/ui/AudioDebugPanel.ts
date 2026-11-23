import { Vector3 } from 'three';
import type { SfxName } from '../audio/spatial/Sfx';
import type { SpatialOptions, WipeoutAudioEngine } from '../audio/spatial/WipeoutAudioEngine';
import type { Race } from '../race/Race';
import { TAP_COLORS } from '../render/AcousticRaysView';
import { posts, TUNNEL_WALL_MARGIN } from '../track/features';
import { createFrame } from '../track/Track';
import { hexColor } from './format';

const RADAR = 280;
/** Pixels par mètre sur le radar. */
const SCALE = 3.2;
const AHEAD = 60;
const BEHIND = 30;

const OPTION_LABELS: readonly (readonly [keyof SpatialOptions, string])[] = [
  ['reflections', 'Réflexions précoces'], ['reverb', 'Réverbération (tunnels)'], ['doppler', 'Doppler'], ['occlusion', 'Occlusion'],
];
const TRIGGERS: readonly (readonly [SfxName, string])[] = [
  ['speedPad', 'Speed pad'], ['plasma', 'Plasma'], ['missile', 'Missile'], ['collision', 'Collision'], ['scrape', 'Frottement'], ['shieldAlert', 'Alerte bouclier'],
];

/** Accès du panneau aux thèmes musicaux (banc d'essai des graines). */
export interface MusicBench {
  /** Circuit affiché, nom et style de son thème, graine (null = version écrite à la main), tempo. */
  current(): { circuit: string; name: string; style: string; seed: number | null; bpm: number; authored: boolean };
  /** Régénère le thème du circuit affiché avec cette graine (null = version écrite). */
  reseed(seed: number | null): void;
}

/**
 * Banc d'essai acoustique (touche F2) : interrupteurs pour comparer, réglage manuel du moteur,
 * déclenchement des bruitages, et radar vu de dessus des rayons réfléchis autour du joueur.
 */
export class AudioDebugPanel {
  private readonly root: HTMLElement;
  private readonly radar: CanvasRenderingContext2D;
  private readonly readout: HTMLElement;
  private readonly f = createFrame();
  private readonly fo = createFrame();
  private readonly v = new Vector3();
  private postsCache: { track: unknown; list: ReturnType<typeof posts> } | null = null;
  private frameCount = 0;

  private readonly musicInfo: HTMLElement;
  private readonly seedInput: HTMLInputElement;

  constructor(
    private readonly sfx: () => WipeoutAudioEngine | null,
    private readonly trigger: (name: SfxName) => void,
    private readonly music: MusicBench,
  ) {
    const root = (this.root = document.createElement('div'));
    root.id = 'audioDebug';
    root.className = 'panel';
    root.innerHTML = `
      <div class="ad-title">MUSIQUE <span>F2</span></div>
      <div class="ad-music">
        <div class="ad-music-info"></div>
        <div class="ad-buttons">
          <button data-seed="prev">◀</button>
          <input type="number" min="0" step="1" data-seed-input>
          <button data-seed="next">▶</button>
          <button data-seed="random">Hasard</button>
          <button data-seed="authored">Écrite</button>
        </div>
        <div class="ad-hint">Choisir une graine à l'oreille, puis la reporter dans <code>audio/score/themes.ts</code>.</div>
      </div>
      <div class="ad-title">ACOUSTIQUE</div>
      <div class="ad-options">${OPTION_LABELS.map(([k, l]) => `<label><input type="checkbox" data-opt="${k}" checked> ${l}</label>`).join('')}</div>
      <div class="ad-bench">
        <label><input type="checkbox" data-bench> Banc d'essai moteur (aussi au menu)</label>
        <label>Vitesse <input type="range" min="0" max="130" value="60" data-speed><output data-speed-out>60 %</output></label>
        <label>Aérofreins <input type="range" min="0" max="100" value="0" data-air><output data-air-out>0 %</output></label>
      </div>
      <div class="ad-buttons">${TRIGGERS.map(([n, l]) => `<button data-sfx="${n}">${l}</button>`).join('')}</div>
      <canvas width="${RADAR}" height="${RADAR}"></canvas>
      <div class="ad-legend">${(['left', 'right', 'up', 'postL'] as const).map((k) => `<span style="color:${hexColor(TAP_COLORS[k])}">■ ${{ left: 'mur gauche', right: 'mur droit', up: 'plafond', postL: 'poteaux' }[k]}</span>`).join('')}</div>
      <pre class="ad-readout"></pre>`;
    document.body.appendChild(root);
    this.radar = root.querySelector('canvas')!.getContext('2d')!;
    this.readout = root.querySelector('.ad-readout')!;
    this.musicInfo = root.querySelector('.ad-music-info')!;
    this.seedInput = root.querySelector('[data-seed-input]')!;
    const reseed = (seed: number | null) => {
      this.music.reseed(seed === null ? null : seed >>> 0);
      this.refreshMusic();
    };
    root.querySelectorAll<HTMLButtonElement>('[data-seed]').forEach((b) =>
      b.addEventListener('click', () => {
        const cur = this.music.current().seed ?? 0;
        const k = b.dataset.seed;
        if (k === 'prev') reseed(Math.max(0, cur - 1));
        else if (k === 'next') reseed(cur + 1);
        else if (k === 'random') reseed(Math.floor(Math.random() * 1e6));
        else reseed(null);
      }),
    );
    this.seedInput.addEventListener('change', () => reseed(Number(this.seedInput.value) || 0));

    root.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((box) =>
      box.addEventListener('change', () => {
        const s = this.sfx();
        if (s) s.options[box.dataset.opt as keyof SpatialOptions] = box.checked;
      }),
    );
    const bench = root.querySelector<HTMLInputElement>('[data-bench]')!;
    const speed = root.querySelector<HTMLInputElement>('[data-speed]')!;
    const air = root.querySelector<HTMLInputElement>('[data-air]')!;
    const sync = () => {
      const s = this.sfx();
      root.querySelector('[data-speed-out]')!.textContent = `${speed.value} %`;
      root.querySelector('[data-air-out]')!.textContent = `${air.value} %`;
      if (!s) return;
      s.manual.enabled = bench.checked;
      s.manual.speed = Number(speed.value) / 100;
      s.manual.airbrake = Number(air.value) / 100;
    };
    for (const el of [bench, speed, air]) el.addEventListener('input', sync);
    root.querySelectorAll<HTMLButtonElement>('[data-sfx]').forEach((b) => b.addEventListener('click', () => this.trigger(b.dataset.sfx as SfxName)));
    // les touches du jeu ne doivent pas agir sur les contrôles du panneau
    root.addEventListener('keydown', (e) => e.stopPropagation());
    this.visible = false;
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
    if (v) this.refreshMusic();
  }

  private refreshMusic(): void {
    const c = this.music.current();
    this.musicInfo.textContent = `${c.name} · ${c.style} · ${c.bpm} BPM · ${c.seed === null ? 'version écrite' : `graine ${c.seed}`}`;
    this.seedInput.value = c.seed === null ? '' : String(c.seed);
    this.root.querySelector<HTMLButtonElement>('[data-seed="authored"]')!.style.display = c.authored ? '' : 'none';
  }

  update(race: Race): void {
    const sfx = this.sfx();
    if (!this.visible || !sfx) return;
    this.drawRadar(race, sfx);
    if (this.frameCount++ % 6 === 0) this.writeReadout(race, sfx);
  }

  /** Vue de dessus dans le repère du joueur : murs, poteaux, sources, rayons réfléchis. */
  private drawRadar(race: Race, sfx: WipeoutAudioEngine): void {
    const g = this.radar;
    const track = race.track;
    const p = race.player;
    const f = track.frameAt(p.s, this.f);
    const origin = f.p.clone().addScaledVector(f.r, p.x);
    const cx = RADAR / 2;
    const cy = RADAR * 0.68;
    const toCanvas = (w: Vector3): [number, number] => {
      this.v.subVectors(w, origin);
      return [cx + this.v.dot(f.r) * SCALE, cy - this.v.dot(f.t) * SCALE];
    };
    g.fillStyle = 'rgba(5,3,14,0.92)';
    g.fillRect(0, 0, RADAR, RADAR);

    // murs (le long de la piste réelle) ; zone de tunnel grisée
    const world = sfx.worldFor(track);
    for (const side of [-1, 1]) {
      g.beginPath();
      for (let ds = -BEHIND; ds <= AHEAD; ds += 3) {
        const fr = track.frameAt(p.s + ds, this.fo);
        const tunnel = world.enclosure(p.s + ds) > 0.5;
        const wx = track.halfWidth + (tunnel ? TUNNEL_WALL_MARGIN : 0.15);
        const [a, b] = toCanvas(this.v.copy(fr.p).addScaledVector(fr.r, side * wx));
        if (ds === -BEHIND) g.moveTo(a, b);
        else g.lineTo(a, b);
      }
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      g.stroke();
    }
    for (let ds = -BEHIND; ds <= AHEAD; ds += 3) {
      const e = world.enclosure(p.s + ds);
      if (e < 0.05) continue;
      const fr = track.frameAt(p.s + ds, this.fo);
      const [a, b] = toCanvas(fr.p);
      g.fillStyle = `rgba(255,225,74,${0.12 * e})`;
      g.fillRect(a - track.halfWidth * SCALE, b - 1.6 * SCALE, 2 * track.halfWidth * SCALE, 3.2 * SCALE);
    }
    // poteaux
    if (this.postsCache?.track !== track) this.postsCache = { track, list: posts(track) };
    g.fillStyle = hexColor(TAP_COLORS.postL);
    for (const post of this.postsCache.list) {
      const ds = track.wrapDiff(post.s - p.s);
      if (ds < -BEHIND || ds > AHEAD) continue;
      const fr = track.frameAt(post.s, this.fo);
      const [a, b] = toCanvas(this.v.copy(fr.p).addScaledVector(fr.r, post.side * post.x));
      g.fillRect(a - 2, b - 2, 4, 4);
    }

    // rayons source → impact → auditeur, puis sources et auditeur
    const [lx, ly] = toCanvas(sfx.debug.listener);
    for (const v of sfx.debug.voices.values()) {
      if (!v.audible) continue;
      const [sx, sy] = toCanvas(v.position);
      if (Math.hypot(sx - cx, sy - cy) > RADAR) continue;
      for (const r of v.reflections) {
        if (r.gain < 0.01) continue;
        const [rx, ry] = toCanvas(r.point);
        g.strokeStyle = hexColor(TAP_COLORS[r.kind]);
        g.globalAlpha = Math.min(1, 0.3 + r.gain * 2);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(rx, ry);
        g.lineTo(lx, ly);
        g.stroke();
      }
      g.globalAlpha = 1;
      const ship = race.ships[v.id];
      g.fillStyle = hexColor(ship?.color ?? 0xffffff);
      g.beginPath();
      g.arc(sx, sy, v.isPlayer ? 5 : 4, 0, Math.PI * 2);
      g.fill();
      if (v.occlusion > 0.05) {
        g.strokeStyle = `rgba(255,60,60,${v.occlusion})`;
        g.lineWidth = 2;
        g.stroke();
      }
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(lx, ly - 6);
    g.lineTo(lx - 4, ly + 4);
    g.lineTo(lx + 4, ly + 4);
    g.fill();
  }

  private writeReadout(race: Race, sfx: WipeoutAudioEngine): void {
    const d = sfx.debug;
    const lines = [`Enfermement (auditeur) : ${(d.listenerEnclosure * 100).toFixed(0)} %`];
    const me = d.voices.get(race.ships.indexOf(race.player));
    if (me) {
      lines.push('Réflexions du joueur :');
      for (const r of me.reflections) {
        lines.push(`  ${r.kind.padEnd(6)} ${r.gain > 0.002 ? `${(r.delay * 1000).toFixed(1).padStart(5)} ms  g=${r.gain.toFixed(2)}` : '   —'}`);
      }
    }
    // concurrent audible le plus proche
    let best: { name: string; dist: number; doppler: number; occ: number } | null = null;
    for (const v of d.voices.values()) {
      if (v.isPlayer || !v.audible) continue;
      const dist = v.position.distanceTo(d.listener);
      if (!best || dist < best.dist) best = { name: race.ships[v.id]?.name ?? '?', dist, doppler: v.doppler, occ: v.occlusion };
    }
    if (best) {
      lines.push(`Plus proche : ${best.name} à ${best.dist.toFixed(0)} m`);
      lines.push(`  Doppler ×${best.doppler.toFixed(3)}   occlusion ${(best.occ * 100).toFixed(0)} %`);
    }
    this.readout.textContent = lines.join('\n');
  }
}
