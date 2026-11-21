import type { SoundFile } from '../imuse/types';
import { NEON_RIDGE } from './neonRidge';
import { DEFEAT, VICTORY } from './stingers';

export * from './ids';

/** Tous les sons de la bande-son, à enregistrer dans le pilote. */
export const SOUNDTRACK: readonly SoundFile[] = [NEON_RIDGE, VICTORY, DEFEAT];
