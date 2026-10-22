import { AudioEngine } from "./audio/AudioEngine";
import { Renderer } from "./render/Renderer";
import { StoryRuntime, type RuntimeEvent } from "./story/StoryRuntime";
import type { Story } from "./story/schema";
import { validateStory } from "./story/validate";
import { DomHud } from "./ui/Hud";
import type { LocationDef } from "./world/Location";
import { ThreeStage } from "./world/ThreeStage";

export interface Chapter {
  number: string;
  story: Story;
}

export interface EngineOptions {
  host: HTMLElement;
  // Heading for the chapter menu, e.g. the book title.
  title: string;
  chapters: Chapter[];
  locations: Record<string, LocationDef>;
  fast?: boolean;
  muted?: boolean;
}

const PROGRESS_KEY = "novel-engine:progress";

interface Progress {
  [storyId: string]: { scene: string; title: string };
}

function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // Storage can be unavailable (private mode); progress is a convenience.
  }
}

// Wires the renderer, stage, HUD and story runtime together, runs the frame
// loop, and moves between the chapter menu and chapters.
export class Engine {
  readonly stage: ThreeStage;
  readonly hud: DomHud;
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  // Events of the chapter being played (reset when a chapter starts).
  events: RuntimeEvent[] = [];
  story: Story;
  runtime: StoryRuntime;
  private last = performance.now();
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;

  constructor(private readonly opts: EngineOptions) {
    const info = Object.fromEntries(Object.entries(opts.locations).map(([id, d]) => [id, d.info]));
    for (const { story } of opts.chapters) {
      const issues = validateStory(story, info);
      if (issues.length) {
        throw new Error(`story "${story.id}" is invalid:\n` + issues.map((i) => `  ${i.scene ?? "-"}: ${i.message}`).join("\n"));
      }
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
    this.story = opts.chapters[0].story;
    this.runtime = this.makeRuntime(this.story);

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

  private makeRuntime(story: Story): StoryRuntime {
    this.story = story;
    this.events = [];
    const rt = new StoryRuntime(story, this.stage, this.hud);
    rt.on((e) => {
      this.events.push(e);
      const progress = loadProgress();
      if (e.type === "choice") {
        progress[story.id] = { scene: e.checkpoint, title: story.scenes[e.checkpoint].title ?? story.title };
        saveProgress(progress);
      }
      if (e.type === "ending" && e.ending.kind === "victory") {
        delete progress[story.id];
        saveProgress(progress);
      }
    });
    this.runtime = rt;
    return rt;
  }

  // With `from`, jumps straight into the chapter containing that scene;
  // otherwise shows the chapter menu, and returns to it after a chapter.
  async start(opts: { from?: string } = {}): Promise<void> {
    requestAnimationFrame(this.frame);
    if (opts.from) {
      const chapter = this.opts.chapters.find((c) => opts.from! in c.story.scenes);
      if (!chapter) throw new Error(`no chapter has a scene "${opts.from}"`);
      this.hud.setLetterbox(true);
      this.audio.unlock();
      await this.makeRuntime(chapter.story).start({ skipTitle: true, from: opts.from });
    }
    for (;;) {
      // The opening room of the first chapter plays behind the menu.
      const first = this.opts.chapters[0].story;
      await this.stage.showcase(first.scenes[first.start].location);
      const progress = loadProgress();
      const pick = await this.hud.showMenu(
        this.opts.title,
        this.opts.chapters.map((c) => ({ id: c.story.id, number: c.number, title: c.story.title, resumeLabel: progress[c.story.id]?.title })),
      );
      const story = this.opts.chapters.find((c) => c.story.id === pick.id)!.story;
      const from = pick.resume ? progress[story.id]?.scene : undefined;
      await this.makeRuntime(story).start({ skipTitle: true, from });
    }
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
