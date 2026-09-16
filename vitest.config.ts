import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "seeds/**/*.test.ts", "conformance/**/*.test.ts"],
    exclude: ["conformance/*/.work/**", "node_modules/**"],
  },
});
