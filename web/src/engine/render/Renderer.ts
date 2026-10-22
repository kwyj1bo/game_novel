import * as THREE from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  BlendFunction,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { damp } from "../core/math";

// WebGL renderer with an HDR post chain: bloom for magic and flames,
// filmic tone mapping, vignette, grain and a saturation control used to
// drain colour while the player is making a choice.
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly hueSat: HueSaturationEffect;
  private readonly bloom: BloomEffect;
  private saturation = 0;
  private targetSaturation = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false,
      preserveDrawingBuffer: new URLSearchParams(location.search).has("capture"),
    });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.2, intensity: 1.15, radius: 0.7 });
    this.hueSat = new HueSaturationEffect({ saturation: 0 });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    noise.blendMode.opacity.value = 0.05;
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, this.hueSat, vignette, noise));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  setSize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h, false);
  }

  // 0 = normal, -1 = greyscale.
  setSaturation(v: number): void {
    this.targetSaturation = v;
  }

  render(dt: number): void {
    this.saturation = damp(this.saturation, this.targetSaturation, 4, dt);
    this.hueSat.saturation = this.saturation;
    this.composer.render(dt);
  }
}
