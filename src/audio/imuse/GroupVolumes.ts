import { MAX_VOLUME, type VolumeGroup } from './types';

const GROUPS: readonly VolumeGroup[] = ['master', 'sfx', 'music', 'musicDip'];

/**
 * Bus de volume d'iMUSE (GrSetGroupVol). Volumes 0..127.
 * Volume effectif d'un groupe = ((vol + 1) * master) >> 7 ; changer le master recalcule tous les groupes.
 */
export class GroupVolumes {
  private readonly vols = new Map<VolumeGroup, number>();
  private readonly eff = new Map<VolumeGroup, number>();

  constructor() {
    for (const g of GROUPS) this.vols.set(g, MAX_VOLUME);
    this.recompute();
  }

  /** Retourne l'ancien volume. vol = -1 interroge sans modifier. */
  set(group: VolumeGroup, vol: number): number {
    const old = this.vols.get(group)!;
    if (vol === -1) return old;
    if (!Number.isInteger(vol) || vol < 0 || vol > MAX_VOLUME) throw new RangeError(`volume hors limites : ${vol}`);
    this.vols.set(group, vol);
    this.recompute();
    return old;
  }

  get(group: VolumeGroup): number {
    return this.vols.get(group)!;
  }

  effective(group: VolumeGroup): number {
    return this.eff.get(group)!;
  }

  /** Gain linéaire (0..1) appliqué à la musique : groupes music et musicDip. */
  musicGain(): number {
    return (this.effective('music') / MAX_VOLUME) * (this.effective('musicDip') / MAX_VOLUME);
  }

  private recompute(): void {
    const master = this.vols.get('master')!;
    this.eff.set('master', master);
    for (const g of GROUPS) {
      if (g !== 'master') this.eff.set(g, ((this.vols.get(g)! + 1) * master) >> 7);
    }
  }
}
