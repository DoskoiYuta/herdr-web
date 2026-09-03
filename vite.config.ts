import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./src/web", import.meta.url));
const contract = fileURLToPath(new URL("./src/contract", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": root,
      "@contract": contract,
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./src/web/test/setup.ts", import.meta.url))],
    include: ["src/web/**/*.test.{ts,tsx}"],
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
});
