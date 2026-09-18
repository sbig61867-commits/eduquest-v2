import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: {
      "lightningcss": path.resolve(__dirname, "empty-stub.js"),
    },
  },
  optimizeDeps: {
    include: ["styled-jsx/style"],
  },
  ssr: {
    noExternal: ["styled-jsx"],
  },
});
