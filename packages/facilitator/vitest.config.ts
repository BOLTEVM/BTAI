import { defineConfig } from "vitest/config";

export default defineConfig({
  // node:sqlite is a Node 22.5+ builtin that vite's builtin module list
  // predates; mark it external so tests run against the real builtin.
  ssr: { external: ["node:sqlite"] },
  test: {
    environment: "node",
    testTimeout: 60_000,
  },
});
