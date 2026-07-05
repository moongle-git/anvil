import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // web 워크스페이스는 자체 vitest(jsdom)를 사용한다 — 루트(node)에서 줍지 않는다
    exclude: [...configDefaults.exclude, "web/**"],
  },
});
