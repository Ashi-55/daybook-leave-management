import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";

// Stage only deployable assets. Local clusters and secrets stay outside this directory.
const root = "dist/vercel";
for (const dir of ["site", "api", "db"]) {
  await mkdir(root + "/" + dir, { recursive: true });
}
for (const name of ["index.html", "app.js", "style.css"]) {
  await copyFile("dist/web/" + name, root + "/site/" + name);
}
await copyFile("api/schema.sql", root + "/db/schema.sql");
await copyFile("dist/api/main.cjs", root + "/server.cjs");
await copyFile("scripts/hosted-handler.cjs", root + "/api/daybook.js");
const { dependencies } = JSON.parse(await readFile("package.json", "utf8"));
const names = ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express", "pg",
  "reflect-metadata", "rxjs", "bcryptjs", "jsonwebtoken"];
const runtime = Object.fromEntries(names.map(name => [name, dependencies[name]]));
await writeFile(root + "/package.json", JSON.stringify({
  name: "daybook-leave", private: true, engines: { node: "22.x" }, dependencies: runtime
}, null, 2));
await writeFile(root + "/vercel.json", JSON.stringify({
  framework: null, buildCommand: null, outputDirectory: "site",
  functions: { "api/daybook.js": { includeFiles: "db/schema.sql" } },
  rewrites: [
    { source: "/api/workspace", destination: "/api/daybook?route=workspace" },
    { source: "/api/auth/:action", destination: "/api/daybook?route=auth/:action" },
    { source: "/api/actions/:action", destination: "/api/daybook?route=actions/:action" }
  ]
}, null, 2));
