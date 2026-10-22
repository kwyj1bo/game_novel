import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 6 * 60_000,
  fullyParallel: true,
  workers: 4,
  // One retry, with a trace, so a timing flake is reported as "flaky" with evidence.
  retries: 1,
  reporter: [["list"]],
  use: {
    // Own ports, backend and library: test uploads never touch your real library.
    baseURL: "http://localhost:5174",
    viewport: { width: 1280, height: 720 },
    trace: "on-first-retry",
    launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] },
  },
  webServer: [
    {
      command: "npx vite --port 5174 --strictPort",
      url: "http://localhost:5174",
      env: { API_TARGET: "http://localhost:8001" },
      reuseExistingServer: false,
    },
    {
      // The novel pipeline behind the upload button, with a throwaway library.
      command: "rm -rf web/test-results/library && venv/bin/uvicorn app.main:app --port 8001",
      cwd: "..",
      url: "http://localhost:8001/docs",
      env: { NOVEL_LIBRARY: "web/test-results/library" },
      reuseExistingServer: false,
    },
  ],
});
