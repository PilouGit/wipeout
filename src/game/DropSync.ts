import type { Track } from '../track/Track';

/**
 * La piste comme partition : les moments forts du circuit (décollage d'un tremplin, sortie de
 * tunnel) sont des rendez-vous musicaux. Le drop (fin de la montée FILL_UP, entrée de DRIVE)
 * doit tomber pile au moment où le joueur y arrive, à chaque tour, quelle que soit sa vitesse.
 *
 * Deux leviers, comme pour synchroniser une démo sur sa bande-son :
 * - la quantification : le saut DROP n'est possible qu'aux barres de mesure, on choisit la bonne ;
 * - le tempo : on l'accélère ou le ralentit légèrement (MdSetSpeed) pour rattraper le reste.
 */

/** Plage de tempo admise pour la synchro (facteur sur le tempo nominal du thème). */
export const SYNC_MIN = 0.9;
export const SYNC_MAX = 1.16;
/** Distance minimale entre deux rendez-vous (m) : un drop doit avoir le temps de vivre. */
const MIN_CUE_GAP = 700;
/** Un tunnel plus court ne fait pas un breakdown. */
const MIN_CALM_LENGTH = 220;

export interface MusicCues {
  /** Abscisses des rendez-vous (drop), triées. */
  readonly drops: readonly number[];
  /** Tunnels assez longs pour une respiration (breakdown), suivis d'un drop à la sortie. */
  readonly calms: readonly { readonly from: number; readonly to: number }[];
}

/** Rendez-vous musicaux d'un circuit : décollages des tremplins et sorties des longs tunnels. */
export function musicCues(track: Track): MusicCues {
  const candidates: { s: number; weight: number }[] = [];
  const calms: { from: number; to: number }[] = [];
  for (const z of track.zones) {
    if (z.kind === 'jump') candidates.push({ s: takeoff(track, z.from, z.to), weight: 2 });
    if (z.kind === 'tunnel' && z.to - z.from >= MIN_CALM_LENGTH) {
      calms.push({ from: z.from, to: z.to });
      candidates.push({ s: z.to, weight: 1 });
    }
  }
  // les rendez-vous trop rapprochés : on garde le plus marquant (le tremplin)
  candidates.sort((a, b) => b.weight - a.weight || a.s - b.s);
  const kept: number[] = [];
  for (const c of candidates) {
    if (kept.every((s) => Math.abs(track.wrapDiff(s - c.s)) >= MIN_CUE_GAP)) kept.push(c.s);
  }
  return { drops: kept.sort((a, b) => a - b), calms: calms.filter((z) => kept.includes(z.to)) };
}

/** Point de décollage d'un tremplin : la crête (courbure en tangage la plus négative). */
function takeoff(track: Track, from: number, to: number): number {
  let best = from;
  let min = Infinity;
  for (let s = from; s <= to; s += track.spacing) {
    const k = track.pitchAt(s);
    if (k < min) {
      min = k;
      best = s;
    }
  }
  return best;
}

export interface DropPlan {
  /** Facteur de tempo à appliquer (sur le tempo nominal). */
  readonly factor: number;
  /** Poser le hook DROP maintenant : la prochaine barre que lira l'ordonnanceur est la bonne. */
  readonly arm: boolean;
  /** Nombre de mesures avant la barre où le saut aura lieu (0 = la prochaine). */
  readonly bars: number;
  /** Écart prévu entre le drop et l'arrivée sur le rendez-vous (s, positif = drop en retard). */
  readonly error: number;
}

const BEATS_PER_BAR = 4;
/** La montée FILL_UP dure une mesure. */
const FILL_BEATS = 4;

/**
 * Choisit la barre de mesure du saut et le tempo pour que le drop tombe dans `eta` secondes.
 * @param eta temps avant le rendez-vous (s), à la vitesse actuelle
 * @param inBar position entendue dans la mesure (0..4)
 * @param bps tempo actuel (temps/s)
 * @param baseBps tempo nominal du thème (temps/s)
 * @param factor facteur de tempo actuel (pour rester stable d'une image à l'autre)
 * @param lead avance de l'ordonnanceur sur ce qu'on entend (s)
 */
export function planDrop(eta: number, inBar: number, bps: number, baseBps: number, factor: number, lead: number): DropPlan | null {
  if (!(eta > 0) || bps <= 0) return null;
  const toBar = BEATS_PER_BAR - inBar;
  let best: { n: number; f: number; cost: number } | null = null;
  for (let n = 0; n < 40; n++) {
    const hookBeats = toBar + BEATS_PER_BAR * n;
    // barre déjà lue par l'ordonnanceur : trop tard pour elle
    if (hookBeats / bps <= lead) continue;
    const f = (hookBeats + FILL_BEATS) / (eta * baseBps);
    const clamped = Math.min(SYNC_MAX, Math.max(SYNC_MIN, f));
    // hors plage : pénalité forte (écart résiduel) ; dans la plage : rester près du tempo actuel
    const cost = Math.abs(f - clamped) * 100 + Math.abs(clamped - factor);
    if (!best || cost < best.cost) best = { n, f: clamped, cost };
    if (f > SYNC_MAX) break;
  }
  if (!best) return null;
  const hookBeats = toBar + BEATS_PER_BAR * best.n;
  const hookIn = hookBeats / bps - lead;
  return {
    factor: best.f,
    arm: hookIn > 0 && hookIn <= BEATS_PER_BAR / bps,
    bars: best.n,
    error: (hookBeats + FILL_BEATS) / (best.f * baseBps) - eta,
  };
}

/** Pendant la montée (déjà engagée) : il reste `beatsLeft` temps avant le drop, on ajuste le tempo. */
export function trimDrop(eta: number, beatsLeft: number, baseBps: number): number {
  if (!(eta > 0.05) || beatsLeft <= 0) return 1;
  return Math.min(SYNC_MAX, Math.max(SYNC_MIN, beatsLeft / (eta * baseBps)));
}
