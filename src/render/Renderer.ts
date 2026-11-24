import { ACESFilmicToneMapping, Color, type Object3D, DirectionalLight, FogExp2, HalfFloatType, HemisphereLight, LinearFilter, PerspectiveCamera, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LITE } from '../core/device';
import type { CircuitTheme } from '../track/circuits';
import { SKY_LAYER } from './layers';

/** Bloom de base (le décor le module : retenu dans les virages et les passages calmes). */
export const BLOOM_STRENGTH = 0.6;

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
    this.bloom = new UnrealBloomPass(new Vector2(innerWidth, innerHeight), BLOOM_STRENGTH, 0.4, 0.9);
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

  private bloomScale = LITE ? 0.5 : 1;
  private pixelScale = 1;
  /**
   * Ciel rendu à part, à cette fraction de la définition (1 : directement dans la scène).
   * Utile seulement quand le GPU est limité par le remplissage (mobile, palier de qualité ≥ 1) :
   * sur une carte de bureau, la passe supplémentaire coûte autant qu'elle économise (mesuré).
   * `?ciel=demi` force la demi-définition (comparaison).
   */
  private skyScale = new URLSearchParams(location.search).get('ciel') === 'demi' ? 0.5 : LITE ? 0.35 : 1;
  private readonly skyTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  private readonly size = new Vector2();
  /** Ciel du décor affiché (dessiné seul dans sa texture, sans parcourir la scène). */
  sky: Object3D | null = null;
  private readonly clearColor = new Color();
  /** Intensité du bloom voulue par le décor (la scène l'ajuste selon la musique et la lisibilité). */
  bloomStrength = BLOOM_STRENGTH;

  /** Baisse de qualité (palier 2 : bloom à demi-résolution ; palier 3 : définition réduite). */
  setQualityDrop(level: number): void {
    this.bloomScale = level >= 2 || LITE ? 0.5 : 1;
    if (level >= 1) this.skyScale = 0.35;
    this.pixelScale = level >= 3 ? 0.75 : 1;
    this.gl.setPixelRatio((LITE ? 1 : Math.min(devicePixelRatio, 1.5)) * this.pixelScale);
    this.resize();
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    if (this.bloomScale < 1) this.bloom.setSize(Math.ceil(innerWidth * this.bloomScale), Math.ceil(innerHeight * this.bloomScale));
    this.gl.getDrawingBufferSize(this.size);
    this.skyTarget.setSize(Math.max(1, Math.ceil(this.size.x * this.skyScale)), Math.max(1, Math.ceil(this.size.y * this.skyScale)));
  }

  /**
   * Compile d'avance les shaders de tout ce qui peut apparaître (objets encore cachés compris) :
   * sans cela, Three.js compile un matériau à sa première apparition, en pleine course
   * (saccades de 50 à 190 ms mesurées : lignes de vitesse, décor, éclairs du ciel).
   * On compile pour la cible hors écran du post-process : le programme dépend de la cible
   * (tone mapping, espace colorimétrique), compiler pour l'écran ne servirait à rien.
   * @param skip sous-arbres à laisser tels quels (décors des autres circuits)
   */
  warmUp(skip: (o: Object3D) => boolean = () => false): void {
    const hidden: Object3D[] = [];
    const culled: Object3D[] = [];
    const reveal = (o: Object3D): void => {
      if (skip(o)) return;
      if (!o.visible) {
        o.visible = true;
        hidden.push(o);
      }
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
      for (const c of o.children) reveal(c);
    };
    reveal(this.scene);
    const gl = this.gl;
    const target = gl.getRenderTarget();
    const layers = this.camera.layers.mask;
    this.camera.layers.enableAll();
    // un rendu complet, hors champ compris : compile les shaders (y compris la compilation
    // différée d'ANGLE au premier dessin) et envoie géométries et textures au GPU.
    // Il est écrasé par l'image suivante.
    gl.setRenderTarget(this.composer.readBuffer);
    gl.render(this.scene, this.camera);
    this.camera.layers.mask = layers;
    gl.setRenderTarget(target);
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
  }

  render(): void {
    this.bloom.strength = this.bloomStrength;
    const cam = this.camera;
    if (this.sky && this.skyScale > 0 && this.skyScale < 1) {
      // 1) le ciel seul, en basse définition, dans une texture
      const gl = this.gl;
      cam.layers.set(SKY_LAYER);
      gl.getClearColor(this.clearColor);
      const alpha = gl.getClearAlpha();
      gl.setRenderTarget(this.skyTarget);
      gl.setClearColor(this.background, 1);
      gl.render(this.sky, cam);
      gl.setRenderTarget(null);
      gl.setClearColor(this.clearColor, alpha);
      // 2) la scène, avec cette texture pour fond
      cam.layers.set(0);
      this.scene.background = this.skyTarget.texture;
    } else {
      cam.layers.set(0);
      cam.layers.enable(SKY_LAYER);
      this.scene.background = this.background;
    }
    this.composer.render();
  }
}
