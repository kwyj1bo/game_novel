import { AudioEngine } from "./audio/AudioEngine";
import { Renderer } from "./render/Renderer";
import { StoryRuntime, type RuntimeEvent } from "./story/StoryRuntime";
import type { ActionRegistry } from "./story/actions";
import { StorySchema, type Story } from "./story/schema";
import { validateStory, type LocationRegistryInfo } from "./story/validate";
import { DomHud } from "./ui/Hud";
import type { LocationDef } from "./world/Location";
import { ThreeStage } from "./world/ThreeStage";

export interface Chapter {
  number: string;
  // Either the story itself, or where to fetch it when the player picks it.
  story?: Story;
  url?: string;
  // Stable id for the menu and saved progress (defaults to the story id).
  key?: string;
  title?: string;
  // The uploaded book it comes from (the menu groups these under Saved books).
  book?: string;
}

export interface EngineOptions {
  host: HTMLElement;
  // Heading for the chapter menu.
  title: string;
  chapters: Chapter[];
  locations: Record<string, LocationDef>;
  // Scenery that plays behind the menu when there is no chapter to borrow from.
  menuScenery: string;
  fast?: boolean;
  muted?: boolean;
  // Endpoint that turns an uploaded novel into stories (the novel pipeline).
  uploadUrl?: string;
  // Endpoint listing books built so far; their chapters join the menu.
  libraryUrl?: string;
  // Action assets ("act" beats expand from these).
  actions?: ActionRegistry;
  // Builds the places a story brings with it (generated for its book).
  storyLocations?: (story: Story) => Record<string, LocationDef>;
}

interface LibraryBook {
  id: string;
  source: string;
  chapters: { heading: string; title: string; file: string }[];
}

interface UploadResponse {
  source: string;
  book: LibraryBook | null;
  stories: { heading: string; story: unknown }[];
  skipped: { heading: string; error: string }[];
}

const keyOf = (c: Chapter) => c.key ?? c.story!.id;

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
  // The chapter being played (set once one starts).
  story!: Story;
  runtime!: StoryRuntime;
  private readonly locationInfo: Record<string, LocationRegistryInfo[string]>;
  private last = performance.now();
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;

  constructor(private readonly opts: EngineOptions) {
    const info = (this.locationInfo = Object.fromEntries(Object.entries(opts.locations).map(([id, d]) => [id, d.info])));
    for (const { story } of opts.chapters) {
      if (!story) continue;
      this.addLocations(story);
      const issues = validateStory(story, info, opts.actions);
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

  // Sends a novel to the pipeline and adds every valid chapter it returns.
  private async upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(this.opts.uploadUrl!, { method: "POST", body });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail ?? `Upload failed (${res.status})`);
    }
    const data = (await res.json()) as UploadResponse;
    const added = [];
    for (const [i, { heading, story: raw }] of data.stories.entries()) {
      const story = this.check(raw);
      if (!story) continue;
      // Same key as the library entry, so a reload doesn't list the chapter twice.
      const key = data.book?.chapters[i]?.file ?? story.id;
      const known = this.opts.chapters.findIndex((c) => keyOf(c) === key);
      const chapter: Chapter = { key, number: heading, title: story.title, story, book: data.source };
      if (known >= 0) this.opts.chapters[known] = chapter;
      else this.opts.chapters.push(chapter);
      added.push({ id: key, number: chapter.number, title: story.title, book: data.source });
    }
    if (!added.length) throw new Error("No playable chapters could be made from that file.");
    return added;
  }

  // Makes a story's own places known to the stage and the validator.
  private addLocations(story: Story): void {
    for (const [id, def] of Object.entries(this.opts.storyLocations?.(story) ?? {})) {
      if (this.opts.locations[id]) continue;
      this.opts.locations[id] = def;
      this.locationInfo[id] = def.info;
    }
  }

  // Parses and validates a story from outside; null when it can't be played.
  private check(raw: unknown): Story | null {
    const parsed = StorySchema.safeParse(raw);
    if (!parsed.success) return null;
    this.addLocations(parsed.data);
    const issues = validateStory(parsed.data, this.locationInfo, this.opts.actions);
    if (issues.length) {
      console.warn(`story ${parsed.data.id} skipped:`, issues);
      return null;
    }
    return parsed.data;
  }

  // Adds chapters of books in the library that the menu doesn't have yet.
  private async syncLibrary(): Promise<void> {
    if (!this.opts.libraryUrl) return;
    try {
      const res = await fetch(this.opts.libraryUrl);
      if (!res.ok) return;
      const books = (await res.json()) as LibraryBook[];
      for (const b of books) {
        for (const c of b.chapters) {
          if (this.opts.chapters.some((x) => keyOf(x) === c.file)) continue;
          this.opts.chapters.push({ key: c.file, number: c.heading, title: c.title, url: `${this.opts.libraryUrl}/${c.file}`, book: b.source });
        }
      }
    } catch {
      // No backend running: the menu still works with what it has.
    }
  }

  private async load(c: Chapter): Promise<Story> {
    if (c.story) return c.story;
    const res = await fetch(c.url!);
    if (!res.ok) throw new Error(`could not load ${c.url}`);
    const story = this.check(await res.json());
    if (!story) throw new Error(`${c.title ?? c.url} is not a playable story`);
    c.story = story;
    return story;
  }

  private makeRuntime(story: Story, key = story.id): StoryRuntime {
    this.story = story;
    this.events = [];
    const rt = new StoryRuntime(story, this.stage, this.hud, this.opts.actions);
    rt.on((e) => {
      this.events.push(e);
      const progress = loadProgress();
      if (e.type === "choice") {
        progress[key] = { scene: e.checkpoint, title: story.scenes[e.checkpoint].title ?? story.title };
        saveProgress(progress);
      }
      if (e.type === "ending" && e.ending.kind === "victory") {
        delete progress[key];
        saveProgress(progress);
      }
    });
    this.runtime = rt;
    return rt;
  }

  // Shows one scenery with a drifting camera and nothing else (asset preview).
  async preview(sceneryId: string): Promise<void> {
    requestAnimationFrame(this.frame);
    await this.stage.showcase(sceneryId);
  }

  // With `from`, jumps straight into the chapter containing that scene;
  // otherwise shows the chapter menu, and returns to it after a chapter.
  async start(opts: { from?: string } = {}): Promise<void> {
    requestAnimationFrame(this.frame);
    if (opts.from) {
      const chapter = this.opts.chapters.find((c) => c.story && opts.from! in c.story.scenes);
      if (!chapter) throw new Error(`no chapter has a scene "${opts.from}"`);
      this.hud.setLetterbox(true);
      this.audio.unlock();
      await this.makeRuntime(chapter.story!, keyOf(chapter)).start({ skipTitle: true, from: opts.from });
    }
    for (;;) {
      await this.syncLibrary();
      // The first loaded chapter's opening room plays behind the menu.
      const first = this.opts.chapters.find((c) => c.story)?.story;
      await this.stage.showcase(first ? first.scenes[first.start].location : this.opts.menuScenery);
      const progress = loadProgress();
      const pick = await this.hud.showMenu(
        this.opts.title,
        this.opts.chapters.map((c) => ({ id: keyOf(c), number: c.number, title: c.title ?? c.story!.title, resumeLabel: progress[keyOf(c)]?.title, book: c.book })),
        this.opts.uploadUrl ? (file) => this.upload(file) : undefined,
      );
      const chapter = this.opts.chapters.find((c) => keyOf(c) === pick.id)!;
      let story: Story;
      try {
        story = await this.load(chapter);
      } catch (e) {
        console.error(e);
        continue;
      }
      const from = pick.resume ? progress[keyOf(chapter)]?.scene : undefined;
      await this.makeRuntime(story, keyOf(chapter)).start({ skipTitle: true, from });
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
