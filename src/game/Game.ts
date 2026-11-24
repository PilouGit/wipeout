import { type Object3D, Vector3 } from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { DIFFICULTIES, HOVER_HEIGHT, PHYSICS_STEP, SHIP_HALF_WIDTH, TRACK_HALF_WIDTH } from '../config';
import { TOUCH } from '../core/device';
import { PerformanceMonitor } from './Performance';
import { Calibration } from '../ui/Calibration';
import { Input } from '../core/Input';
import { Race } from '../race/Race';
import { createInput, type Ship } from '../race/Ship';
import { TEAMS, teamById } from '../race/teams';
import { ChaseCamera } from '../render/ChaseCamera';
import { CircuitView } from '../render/CircuitView';
import { Sparks, SpeedLines } from '../render/effects';
import { BLOOM_STRENGTH, Renderer } from '../render/Renderer';
import { ShipView } from '../render/ShipView';
import { createTextures, type Textures } from '../render/textures';
import { WeaponView } from '../render/WeaponView';
import { circuitById, CIRCUITS } from '../track/circuits';
import { createFrame, Track } from '../track/Track';
import { formatTime, ordinal } from '../ui/format';
import { Hud } from '../ui/Hud';
import { Screens, type MenuSelection } from '../ui/Screens';
import type { SfxName } from '../audio/spatial/Sfx';
import { AcousticRaysView } from '../render/AcousticRaysView';
import { AudioDebugPanel } from '../ui/AudioDebugPanel';
import { TouchControls } from '../ui/TouchControls';
import { MusicDirector } from './MusicDirector';
import { hasAuthored, styleFor } from '../audio/score';
import { SoundStage } from './SoundStage';

type Screen = 'menu' | 'race' | 'results';

const MAX_STEPS_PER_FRAME = 24;
const PREFS_KEY = 'hyperglide.menu';
/** Au menu, le vaisseau choisi vole devant la caméra. */
const PREVIEW_AHEAD = 22;

/** Chef d'orchestre : relie simulation, rendu, audio, entrées et interface. */
export class Game {
  private readonly tracks = new Map<string, Track>();
  private readonly views = new Map<string, CircuitView>();
  private readonly race: Race;
  private readonly renderer: Renderer;
  private readonly tex: Textures;
  private readonly audio = new AudioEngine();
  private readonly input = new Input();
  private readonly camera: ChaseCamera;
  private readonly weaponView: WeaponView;
  private readonly sparks: Sparks;
  private readonly speedLines: SpeedLines;
  private readonly shipViews: ShipView[];
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly music: MusicDirector;
  private readonly stage: SoundStage;
  private readonly rays: AcousticRaysView;
  private readonly audioPanel: AudioDebugPanel;
  private audioFailed = false;
  private readonly touch: TouchControls | null;

  private screen: Screen = 'menu';
  private paused = false;
  private selection: MenuSelection;
  private view!: CircuitView;
  private resultsDelay = -1;
  private accumulator = 0;
  private lastTime = performance.now();
  /** Reçoit les commandes quand le joueur ne pilote pas (menu, arrivée). */
  private readonly ignoredInput = createInput();
  private readonly frame = createFrame();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.selection = loadSelection();
    this.race = new Race(this.trackFor(this.selection.circuit), DIFFICULTIES[this.selection.difficulty], teamById(this.selection.team));
    this.renderer = new Renderer(canvas);
    const { scene, camera } = this.renderer;
    this.tex = createTextures(this.renderer.gl);
    this.weaponView = new WeaponView(scene, this.tex);
    this.sparks = new Sparks(scene, this.tex);
    this.speedLines = new SpeedLines(camera);
    this.camera = new ChaseCamera(camera);
    this.shipViews = this.race.ships.map((s) => new ShipView(scene, s, this.tex));
    this.hud = new Hud(this.race);
    this.screens = new Screens(
      {
        onStart: () => this.startRace(),
        onResume: () => this.setPaused(false),
        onMenu: () => this.toMenu(),
        onDifficulty: (key) => this.select({ difficulty: key }),
        onCircuit: (id) => this.select({ circuit: id }),
        onTeam: (id) => this.select({ team: id }),
      },
      CIRCUITS,
      TEAMS,
      this.selection,
    );
    this.music = new MusicDirector(this.audio, this.race);
    // le rythme entendu sert à juger les actions du joueur
    this.race.beat = () => this.audio.beatSample();
    const theme = this.audio.themes.get(this.selection.circuit);
    if (theme) this.music.setTheme(theme);
    // les dragons du décor affiché dialoguent avec la musique
    this.music.setDragonSource(() => this.view.dragonsActive);
    this.stage = new SoundStage(this.audio, this.race, camera);
    this.rays = new AcousticRaysView(scene);
    // calibration du retard (menu) : la musique se tait le temps du métronome
    new Calibration(this.audio, { onOpen: () => this.music.setPaused(true), onClose: () => this.music.setPaused(false) });
    this.audioPanel = new AudioDebugPanel(() => this.audio.sfx, (name) => this.triggerSfx(name), {
      current: () => {
        const c = this.selection.circuit;
        const theme = this.audio.themes.get(c)!;
        return { circuit: c, name: theme.name, style: styleFor(c), seed: this.audio.seeds.get(c) ?? null, bpm: theme.bpm, authored: hasAuthored(c) };
      },
      reseed: (seed) => {
        this.audio.init();
        this.music.setTheme(this.audio.reseed(this.selection.circuit, seed));
      },
    });
    this.touch = TOUCH
      ? new TouchControls(this.input.touch, {
          fire: () => this.input.actions.emit('fire', undefined),
          pulse: () => this.input.actions.emit('pulse', undefined),
          pause: () => this.setPaused(true),
        })
      : null;
    document.body.classList.toggle('touch', TOUCH);
    this.showCircuit(this.selection.circuit);
    this.bindInput();
    this.bindRaceEvents();
    this.unlockAudioOnFirstGesture();
    this.toMenu();
  }

  run(): void {
    requestAnimationFrame(this.loop);
  }

  private get player(): Ship {
    return this.race.player;
  }

  private get track(): Track {
    return this.race.track;
  }

  // ------------------------------------------------------------------ circuits et sélection

  private trackFor(id: string): Track {
    let track = this.tracks.get(id);
    if (!track) {
      track = new Track(circuitById(id).layout, TRACK_HALF_WIDTH);
      this.tracks.set(id, track);
    }
    return track;
  }

  /** Affiche un circuit (construit à la première demande) et y place la course. */
  private showCircuit(id: string): void {
    const circuit = circuitById(id);
    const track = this.trackFor(circuit.id);
    this.race.setTrack(track);
    let view = this.views.get(circuit.id);
    if (!view) {
      view = new CircuitView(this.renderer.scene, circuit, track, this.race.pads, this.tex);
      this.views.set(circuit.id, view);
    }
    view.setQualityDrop(this.perf.drop);
    this.renderer.sky = view.skyDome;
    for (const v of this.views.values()) v.visible = v === view;
    this.view = view;
    this.renderer.setAtmosphere(circuit.theme);
    // chaque circuit a sa musique
    const theme = this.audio.themes.get(circuit.id);
    if (this.music && theme) this.music.setTheme(theme);
    this.hud.setTrack(track);
    this.warmUp();
  }

  /** Shaders du circuit affiché, des vaisseaux et des effets compilés d'avance (pas de saccade en course). */
  private warmUp(): void {
    const others = new Set<Object3D>();
    for (const v of this.views.values()) if (v !== this.view) for (const r of v.roots) others.add(r);
    this.renderer.warmUp((o) => others.has(o));
  }

  private select(change: Partial<MenuSelection>): void {
    this.selection = { ...this.selection, ...change };
    saveSelection(this.selection);
    if (change.circuit) this.showCircuit(change.circuit);
    if (change.team) {
      this.player.team = teamById(change.team);
      this.shipViews[this.race.ships.indexOf(this.player)].refresh();
    }
  }

  // ------------------------------------------------------------------ états

  private startRace(): void {
    this.audio.init();
    this.race.start(DIFFICULTIES[this.selection.difficulty], { team: teamById(this.selection.team) });
    for (const v of this.shipViews) v.refresh();
    this.screen = 'race';
    this.paused = false;
    this.resultsDelay = -1;
    this.accumulator = 0;
    this.screens.hideAll();
    this.hud.visible = true;
    if (TOUCH) enterLandscapeFullscreen();
    this.updateTouch();
    this.music.enterRace();
    for (const v of this.shipViews) v.visible = true;
    this.warmUp();
  }

  private toMenu(): void {
    this.race.stop();
    this.screen = 'menu';
    this.paused = false;
    this.screens.showMenu();
    this.hud.visible = false;
    this.updateTouch();
    this.music.enterMenu();
    for (const v of this.shipViews) v.visible = false;
  }

  private setPaused(paused: boolean): void {
    if (this.screen !== 'race') return;
    this.paused = paused;
    this.screens.showPause(paused);
    this.music.setPaused(paused);
    this.updateTouch();
  }

  /** Commandes tactiles visibles seulement en course, hors pause. */
  private updateTouch(): void {
    const racing = this.screen === 'race';
    document.body.classList.toggle('racing', racing);
    if (this.touch) this.touch.visible = racing && !this.paused;
  }

  private showResults(): void {
    this.screen = 'results';
    this.updateTouch();
    const p = this.player;
    this.screens.showResults({
      title: p.dead ? 'ÉLIMINÉ' : this.race.position(p) === 1 ? 'VICTOIRE' : 'RÉSULTATS',
      rows: this.race.results(),
      lapTimes: p.lapTimes,
    });
  }

  // ------------------------------------------------------------------ câblage

  /** Les navigateurs n'autorisent l'audio qu'après une action : la musique du menu démarre au premier clic ou touche. */
  private unlockAudioOnFirstGesture(): void {
    // iOS n'accepte de démarrer l'audio que sur touchend / click : on réessaie jusqu'à ce qu'il joue
    const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
    const unlock = () => {
      this.audio.init();
      if (this.audio.running) for (const e of events) removeEventListener(e, unlock);
    };
    for (const e of events) addEventListener(e, unlock);
    // téléphone verrouillé, appel, changement d'onglet : la course se met en pause
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'race' && !this.paused) this.setPaused(true);
    });
    // en portrait, un message masque la course : on la met en pause
    if (TOUCH) {
      addEventListener('resize', () => {
        if (innerHeight > innerWidth && this.screen === 'race' && !this.paused) this.setPaused(true);
      });
    }
  }

  private bindInput(): void {
    const a = this.input.actions;
    const canStart = () => this.screen === 'menu' || this.screen === 'results';
    a.on('fire', () => {
      if (this.screen === 'race' && !this.paused && this.race.phase === 'racing') this.player.input.fire = true;
    });
    a.on('pulse', () => {
      if (this.screen === 'race' && !this.paused && this.race.phase === 'racing') {
        // jugé à l'instant de l'appui, pas à la prochaine image
        this.player.input.pulse = true;
        this.player.input.pulseBeat = this.audio.beatSample();
      }
    });
    a.on('pause', () => (canStart() ? this.startRace() : this.setPaused(!this.paused)));
    a.on('confirm', () => canStart() && this.startRace());
    a.on('restart', () => (this.paused || this.screen === 'results') && this.startRace());
    a.on('mute', () => (this.audio.muted = !this.audio.muted));
    a.on('camera', () => this.camera.toggleMode());
    a.on('audioDebug', () => {
      this.audio.init();
      this.audioPanel.visible = !this.audioPanel.visible;
      this.rays.visible = this.audioPanel.visible;
    });
  }

  private bindRaceEvents(): void {
    const ev = this.race.events;
    const isPlayer = (s: Ship) => s === this.player;

    ev.on('countdown', ({ n }) => {
      this.hud.message(String(n), 0.9);
    });
    ev.on('go', () => {
      this.hud.message('GO !', 1);
    });
    ev.on('pickup', ({ ship, item }) => isPlayer(ship) && this.hud.subtitle(item, 1.2));
    ev.on('wallHit', ({ ship, impact }) => {
      if (!isPlayer(ship)) return;
      this.camera.addShake(impact * 0.03);
    });
    ev.on('land', ({ ship, impact }) => {
      if (impact < 3) return;
      const at = this.track.pointAt(ship.s, ship.x, 0.3, new Vector3());
      this.sparks.emit(at, Math.min(80, impact * 5), 10 + impact);
      if (isPlayer(ship)) this.camera.addShake(Math.min(1.2, impact * 0.06));
    });
    // rythme : retour visuel et sonore, et le décor s'illumine sur un coup parfait
    ev.on('groove', ({ result }) => {
      const { grade, streak, downbeat, action } = result;
      if (grade === 'miss') {
        this.hud.subtitle('CONTRETEMPS', 0.6);
        return;
      }
      const what = action === 'pad' ? 'BOOST ' : action === 'land' ? 'RÉCEPTION ' : '';
      const label = grade === 'perfect' ? (downbeat ? 'PREMIER TEMPS !' : 'PARFAIT') : 'EN RYTHME';
      this.hud.subtitle(`${what}${label}${streak > 1 ? ` ×${streak}` : ''}`, 0.7);
      this.audio.sfx?.play('pickup', undefined, grade === 'perfect' ? 0.45 : 0.25);
      this.view.accent(grade === 'perfect' ? (downbeat ? 1 : 0.7) : 0.35);
      if (grade === 'perfect') this.camera.addShake(0.15);
    });
    ev.on('bump', ({ a, b }) => {
      if (!isPlayer(a) && !isPlayer(b)) return;
      this.camera.addShake(0.3);
    });
    ev.on('shipHit', ({ ship, shielded }) => {
      this.sparks.emit(this.shipPosition(ship), shielded ? 20 : 60, shielded ? 14 : 20);
      if (!shielded && isPlayer(ship)) this.camera.addShake(1);
    });
    ev.on('lap', ({ ship, lap, time }) => {
      if (!isPlayer(ship)) return;
      this.hud.message(lap === this.race.laps ? 'DERNIER TOUR' : `TOUR ${lap}`, 1.6);
      this.hud.subtitle(formatTime(time), 1.6);
    });
    ev.on('finish', ({ ship, position }) => {
      if (!isPlayer(ship)) return;
      this.hud.message(position === 1 ? 'VICTOIRE !' : ordinal(position), 3);
      this.resultsDelay = 3.5;
    });
    ev.on('eliminated', ({ ship }) => {
      if (!isPlayer(ship)) return;
      this.shipViews[this.race.ships.indexOf(ship)].visible = false;
      this.sparks.emit(this.shipPosition(ship), 250, 40);
      this.camera.addShake(1.5, 1.5);
      this.hud.message('ÉLIMINÉ', 3);
      this.resultsDelay = 2.5;
    });
  }

  // ------------------------------------------------------------------ boucle

  /**
   * Qualité adaptative (sauf `?qualite=max`) et, avec `?perf`, un compteur à l'écran :
   * images/s, pire image, palier de qualité, notes de musique par seconde.
   */
  private readonly perf = new PerformanceMonitor((level) => {
    this.renderer.setQualityDrop(level);
    for (const v of this.views.values()) v.setQualityDrop(level);
  }, new URLSearchParams(location.search).get('qualite') !== 'max');
  private readonly perfOverlay = new URLSearchParams(location.search).has('perf') ? createPerfOverlay() : null;
  private perfClock = 0;
  private perfNotes = 0;

  private updatePerfOverlay(dt: number): void {
    const el = this.perfOverlay;
    if (!el || (this.perfClock += dt) < 0.5) return;
    const notes = this.audio.notesSent;
    const nps = (notes - this.perfNotes) / this.perfClock;
    this.perfNotes = notes;
    this.perfClock = 0;
    const p = this.perf;
    el.textContent = `${(1000 / p.avgMs).toFixed(0)} i/s · moy ${p.avgMs.toFixed(1)} ms · pire ${p.worstMs.toFixed(0)} ms · qualité −${p.drop} · ${nps.toFixed(0)} notes/s`;
  }

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    const dt = Math.min(0.1, rawDt);
    this.lastTime = now;
    this.perf.frame(rawDt, document.hidden || rawDt > 0.5);
    this.updatePerfOverlay(rawDt);
    const time = now / 1000;

    const p = this.player;
    const piloting = this.screen === 'race' && !this.paused && !p.dead && !p.finished;
    this.input.poll(piloting ? p.input : this.ignoredInput);

    if (this.screen === 'menu') {
      this.music.update(dt);
      this.camera.flyby(dt, time, this.track);
      this.renderer.camera.updateMatrixWorld();
      this.previewPlayerShip(time);
      this.view.update(dt, time, this.renderer.camera, this.audio.musicFeatures());
      this.renderer.bloomStrength = BLOOM_STRENGTH * this.view.bloom;
      this.weaponView.update(this.race.weapons, this.track, time);
      this.speedLines.update(dt, 0, 0);
      this.renderer.render();
      this.updateAudio(dt, false);
      return;
    }

    if (!this.paused) {
      this.simulate(dt);
      this.music.update(dt);
      this.hud.tick(dt);
      if (this.resultsDelay > 0 && (this.resultsDelay -= dt) <= 0) this.showResults();
    }
    this.updateVisuals(this.paused ? 0 : dt, time);
    this.touch?.update(p.item);
    this.renderer.render();
    this.updateAudio(dt, !this.paused);
  };

  /** L'audio ne doit jamais casser l'image : une erreur est signalée une fois, puis la boucle continue. */
  private updateAudio(dt: number, live: boolean): void {
    try {
      this.stage.update(dt, live);
      this.updateAudioDebug();
    } catch (e) {
      if (!this.audioFailed) console.error('audio :', e);
      this.audioFailed = true;
    }
  }

  private updateAudioDebug(): void {
    const sfx = this.audio.sfx;
    if (!this.audioPanel.visible || !sfx) return;
    this.rays.update(sfx.debug);
    this.audioPanel.update(this.race);
  }

  /** Bruitage déclenché depuis le banc d'essai, à la position du joueur. */
  private triggerSfx(name: SfxName): void {
    this.audio.init();
    const p = this.player;
    const at = { position: this.track.pointAt(p.s, p.x, HOVER_HEIGHT, new Vector3()), s: p.s };
    this.audio.sfx?.play(name, name === 'shieldAlert' ? undefined : at, 0.8);
  }

  /**
   * Au menu, la course est à l'arrêt : on se sert du vaisseau du joueur comme maquette
   * volant devant la caméra de survol. `race.start` remet tout à zéro ensuite.
   */
  private previewPlayerShip(time: number): void {
    const p = this.player;
    const view = this.shipViews[this.race.ships.indexOf(p)];
    p.dead = false;
    p.s = this.camera.flybyDistance + PREVIEW_AHEAD;
    // à droite de la caméra, pour ne pas être caché par le panneau du menu
    p.x = Math.min(this.track.halfWidth - 2, this.camera.flybyOffset + 6 + Math.sin(time * 0.45) * 1.5);
    p.psi = Math.cos(time * 0.45) * 0.08;
    p.steer = -Math.cos(time * 0.45) * 0.4;
    p.input.thrust = 1;
    p.u = 45; // vitesse de la caméra de survol : sert au Doppler du banc d'essai
    view.visible = true;
    view.update(this.track, time);
  }

  /** Physique à pas fixe, indépendante du framerate. */
  private simulate(dt: number): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_STEP && steps++ < MAX_STEPS_PER_FRAME) {
      this.race.step(PHYSICS_STEP);
      this.accumulator -= PHYSICS_STEP;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
  }

  private updateVisuals(dt: number, time: number): void {
    const p = this.player;
    this.weaponView.update(this.race.weapons, this.track, time);
    for (const v of this.shipViews) v.update(this.track, time);
    this.emitScrapeSparks();
    this.sparks.update(dt);

    const ratio = this.camera.follow(dt, p, this.track);
    this.shipViews[this.race.ships.indexOf(p)].visible = !p.dead && this.camera.mode === 'chase';
    this.view.update(dt, time, this.renderer.camera, this.audio.musicFeatures());
    this.renderer.bloomStrength = BLOOM_STRENGTH * this.view.bloom;
    this.speedLines.update(dt, p.speed, ratio + (p.boostTime > 0 ? 0.3 : 0));
    this.hud.update(this.race, p);
    this.hud.beat(this.race.phase === 'racing' ? this.audio.beatSample() : null, this.race.groove.streak);
  }

  private emitScrapeSparks(): void {
    for (const ship of this.race.ships) {
      if (ship.dead || !ship.scrape || ship.speed < 8) continue;
      const f = this.track.frameAt(ship.s, this.frame);
      const at = this.tmpA.copy(f.p).addScaledVector(f.r, ship.x + ship.scrape * SHIP_HALF_WIDTH).addScaledVector(f.u, 0.6);
      this.sparks.emit(at, 3, 8, this.tmpB.copy(f.t).multiplyScalar(ship.u * 0.3));
      this.stage.scrape(ship, at);
    }
  }

  private shipPosition(ship: Ship): Vector3 {
    return this.track.pointAt(ship.s, ship.x, HOVER_HEIGHT + ship.h, new Vector3());
  }
}

// ------------------------------------------------------------------ préférences du menu

const DEFAULT_SELECTION: MenuSelection = { circuit: CIRCUITS[0].id, team: TEAMS[0].id, difficulty: 'pro' };

function loadSelection(): MenuSelection {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<MenuSelection>;
    return {
      circuit: CIRCUITS.some((c) => c.id === saved.circuit) ? saved.circuit! : DEFAULT_SELECTION.circuit,
      team: TEAMS.some((t) => t.id === saved.team) ? saved.team! : DEFAULT_SELECTION.team,
      difficulty: saved.difficulty && saved.difficulty in DIFFICULTIES ? saved.difficulty : DEFAULT_SELECTION.difficulty,
    };
  } catch {
    return DEFAULT_SELECTION;
  }
}

function saveSelection(sel: MenuSelection): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(sel));
  } catch {
    /* stockage indisponible (navigation privée) : on garde la sélection pour la session */
  }
}

/** Plein écran et orientation paysage (Android ; iOS ignore ces demandes, un message invite alors à tourner l'écran). */
function enterLandscapeFullscreen(): void {
  const lockLandscape = () =>
    (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined);
  if (document.fullscreenElement) {
    void lockLandscape();
    return;
  }
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(lockLandscape, () => undefined);
}

/** Compteur de performances (`?perf`). */
function createPerfOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'perf';
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:30;font:11px ui-monospace,Consolas,monospace;color:#9ff;background:rgba(0,0,0,.55);padding:3px 6px;border-radius:4px;pointer-events:none';
  document.body.appendChild(el);
  return el;
}
