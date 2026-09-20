import path from "path";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      obsidian: path.resolve(root, "test/obsidian-stub.ts"),
    },
  },
});
