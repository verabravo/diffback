import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { resolve } from "path";

const html = readFileSync(resolve("src/client.html"), "utf-8");
const js = readFileSync(resolve("src/client.js"), "utf-8");
const clientHtml = html.replace("__CLIENT_JS__", js);

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __CLIENT_HTML__: JSON.stringify(clientHtml),
  },
  clean: true,
  minify: false,
});
