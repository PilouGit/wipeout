/** Briques DSP partagées : bruit, saturation, réponses impulsionnelles procédurales. */

export function createNoise(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Courbe de saturation douce (tanh) pour WaveShaperNode. */
export function driveCurve(amount: number, size = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(size * 4));
  const norm = Math.tanh(amount);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / norm;
  }
  return c;
}

/**
 * Réponse impulsionnelle de tunnel : premières réflexions denses (parois rapprochées)
 * puis queue exponentielle qui s'assombrit (le béton absorbe les aigus plus vite que les graves).
 */
export function tunnelImpulse(ctx: BaseAudioContext, seconds = 2.4): AudioBuffer {
  seconds = Math.max(0.5, seconds);
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    // réflexions discrètes des parois (flutter entre deux murs à ~13 m : ~38 ms)
    for (let k = 1; k < 14; k++) {
      const i = Math.floor((0.006 + k * 0.038 + Math.random() * 0.004) * rate);
      if (i < len) d[i] += (ch ? -1 : 1) * 0.7 * Math.pow(0.78, k);
    }
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp(-t * (3.2 / seconds) * 2.2);
      // filtre passe-bas à un pôle qui se ferme avec le temps
      const a = Math.min(0.97, 0.25 + t * 0.6);
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] += lp * env * 2.2;
    }
  }
  return buf;
}

const lastTarget = new WeakMap<AudioParam, number>();

/**
 * setTargetAtTime qui n'émet rien si la cible n'a pas bougé : on évite d'empiler des centaines
 * d'évènements d'automation par image (coûteux dans Firefox, où chacun traverse vers le thread audio).
 */
export function glide(param: AudioParam, value: number, t: number, tc: number, epsilon = 1e-3): void {
  const prev = lastTarget.get(param);
  if (prev !== undefined && Math.abs(value - prev) <= epsilon * Math.max(1, Math.abs(prev))) return;
  lastTarget.set(param, value);
  param.setTargetAtTime(value, t, tc);
}

/**
 * Passe des paramètres automatisés en continu (à chaque image) au calcul par bloc de 128 échantillons.
 * En « a-rate », un filtre dont la fréquence glisse recalcule ses coefficients à chaque échantillon,
 * un panner sa direction (et le HRTF son interpolation) : c'est l'essentiel du coût des moteurs
 * sur le thread audio. Les glissements durent 20 à 100 ms, un pas de 2,7 ms est inaudible.
 * Pas pour les retards (delayTime) : un saut de retard s'entend comme un clic.
 */
export function kRate(...params: AudioParam[]): void {
  for (const p of params) {
    try {
      p.automationRate = 'k-rate';
    } catch {
      /* navigateur sans automationRate (ou paramètre figé) : on garde l'a-rate */
    }
  }
}
