import type { SoundFile } from '../imuse/types';
import { DEFEAT, VICTORY } from './stingers';
import { DEFAULT_THEMES } from './themes';

export * from './ids';
export { buildThemes, DEFAULT_THEMES, hasAuthored, seedFor, seedFromUrl, styleFor, themeFor } from './themes';

/** Jingles de fin de course. */
export const STINGERS: readonly SoundFile[] = [VICTORY, DEFEAT];

/** Toute la bande-son par défaut : un thème par circuit et les jingles. */
export const SOUNDTRACK: readonly SoundFile[] = [...DEFAULT_THEMES.values(), ...STINGERS];
