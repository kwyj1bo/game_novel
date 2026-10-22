// Frame-driven tweens that resolve promises, so story beats can `await` motion
// and everything advances on the render clock (pauses with it, no setTimeout drift).

interface Task {
  elapsed: number;
  duration: number;
  step: (u: number) => void;
  resolve: () => void;
}

export class Timeline {
  private tasks: Task[] = [];

  tween(durationMs: number, step: (u: number) => void): Promise<void> {
    if (durationMs <= 0) {
      step(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tasks.push({ elapsed: 0, duration: durationMs / 1000, step, resolve });
    });
  }

  delay(ms: number): Promise<void> {
    return this.tween(ms, () => {});
  }

  update(dt: number): void {
    if (!this.tasks.length) return;
    const done: Task[] = [];
    for (const t of this.tasks) {
      t.elapsed += dt;
      const u = Math.min(1, t.elapsed / t.duration);
      t.step(u);
      if (u >= 1) done.push(t);
    }
    if (done.length) {
      this.tasks = this.tasks.filter((t) => !done.includes(t));
      for (const t of done) t.resolve();
    }
  }

  clear(): void {
    for (const t of this.tasks) t.resolve();
    this.tasks = [];
  }
}
