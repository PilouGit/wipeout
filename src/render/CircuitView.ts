import { Group, type Scene, type Vector3 } from 'three';
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

  set visible(v: boolean) {
    this.root.visible = v;
    this.environment.sky.visible = v;
  }

  update(dt: number, time: number, cameraPosition: Vector3): void {
    this.environment.follow(cameraPosition);
    this.pads.update(dt, time);
  }
}
