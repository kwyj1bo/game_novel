import { defineConfig } from "vitest/config";

export default defineConfig({
  // /api goes to the Python backend (uvicorn app.main:app --port 8000).
  // API_TARGET lets the e2e suite point at its own backend and library.
  server: { port: 5173, strictPort: true, proxy: { "/api": process.env.API_TARGET ?? "http://localhost:8000" } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
