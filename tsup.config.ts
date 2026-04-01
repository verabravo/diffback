import { defineConfig } from "tsup";
import { readFileSync } from "fs";
import { resolve } from "path";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __CLIENT_HTML__: JSON.stringify(
      readFileSync(resolve("src/client.html"), "utf-8")
    ),
  },
  clean: true,
  minify: false,
});
