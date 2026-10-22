import type { AudioEngine } from "../audio/AudioEngine";
import type { EndingAction, Hud, Speaker } from "../story/ports";
import type { Choice, Ending, Story } from "../story/schema";

export interface MenuChapter {
  id: string;
  number: string;
  title: string;
  // Set when there is saved progress to resume.
  resumeLabel?: string;
}

export interface HudOptions {
  // Testing mode: instant text, short holds.
  fast: boolean;
  onChoiceMode(active: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

// DOM overlay: subtitles with typewriter, timed choice cards, scene cards,
// title and ending screens. Input: click, Space/Enter to advance, 1/2/3 or
// arrow keys to choose.
export class DomHud implements Hud {
  private readonly root: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly speakerEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly card: HTMLElement;
  private readonly choiceEl: HTMLElement;
  private readonly letterbox: HTMLElement[];
  private advanceFn: (() => void) | null = null;
  private pickFn: ((i: number) => void) | null = null;
  auto = true;
  // Exposed for tests and debugging.
  state: "idle" | "title" | "line" | "choice" | "ending" = "idle";
  lastLine = "";

  constructor(
    host: HTMLElement,
    private readonly audio: AudioEngine,
    private readonly opts: HudOptions,
  ) {
    this.root = el("div", "hud", host);
    this.letterbox = [el("div", "bar top", this.root), el("div", "bar bottom", this.root)];
    this.card = el("div", "scene-card", this.root);
    this.subtitle = el("div", "subtitle", this.root);
    this.speakerEl = el("div", "speaker", this.subtitle);
    this.textEl = el("div", "line", this.subtitle);
    this.choiceEl = el("div", "choice", this.root);
    this.buildToolbar();

    host.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.advanceFn?.();
    });
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        if (this.state === "line") {
          e.preventDefault();
          this.advanceFn?.();
        }
      }
      if (this.pickFn) {
        const n = Number(e.key);
        if (n >= 1 && n <= 3) this.pickFn(n - 1);
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "q") this.pickFn(0);
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "e") this.pickFn(1);
      }
    });
  }

  private buildToolbar(): void {
    const bar = el("div", "toolbar", this.root);
    const autoBtn = el("button", "tool", bar, "Auto ●");
    autoBtn.title = "Auto-advance dialogue";
    autoBtn.onclick = () => {
      this.auto = !this.auto;
      autoBtn.textContent = this.auto ? "Auto ●" : "Auto ○";
    };
    const sndBtn = el("button", "tool", bar, "Sound ●");
    sndBtn.onclick = () => {
      this.audio.enabled = !this.audio.enabled;
      this.audio.setMuted(!this.audio.enabled);
      sndBtn.textContent = this.audio.enabled ? "Sound ●" : "Sound ○";
    };
  }

  setLetterbox(on: boolean): void {
    for (const b of this.letterbox) b.classList.toggle("on", on);
  }

  // ---- Hud port --------------------------------------------------------

  showTitle(story: Story): Promise<void> {
    this.state = "title";
    const screen = el("div", "screen title-screen", this.root);
    el("div", "eyebrow", screen, "An interactive novel");
    el("h1", "title", screen, story.title);
    if (story.subtitle) el("div", "subtitle-text", screen, story.subtitle);
    const btn = el("button", "primary", screen, "Begin");
    el("div", "hint", screen, "Click or Space to advance · 1 / 2 to choose");
    return new Promise((resolve) => {
      btn.onclick = () => {
        this.audio.unlock();
        screen.classList.add("leaving");
        setTimeout(() => screen.remove(), 900);
        this.state = "idle";
        this.setLetterbox(true);
        resolve();
      };
    });
  }

  // Chapter select. Resolves with the chosen chapter and whether to resume it.
  showMenu(heading: string, chapters: MenuChapter[], upload?: (file: File) => Promise<MenuChapter[]>): Promise<{ id: string; resume: boolean }> {
    this.state = "title";
    this.setLetterbox(false);
    const screen = el("div", "screen title-screen", this.root);
    el("div", "eyebrow", screen, "An interactive novel");
    el("h1", "title", screen, heading);
    const list = el("div", "chapters", screen);
    el("div", "hint", screen, "Click or Space to advance · 1 / 2 to choose");
    return new Promise((resolve) => {
      const go = (id: string, resume: boolean) => {
        this.audio.unlock();
        screen.classList.add("leaving");
        setTimeout(() => screen.remove(), 900);
        this.state = "idle";
        this.setLetterbox(true);
        resolve({ id, resume });
      };
      const addCard = (c: MenuChapter, before?: HTMLElement) => {
        const card = el("div", "chapter");
        list.insertBefore(card, before ?? null);
        card.dataset.id = c.id;
        el("div", "chapter-number", card, c.number);
        el("div", "chapter-title", card, c.title);
        const row = el("div", "actions", card);
        el("button", "primary", row, "Begin").onclick = () => go(c.id, false);
        if (c.resumeLabel) el("button", "secondary", row, `Continue · ${c.resumeLabel}`).onclick = () => go(c.id, true);
      };
      chapters.forEach((c) => addCard(c));
      if (!upload) return;
      // Upload card: a novel goes to the pipeline and comes back as chapters.
      const card = el("div", "chapter upload", list);
      el("div", "chapter-number", card, "Your own book");
      el("div", "chapter-title", card, "Upload a novel");
      const input = el("input", "file-input", card) as HTMLInputElement;
      input.type = "file";
      input.accept = ".pdf,.txt";
      const status = el("div", "upload-status", card, "PDF or plain text");
      const row = el("div", "actions", card);
      const pickBtn = el("button", "secondary", row, "Choose file");
      pickBtn.onclick = () => input.click();
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        pickBtn.disabled = true;
        status.textContent = `Reading “${file.name}”…`;
        try {
          const added = await upload(file);
          added.forEach((c) => addCard(c, card));
          status.textContent = `Added ${added.length} chapter${added.length === 1 ? "" : "s"}.`;
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : String(e);
        } finally {
          pickBtn.disabled = false;
          input.value = "";
        }
      };
    });
  }

  sceneCard(title: string): Promise<void> {
    this.card.textContent = title;
    this.card.classList.remove("show");
    void this.card.offsetWidth;
    this.card.classList.add("show");
    return new Promise((r) => setTimeout(r, this.opts.fast ? 0 : 500));
  }

  showLine(speaker: Speaker | null, text: string, mood?: string): Promise<void> {
    this.state = "line";
    this.lastLine = text;
    this.subtitle.classList.add("show");
    this.subtitle.classList.toggle("narration", !speaker);
    this.subtitle.dataset.mood = mood ?? "";
    this.speakerEl.textContent = speaker?.name ?? "";
    this.speakerEl.style.color = speaker?.color ?? "";
    this.textEl.textContent = "";
    const cps = this.opts.fast ? 10000 : speaker ? 42 : 34;

    return new Promise((resolve) => {
      let shown = 0;
      let typing = true;
      let holdTimer = 0;
      const start = performance.now();
      const finishTyping = () => {
        typing = false;
        this.textEl.textContent = text;
        const hold = this.opts.fast ? 60 : 1100 + text.length * 32;
        if (this.auto || this.opts.fast) holdTimer = window.setTimeout(done, hold);
      };
      const done = () => {
        clearTimeout(holdTimer);
        this.advanceFn = null;
        this.state = "idle";
        this.subtitle.classList.remove("show");
        resolve();
      };
      this.advanceFn = () => (typing ? finishTyping() : done());
      const tick = () => {
        if (!typing) return;
        const n = Math.min(text.length, Math.floor(((performance.now() - start) / 1000) * cps));
        if (n > shown) {
          if (speaker && Math.floor(n / 3) > Math.floor(shown / 3) && text[n - 1] !== " ") this.audio.blip(speaker.voice);
          shown = n;
          this.textEl.textContent = text.slice(0, n);
        }
        if (n >= text.length) finishTyping();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  hideLine(): void {
    this.subtitle.classList.remove("show");
  }

  showChoice(choice: Choice): Promise<number> {
    this.state = "choice";
    this.opts.onChoiceMode(true);
    this.audio.sfx("choice");
    this.audio.heartbeat(true);
    const box = this.choiceEl;
    box.innerHTML = "";
    el("div", "prompt", box, choice.prompt);
    const timer = el("div", "timer", box);
    const fill = el("div", "fill", timer);
    const row = el("div", "options", box);
    const keys = ["1", "2", "3"];
    const buttons = choice.options.map((o, i) => {
      const b = el("button", "option", row);
      el("span", "key", b, keys[i]);
      el("span", "label", b, o.label);
      return b;
    });
    box.classList.add("show");
    const seconds = this.opts.fast ? 30 : choice.seconds;
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
    void fill.offsetWidth;
    fill.style.transition = `transform ${seconds}s linear`;
    fill.style.transform = "scaleX(0)";

    return new Promise((resolve) => {
      const finish = (i: number) => {
        if (!this.pickFn) return;
        this.pickFn = null;
        this.state = "idle";
        clearTimeout(timeout);
        this.audio.heartbeat(false);
        if (i >= 0) {
          this.audio.sfx("select");
          buttons[i].classList.add("picked");
          buttons.forEach((b, j) => j !== i && b.classList.add("faded"));
        } else {
          box.classList.add("timeout");
        }
        const computed = getComputedStyle(fill).transform;
        fill.style.transition = "none";
        fill.style.transform = computed;
        setTimeout(
          () => {
            box.classList.remove("show", "timeout");
            this.opts.onChoiceMode(false);
            resolve(i);
          },
          this.opts.fast ? 0 : 750,
        );
      };
      this.pickFn = finish;
      buttons.forEach((b, i) => (b.onclick = () => finish(i)));
      const timeout = window.setTimeout(() => finish(-1), seconds * 1000);
    });
  }

  showEnding(ending: Ending, canRetry: boolean): Promise<EndingAction> {
    this.state = "ending";
    this.setLetterbox(false);
    this.audio.music(ending.kind === "victory" ? "triumph" : "sorrow");
    const screen = el("div", `screen ending ${ending.kind}`, this.root);
    el("div", "eyebrow", screen, ending.kind === "victory" ? "Chapter complete" : ending.kind === "death" ? "You died" : "The story ends here");
    el("h1", "title", screen, ending.title);
    el("p", "body", screen, ending.text);
    const row = el("div", "actions", screen);
    return new Promise((resolve) => {
      const go = (a: EndingAction) => {
        screen.classList.add("leaving");
        setTimeout(() => screen.remove(), 700);
        this.state = "idle";
        this.setLetterbox(true);
        resolve(a);
      };
      if (canRetry) el("button", "primary", row, "Try again").onclick = () => go("retry");
      el("button", canRetry ? "secondary" : "primary", row, ending.kind === "victory" ? "Play again" : "Restart chapter").onclick = () => go("restart");
      el("button", "secondary", row, "Chapters").onclick = () => go("menu");
    });
  }

  // ---- test hooks --------------------------------------------------------

  advance(): void {
    this.advanceFn?.();
  }

  pick(i: number): void {
    this.pickFn?.(i);
  }

  clickEnding(label: string): boolean {
    const b = [...this.root.querySelectorAll<HTMLButtonElement>(".ending button")].find((x) => x.textContent === label);
    b?.click();
    return !!b;
  }
}
