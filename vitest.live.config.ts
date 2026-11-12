import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The live PayPal sandbox suite (KTD15). It makes real sandbox calls, so it is not part of
// ./check. It needs the saved sandbox account from `npx tsx live/paypal-path.ts start|finish`.
// Run: npm run live
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["live/**/*.live.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
