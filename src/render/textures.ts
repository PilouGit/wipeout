import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type WebGLRenderer } from 'three';

/** Couleur HDR (>1) pour que le bloom fasse briller l'objet. */
export const neon = (hex: number, intensity = 2.5): Color => new Color(hex).multiplyScalar(intensity);

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export interface Textures {
  readonly glow: CanvasTexture;
  readonly road: CanvasTexture;
  readonly chevron: CanvasTexture;
  readonly item: CanvasTexture;
  readonly checker: CanvasTexture;
  readonly banner: CanvasTexture;
  readonly windows: CanvasTexture;
}

export function createTextures(renderer: WebGLRenderer): Textures {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const make = (w: number, h: number, draw: Draw, repeat = false): CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = aniso;
    if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  };

  const banner = make(1024, 128, drawBanner);
  // Le logo utilise Orbitron : on le redessine une fois la police chargée.
  document.fonts
    ?.load('900 78px Orbitron')
    .then(() => {
      drawBanner((banner.image as HTMLCanvasElement).getContext('2d')!);
      banner.needsUpdate = true;
    })
    .catch(() => undefined);

  return {
    glow: make(128, 128, drawGlow),
    road: make(256, 256, drawRoad, true),
    chevron: make(128, 256, drawChevrons, true),
    item: make(128, 128, drawItemPad),
    checker: make(256, 32, drawChecker),
    banner,
    windows: make(64, 256, drawWindows),
  };
}

const drawGlow: Draw = (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
};

const drawRoad: Draw = (g) => {
  g.fillStyle = '#151827';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3500; i++) {
    const v = (18 + Math.random() * 22) | 0;
    g.fillStyle = `rgb(${v},${v + 3},${v + 16})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(110,130,200,0.22)';
  g.lineWidth = 2;
  for (let y = 0; y <= 256; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(210,225,255,0.32)';
  for (const x of [256 / 3, 512 / 3]) {
    g.fillRect(x - 2, 16, 4, 96);
    g.fillRect(x - 2, 144, 4, 96);
  }
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(0, 0, 16, 256);
  g.fillRect(240, 0, 16, 256);
};

// Le bas du canvas correspond à l'avant du pad : les chevrons pointent vers le bas.
const drawChevrons: Draw = (g) => {
  g.fillStyle = 'rgba(255,120,0,0.28)';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#ffd34d';
  g.lineWidth = 14;
  for (let k = 0; k < 4; k++) {
    const y = 18 + k * 64;
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(64, y + 38);
    g.lineTo(114, y);
    g.stroke();
  }
};

// Dessiné retourné pour être lisible depuis le cockpit.
const drawItemPad: Draw = (g) => {
  const gr = g.createLinearGradient(0, 0, 128, 128);
  gr.addColorStop(0, '#7a2cff');
  gr.addColorStop(1, '#ff3fb4');
  g.fillStyle = 'rgba(40,0,80,0.4)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = gr;
  g.lineWidth = 10;
  g.strokeRect(8, 8, 112, 112);
  g.fillStyle = '#ffffff';
  g.font = 'bold 84px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(64, 64);
  g.rotate(Math.PI);
  g.fillText('?', 0, 6);
  g.restore();
};

const drawChecker: Draw = (g) => {
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#ffffff' : '#111111';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
};

function drawBanner(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#0b0618';
  g.fillRect(0, 0, 1024, 128);
  g.font = '900 78px Orbitron, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const gr = g.createLinearGradient(200, 0, 824, 0);
  gr.addColorStop(0, '#2ef2ff');
  gr.addColorStop(1, '#ff3fb4');
  g.fillStyle = gr;
  g.fillText('HYPERGLIDE', 512, 68);
}

const drawWindows: Draw = (g) => {
  g.fillStyle = '#07060f';
  g.fillRect(0, 0, 64, 256);
  const cols = ['#2ef2ff', '#ff3fb4', '#ffd34d', '#9a7bff', '#ffffff'];
  for (let y = 4; y < 256; y += 8) {
    for (let x = 4; x < 64; x += 8) {
      if (Math.random() >= 0.28) continue;
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.globalAlpha = 0.35 + Math.random() * 0.6;
      g.fillRect(x, y, 4, 4);
    }
  }
  g.globalAlpha = 1;
};
