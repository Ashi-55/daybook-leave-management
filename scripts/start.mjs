import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { localCluster } from "./cluster.mjs";
import api from "../dist/api/main.cjs";
let cluster;
if (!process.env.DATABASE_URL) {
  cluster = await localCluster(".pgdata", Number(process.env.PGPORT || 55442));
  process.env.DATABASE_URL = cluster.url;
}
await mkdir(".pgdata", { recursive: true });
if (!process.env.JWT_SECRET) {
  try {
    await writeFile(".pgdata/jwt", randomBytes(48).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  process.env.JWT_SECRET = await readFile(".pgdata/jwt", "utf8");
}
const { app, pool } = await api.createApp();
await app.listen(Number(process.env.PORT || 8130), "127.0.0.1");
console.log("Daybook ready at " + (await app.getUrl()));
for (const sig of ["SIGINT", "SIGTERM"])
  process.once(sig, async () => {
    await app.close();
    await pool.end();
    await cluster?.pg.stop();
    process.exit();
  });
