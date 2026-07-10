import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Tests read real skill .md files; the working directory matters for the
    // skills loader's __dirname resolution. Vitest defaults to repo root,
    // which is fine — the loader resolves SKILLS_BUILTIN from its own module
    // path, not cwd.
    testTimeout: 10_000,
  },
});
