import { Group, type Camera, type Object3D, type Scene } from 'three';
import type { MusicFeatures } from '../audio/imuse/MusicPulse';
import type { Pad } from '../race/pads';
import type { Circuit } from '../track/circuits';
import type { Track } from '../track/Track';
import { Environment } from './Environment';
import { PadView } from './PadView';
import type { Textures } from './textures';
import { buildTrackView } from './TrackView';

/** Tout ce qui est propre à un circuit : piste, pads, décor, ciel. Construit une fois, masqué quand inutilisé. */
export class CircuitView {
  private readonly root = new Group();
  private readonly environment: Environment;
  private readonly pads: PadView;

  constructor(scene: Scene, readonly circuit: Circuit, track: Track, pads: readonly Pad[], tex: Textures) {
    this.root.add(buildTrackView(track, tex, circuit.theme));
    this.environment = new Environment(track, tex, circuit.theme);
    this.root.add(this.environment.root);
    this.pads = new PadView(this.root, track, pads, tex);
    scene.add(this.root, this.environment.sky);
  }

  setQualityDrop(level: number): void {
    this.environment.setQualityDrop(level);
  }

  /** Accent visuel ponctuel (action réussie sur le temps), 0..1. */
  accent(strength: number): void {
    this.environment.accent(strength);
  }

  /** Dôme du ciel (rendu à part, en basse définition). */
  get skyDome(): Object3D {
    return this.environment.skyDome;
  }

  /** Facteur de bloom voulu par la mise en scène musicale. */
  get bloom(): number {
    return this.environment.bloom;
  }

  /** Des dragons sont hors du sol (pour la musique). */
  get dragonsActive(): boolean {
    return this.environment.dragonsActive;
  }

  /** Racines du décor dans la scène. */
  get roots(): readonly Object3D[] {
    return [this.root, this.environment.sky];
  }

  set visible(v: boolean) {
    this.root.visible = v;
    this.environment.sky.visible = v;
  }

  update(dt: number, time: number, camera: Camera, music: MusicFeatures): void {
    this.environment.follow(camera.position);
    this.environment.update(dt, music, camera);
    this.pads.update(dt, time);
  }
}
