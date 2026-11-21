import { ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LITE } from '../core/device';
import type { CircuitTheme } from '../track/circuits';

/**
 * Moteur de rendu : scène, caméra, éclairage et post-process (bloom).
 * En qualité allégée (mobile) : pas d'antialiasing, définition 1×, bloom calculé à demi-résolution.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 9000);
  private readonly composer: EffectComposer;
  private readonly fog = new FogExp2(0x210924, 0.0011);
  private readonly background = new Color(0x210924);
  private readonly bloom: UnrealBloomPass;
  private readonly hemi = new HemisphereLight(0x9aa8ff, 0x2a0830, 1.0);

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new WebGLRenderer({ canvas, antialias: !LITE, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, 1.5));
    this.gl.setSize(innerWidth, innerHeight);
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;

    this.scene.fog = this.fog;
    this.scene.background = this.background;
    this.scene.add(this.camera);
    this.scene.add(this.hemi);
    const sun = new DirectionalLight(0xffd0ee, 1.6);
    sun.position.set(200, 400, -600);
    this.scene.add(sun);

    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Brouillard, fond et lumière d'ambiance d'un circuit. */
  setAtmosphere(theme: CircuitTheme): void {
    this.fog.color.set(theme.fog);
    this.fog.density = theme.fogDensity;
    this.background.set(theme.fog);
    this.hemi.color.set(theme.sky[0]).lerp(new Color(0xffffff), 0.4);
    this.hemi.groundColor.set(theme.fog);
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    if (LITE) this.bloom.setSize(Math.ceil(innerWidth / 2), Math.ceil(innerHeight / 2));
  }

  render(): void {
    this.composer.render();
  }
}
