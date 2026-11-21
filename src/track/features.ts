import type { Track } from './Track';

/**
 * Objets placés le long de la piste et partagés entre le rendu et l'acoustique,
 * pour que ce qu'on entend corresponde exactement à ce qu'on voit.
 */

export const ARCH_SPACING = 260;
export const COLONNADE_SPACING = 12;
/** Hauteur des murets (hors tunnel). */
export const WALL_HEIGHT = 1.5;
/** Section intérieure des tunnels : demi-largeur au sol (en plus de la piste) et hauteur du plafond. */
export const TUNNEL_WALL_MARGIN = 1;
export const TUNNEL_CEILING = 10.5;

/** Un poteau vertical réfléchissant : abscisse et côté (-1 gauche, +1 droite), distance à l'axe. */
export interface Post {
  readonly s: number;
  readonly side: -1 | 1;
  readonly x: number;
}

/** Abscisses des portiques (le premier est la ligne de départ). Aucun dans les figures ni les tunnels. */
export function archPositions(track: Track): number[] {
  const out = [0];
  for (let s = ARCH_SPACING; s < track.length - 150; s += ARCH_SPACING) {
    if (track.zones.some((z) => z.kind !== 'colonnade' && s > z.from - 30 && s < z.to + 30)) continue;
    out.push(s);
  }
  return out;
}

export const colonnadeX = (track: Track) => track.halfWidth + 1.6;
export const archPostX = (track: Track) => track.halfWidth + 1.5;

/** Tous les poteaux : piliers des colonnades et montants des portiques, triés par abscisse. */
export function posts(track: Track): Post[] {
  const out: Post[] = [];
  for (const z of track.zones) {
    if (z.kind !== 'colonnade') continue;
    for (let s = z.from; s <= z.to; s += COLONNADE_SPACING) {
      out.push({ s, side: -1, x: colonnadeX(track) }, { s, side: 1, x: colonnadeX(track) });
    }
  }
  for (const s of archPositions(track)) out.push({ s, side: -1, x: archPostX(track) }, { s, side: 1, x: archPostX(track) });
  return out.sort((a, b) => a.s - b.s);
}
