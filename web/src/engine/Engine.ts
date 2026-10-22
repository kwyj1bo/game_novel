import { AudioEngine } from "./audio/AudioEngine";
import { Renderer } from "./render/Renderer";
import { StoryRuntime, type RuntimeEvent } from "./story/StoryRuntime";
import type { Story } from "./story/schema";
import { validateStory } from "./story/validate";
import { DomHud } from "./ui/Hud";
import type { LocationDef } from "./world/Location";
import { ThreeStage } from "./world/ThreeStage";

export interface EngineOptions {
  host: HTMLElement;
  story: Story;
  locations: Record<string, LocationDef>;
  fast?: boolean;
  muted?: boolean;
}

// Wires the renderer, stage, HUD and story runtime together and runs the frame loop.
export class Engine {
  readonly stage: ThreeStage;
  readonly hud: DomHud;
  readonly runtime: StoryRuntime;
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  readonly events: RuntimeEvent[] = [];
  private last = performance.now();
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;

  constructor(opts: EngineOptions) {
    const info = Object.fromEntries(Object.entries(opts.locations).map(([id, d]) => [id, d.info]));
    const issues = validateStory(opts.story, info);
    if (issues.length) {
      throw new Error(`story "${opts.story.id}" is invalid:\n` + issues.map((i) => `  ${i.scene ?? "-"}: ${i.message}`).join("\n"));
    }
    if (opts.muted) this.audio.enabled = false;

    const host = opts.host;
    const canvas = document.createElement("canvas");
    canvas.className = "view";
    host.appendChild(canvas);
    const overlay = document.createElement("div");
    overlay.className = "fade";
    host.appendChild(overlay);

    this.stage = new ThreeStage(opts.locations, this.audio, overlay, host.clientWidth / host.clientHeight);
    this.renderer = new Renderer(canvas, this.stage.scene, this.stage.rig.camera);
    this.stage.setupEnvironment(this.renderer.gl);
    this.hud = new DomHud(host, this.audio, {
      fast: !!opts.fast,
      onChoiceMode: (on) => {
        this.renderer.setSaturation(on ? -0.75 : 0);
        this.stage.rig.handheld = on ? 2.5 : 1;
      },
    });
    this.runtime = new StoryRuntime(opts.story, this.stage, this.hud);
    this.runtime.on((e) => this.events.push(e));

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.stage.rig.setAspect(w / h);
      this.stage.particles.setViewportHeight(h * Math.min(window.devicePixelRatio, 2));
    };
    new ResizeObserver(resize).observe(host);
    resize();
  }

  start(opts: { skipTitle?: boolean; from?: string } = {}): Promise<void> {
    requestAnimationFrame(this.frame);
    if (opts.skipTitle) {
      this.hud.setLetterbox(true);
      this.audio.unlock();
    }
    return this.runtime.start(opts);
  }

  private frame = (now: number) => {
    // Clamp dt so a background tab doesn't teleport everything on return.
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.stage.update(dt);
    this.renderer.render(dt);
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    requestAnimationFrame(this.frame);
  };
}
