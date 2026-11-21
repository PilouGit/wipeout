import { AIRBRAKE_TURN_RATE, SHIP_HALF_WIDTH, TURN_RATE } from '../config';
import { wrapAngle } from '../core/math';
import { createFrame, type Track } from '../track/Track';
import type { Ship } from './Ship';

const BOOST_SPEED_FACTOR = 1.3;
const GRAVITY = 9.8;
const frame = createFrame();

/**
 * Avance un vaisseau d'un pas de temps.
 *
 * Le vaisseau garde son cap dans le monde : quand la piste tourne de `k·ds`,
 * le cap relatif `psi` tourne d'autant en sens inverse. C'est ce qui oblige
 * à braquer dans les virages et produit la dérive vers l'extérieur.
 *
 * @returns l'intensité d'un choc contre un mur ayant causé des dégâts (0 sinon)
 */
export function stepShip(ship: Ship, track: Track, dt: number): number {
  const fr = track.frameAt(ship.s, frame);
  const kR = fr.k;
  const inp = ship.input;
  const perf = ship.perf;

  ship.boostTime = Math.max(0, ship.boostTime - dt);
  ship.shieldTime = Math.max(0, ship.shieldTime - dt);
  ship.stunTime = Math.max(0, ship.stunTime - dt);
  ship.wallCooldown = Math.max(0, ship.wallCooldown - dt);
  const stunned = ship.stunned;

  // Lacet : direction lissée + aérofreins
  ship.steer += (inp.steer - ship.steer) * Math.min(1, dt * (ship.isPlayer ? 9 : 7));
  const airbrake = inp.airbrakeRight - inp.airbrakeLeft;
  const yawRate = stunned ? 0 : (ship.steer * TURN_RATE + airbrake * AIRBRAKE_TURN_RATE) * perf.turn;
  const dpsi = yawRate * dt;

  // La vitesse reste fixe dans le monde : on la ré-exprime dans le nouveau repère du vaisseau.
  const c = Math.cos(dpsi);
  const sn = Math.sin(dpsi);
  let u = ship.u * c + ship.w * sn;
  let w = -ship.u * sn + ship.w * c;

  // Longitudinal
  const vmax = perf.vmax * ship.vmaxMul * (ship.boostTime > 0 ? BOOST_SPEED_FACTOR : 1);
  if (!stunned) u += inp.thrust * perf.accel * (1 - Math.max(0, u) / vmax) * dt;
  if (ship.boostTime > 0) u += 18 * dt;
  if (u > vmax) u -= (u - vmax) * 1.2 * dt;
  u -= u * (inp.thrust ? 0.02 : 0.22) * dt;
  u -= inp.brake * 38 * perf.brake * dt * Math.sign(u);
  u -= (inp.airbrakeLeft + inp.airbrakeRight) * u * 0.28 * dt;
  u -= GRAVITY * fr.t.y * dt * 0.7;
  u = Math.max(u, -15);

  // Adhérence latérale : une partie de la glisse est rendue en vitesse
  const grip = (inp.airbrakeLeft || inp.airbrakeRight ? 2.2 : 3.6) * perf.grip;
  const lost = w * (1 - Math.exp(-grip * dt));
  w -= lost;
  u += Math.abs(lost) * 0.25;

  // Intégration dans le repère piste
  const cp = Math.cos(ship.psi);
  const sp = Math.sin(ship.psi);
  let vs = u * cp - w * sp;
  let vx = u * sp + w * cp;
  const ds = (vs * dt) / Math.max(0.5, 1 - kR * ship.x);
  ship.s += ds;
  ship.x += vx * dt;
  ship.psi = wrapAngle(ship.psi + dpsi - kR * ds);

  // Murs
  let damagingImpact = 0;
  const lim = track.halfWidth - SHIP_HALF_WIDTH;
  ship.scrape = 0;
  if (Math.abs(ship.x) > lim) {
    const side = Math.sign(ship.x);
    ship.x = side * lim;
    if (vx * side > 0) {
      const impact = Math.abs(vx);
      vx = -vx * 0.25;
      vs *= 1 - Math.min(0.45, impact * 0.012);
      if (impact > 3 && ship.wallCooldown <= 0) {
        if (!ship.shielded) ship.energy -= impact * 0.55 * perf.armor;
        ship.wallCooldown = 0.25;
        damagingImpact = impact;
      }
    }
    vs *= 1 - 0.5 * dt;
    ship.scrape = side;
    // le mur réaligne le vaisseau
    if (Math.abs(ship.psi) < Math.PI / 2) ship.psi *= 1 - Math.min(1, dt * 3);
    const cp2 = Math.cos(ship.psi);
    const sp2 = Math.sin(ship.psi);
    u = vs * cp2 + vx * sp2;
    w = -vs * sp2 + vx * cp2;
  }

  ship.u = u;
  ship.w = w;
  if (stunned) ship.spin += dt * 14 * (ship.stunTime / 0.9);
  else ship.spin *= 1 - Math.min(1, dt * 8);
  return damagingImpact;
}
