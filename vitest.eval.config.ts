import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The attack test (KTD15): real Claude Haiku against the counting fake PayPal and an in-memory
// database. It calls the Anthropic API, so it is not part of ./check. Run: npm run eval:attack
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["eval/**/*.eval.ts"],
    testTimeout: 30 * 60 * 1000,
    fileParallelism: false,
  },
});
