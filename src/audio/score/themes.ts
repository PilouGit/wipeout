import type { SoundFile } from '../imuse/types';
import { generateTheme, type ThemeStyle } from './generator';
import { SOUND } from './ids';
import { NEON_RIDGE } from './neonRidge';

/** Musique de chaque circuit : le thème écrit à la main, ou une graine et un style pour le générateur. */
interface ThemeEntry {
  readonly circuit: string;
  readonly name: string;
  readonly seed: number;
  readonly style: ThemeStyle;
  /** Thème écrit à la main, utilisé tant qu'aucune graine n'est imposée. */
  readonly authored?: SoundFile;
}

const ENTRIES: readonly ThemeEntry[] = [
  { circuit: 'neon', name: 'Neon Ridge', seed: 0x4e30, style: 'breakbeat', authored: NEON_RIDGE },
  { circuit: 'glacier', name: 'Glacier Vault', seed: 0x61ac1e5, style: 'trance' },
  { circuit: 'magma', name: 'Magma Rift', seed: 0x3a63a, style: 'industrial' },
  { circuit: 'selene', name: 'Selene Orbital', seed: 0x5e1e7e, style: 'space' },
];

/** Mélange la graine imposée et le rang du circuit (chaque circuit garde un morceau distinct). */
const mix = (base: number, k: number) => (Math.imul(base ^ (k * 0x9e3779b9), 0x85ebca6b) ^ (base >>> 13)) >>> 0;

/**
 * Thèmes de course par circuit. Sans graine imposée : Neon Ridge écrit à la main et des graines
 * fixes pour les autres circuits (toujours le même morceau). Avec une graine (`?musique=1234`
 * ou `?musique=aleatoire`), tous les thèmes sont générés à partir d'elle.
 */
export function buildThemes(seed: number | null = null): Map<string, SoundFile> {
  const out = new Map<string, SoundFile>();
  ENTRIES.forEach((e, k) => {
    if (seed === null && e.authored) out.set(e.circuit, e.authored);
    else out.set(e.circuit, generateTheme({ id: SOUND.THEME_BASE + k, name: e.name, seed: seed === null ? e.seed : mix(seed, k), style: e.style }));
  });
  return out;
}

/** Graine imposée par l'adresse : `?musique=<nombre>` ou `?musique=aleatoire`. */
export function seedFromUrl(search: string): number | null {
  const v = new URLSearchParams(search).get('musique');
  if (v === null) return null;
  if (/^\d+$/.test(v)) return Number(v) >>> 0;
  return (Math.random() * 2 ** 32) >>> 0;
}

/** Graine d'un circuit (celle de la table, ou mélangée à une graine imposée). */
export function seedFor(circuit: string, seed: number | null = null): number {
  const k = ENTRIES.findIndex((e) => e.circuit === circuit);
  return seed === null ? ENTRIES[k].seed : mix(seed, k);
}

/** Le circuit a-t-il un thème écrit à la main ? */
export const hasAuthored = (circuit: string): boolean => !!ENTRIES.find((e) => e.circuit === circuit)?.authored;

/**
 * Thème d'un circuit avec une graine donnée (banc d'essai : choisir les graines à l'oreille),
 * ou le thème écrit à la main si `seed` est null et qu'il existe.
 */
export function themeFor(circuit: string, seed: number | null): SoundFile {
  const k = ENTRIES.findIndex((e) => e.circuit === circuit);
  const e = ENTRIES[k];
  if (seed === null && e.authored) return e.authored;
  // un thème généré a toujours son propre numéro (THEME_BASE + rang), distinct du thème écrit
  return generateTheme({ id: SOUND.THEME_BASE + k, name: e.name, seed: seed ?? e.seed, style: e.style });
}

/** Style du générateur pour un circuit. */
export const styleFor = (circuit: string): ThemeStyle => ENTRIES.find((e) => e.circuit === circuit)!.style;

/** Thèmes par défaut (sans graine imposée). */
export const DEFAULT_THEMES = buildThemes();
