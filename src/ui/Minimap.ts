import type { Ship } from '../race/Ship';
import { createFrame, type Track } from '../track/Track';
import { hexColor } from './format';

const SIZE = 360;
const MARGIN = 20;
const frame = createFrame();

/** Vue de dessus du circuit sur un canvas 2D. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly path = new Path2D();
  private readonly project: (x: number, z: number) => [number, number];
  private readonly start: [number, number];

  constructor(canvas: HTMLCanvasElement, private readonly track: Track) {
    canvas.width = canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
    const xs = track.points.map((p) => p.x);
    const zs = track.points.map((p) => p.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const w = Math.max(...xs) - minX;
    const h = Math.max(...zs) - minZ;
    const scale = (SIZE - 2 * MARGIN) / Math.max(w, h);
    const ox = (SIZE - w * scale) / 2;
    const oz = (SIZE - h * scale) / 2;
    this.project = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];
    track.points.forEach((p, i) => {
      const [a, b] = this.project(p.x, p.z);
      if (i === 0) this.path.moveTo(a, b);
      else this.path.lineTo(a, b);
    });
    this.path.closePath();
    this.start = this.project(track.points[0].x, track.points[0].z);
  }

  draw(ships: readonly Ship[]): void {
    const g = this.ctx;
    g.clearRect(0, 0, SIZE, SIZE);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(46,242,255,0.25)';
    g.lineWidth = 12;
    g.stroke(this.path);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.stroke(this.path);
    g.fillStyle = '#fff';
    g.fillRect(this.start[0] - 2, this.start[1] - 8, 4, 16);

    for (const ship of ships) {
      if (ship.dead) continue;
      const f = this.track.frameAt(ship.s, frame);
      const [a, b] = this.project(f.p.x + f.r.x * ship.x, f.p.z + f.r.z * ship.x);
      g.fillStyle = hexColor(ship.color);
      g.beginPath();
      g.arc(a, b, ship.isPlayer ? 9 : 6, 0, Math.PI * 2);
      g.fill();
      if (ship.isPlayer) {
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.stroke();
      }
    }
  }
}
