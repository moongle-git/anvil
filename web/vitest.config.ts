import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      // 루트 src/types를 단일 소스로 import한다 (ADR-006) — tsconfig paths와 동일하게 유지
      "@anvil/types": path.resolve(dirname, "../src/types/index.ts"),
      "@anvil/runStore": path.resolve(dirname, "../src/lib/runStore.ts"),
    },
  },
});
