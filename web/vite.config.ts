import { defineConfig } from "vitest/config";

export default defineConfig({
  // /api goes to the Python backend (uvicorn app.main:app --port 8000).
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://localhost:8000" } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
