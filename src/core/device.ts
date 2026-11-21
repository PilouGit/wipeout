/**
 * Profil de l'appareil, figé au chargement.
 * Forçable par l'URL pour tester sur ordinateur : `?touch` (commandes tactiles),
 * `?lite` (qualité allégée), `?full` (qualité complète même sur mobile).
 */
const params = new URLSearchParams(location.search);
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Écran tactile comme pointeur principal : affiche les commandes tactiles. */
export const TOUCH = params.has('touch') || coarse;

/** Qualité allégée (rendu et audio) : par défaut sur mobile. */
export const LITE = params.has('lite') || (TOUCH && !params.has('full'));
