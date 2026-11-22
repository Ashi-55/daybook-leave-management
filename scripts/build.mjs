import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/web", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["web/main.ts"],
    bundle: true,
    target: "es2016",
    sourcemap: true,
    outfile: "dist/web/app.js",
    loader: { ".html": "text" },
  }),
  build({
    entryPoints: ["api/main.ts"],
    platform: "node",
    bundle: true,
    packages: "external",
    outfile: "dist/api/main.cjs",
    format: "cjs",
    sourcemap: true,
  }),
  ...["index.html", "style.css"].map((name) =>
    copyFile("web/" + name, "dist/web/" + name),
  ),
]);
