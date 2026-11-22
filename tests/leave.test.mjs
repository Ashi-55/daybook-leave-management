import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import api from "../dist/api/main.cjs";
import { localCluster } from "../scripts/cluster.mjs";
let app, pool, cluster, url, tmp, employee, peer, manager, other, admin;
const year = new Date().getUTCFullYear() + 2;
function monday(n) {
  const d = new Date(Date.UTC(year, 2, 1 + n * 7));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
async function call(path, token, body, cookie) {
  const r = await fetch(url + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (token || ""),
      Cookie: cookie || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
async function login(name) {
  const r = await call("auth/login", null, {
    email: name + "@daybook.test",
    password: "DaybookDemo!42",
  });
  assert.equal(r.status, 201);
  return r.data.token;
}
const action = (op, b, token = employee) => call("actions/" + op, token, b);
const request = (start, end = start, kind = 1, token = employee) =>
  action("request", { start, end, kind, reason: "Test leave" }, token);
const workspace = async (token = employee) =>
  (await call("workspace?year=" + year, token)).data;
const balance = async () => {
  const k = (await workspace()).balances[0];
  return k.allowance - k.used - k.pending;
};
before(async () => {
  tmp = await mkdtemp(resolve(".test-pg-"));
  cluster = await localCluster(tmp, 55443);
  process.env.DATABASE_URL = cluster.url;
  process.env.JWT_SECRET = randomUUID();
  process.env.DEMO_PASSWORD = "DaybookDemo!42";
  ({ app, pool } = await api.createApp());
  await app.listen(0, "127.0.0.1");
  url = await app.getUrl();
  [employee, peer, manager, other, admin] = await Promise.all(
    ["alex", "priya", "mira", "dev", "ira"].map(login),
  );
});
after(async () => {
  await app?.close();
  await pool?.end();
  await cluster?.pg.stop();
  if (tmp)
    await rm(tmp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
});
test("seed counts, reporting lines, holiday list and all four states", async () => {
  const s = await workspace(admin);
  assert.equal(s.history.length, 40);
  assert.equal(new Set(s.history.map((r) => r.status)).size, 4);
  assert.equal(s.balances.length, 3);
  assert.ok(s.holidays.length);
  assert.equal((await workspace(manager)).history.length, 20);
  assert.equal((await workspace()).history.length, 5);
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from people where role='employee'",
      )
    ).rows[0].n,
    8,
  );
});
test("credentials and protected routes", async () => {
  assert.equal((await call("workspace")).status, 401);
  assert.equal(
    (
      await call("auth/login", null, {
        email: "alex@daybook.test",
        password: "wrong",
      })
    ).status,
    401,
  );
});
test("invalid, reversed and empty date ranges", async () => {
  for (const [a, b] of [
    [year + "-02-30", monday(0)],
    [monday(1), monday(0)],
    ["", ""],
  ])
    assert.equal((await request(a, b)).status, 400);
});
test("weekends and configured public holidays excluded", async () => {
  const friday = new Date(monday(1));
  friday.setUTCDate(friday.getUTCDate() - 3);
  const r = await request(friday.toISOString().slice(0, 10), monday(1));
  assert.equal(r.status, 201);
  assert.equal((await workspace()).history[0].days, 2);
  assert.equal((await request(year + "-01-01")).status, 400);
});
test("pending holds balance and cancelling restores it", async () => {
  const old = await balance();
  const r = await request(monday(2));
  assert.equal(r.status, 201);
  assert.equal(await balance(), old - 1);
  assert.equal((await action("cancel", r.data)).status, 201);
  assert.equal(await balance(), old);
});
test("own overlap spans leave types", async () => {
  assert.equal((await request(monday(3))).status, 201);
  assert.equal((await request(monday(3), monday(3), 2)).status, 409);
});
test("manager scope enforced and approved leave cancellable only by owner", async () => {
  const old = await balance(),
    r = await request(monday(4));
  assert.equal((await action("approve", r.data, other)).status, 403);
  assert.equal((await action("approve", r.data, manager)).status, 201);
  assert.equal((await action("reject", r.data, manager)).status, 409);
  assert.equal((await action("cancel", r.data, peer)).status, 403);
  assert.equal((await action("cancel", r.data)).status, 201);
  assert.equal(await balance(), old);
});
test("rejection frees a reserved day", async () => {
  const old = await balance(),
    r = await request(monday(5));
  assert.equal((await action("reject", r.data, manager)).status, 201);
  assert.equal(await balance(), old);
});
test("admin-only policy changes affect minimum notice", async () => {
  assert.equal(
    (await action("policy", { notice: 3, capacity: 1 })).status,
    403,
  );
  await action("policy", { notice: 30, capacity: 2 }, admin);
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  assert.match((await request(soon)).data.message, /notice/);
});
test("concurrent coverage reservations serialize; another team can book", async () => {
  await action("policy", { notice: 0, capacity: 1 }, admin);
  const d = monday(6);
  const pair = await Promise.all(
    [employee, peer].map((t) => request(d, d, 1, t)),
  );
  assert.deepEqual(pair.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await request(d, d, 1, await login("noah"))).status, 201);
});
test("updated allowance includes pending usage on the next submission", async () => {
  const a = await action("type", { name: "Study", allowance: 1 }, admin);
  assert.equal(a.status, 201);
  const k = a.data.id;
  assert.equal((await request(monday(7), monday(7), k)).status, 201);
  assert.equal((await request(monday(8), monday(8), k)).status, 409);
  await action("type", { name: "Study", allowance: 2, id: k }, admin);
  assert.equal((await request(monday(8), monday(8), k)).status, 201);
});
test("cross-year requests charge each working day to its own year", async () => {
  const d = year + "-12-28",
    end = year + 1 + "-01-05";
  const result = await request(d, end, 2);
  assert.equal(result.status, 201);
  const next = (await call("workspace?year=" + (year + 1), employee)).data;
  assert.ok(next.balances[1].pending > 0);
  assert.equal(
    (await workspace()).balances[1].pending + next.balances[1].pending,
    (await workspace()).history[0].days,
  );
});
test("team calendar excludes private reasons; admin sees audit", async () => {
  assert.ok((await workspace()).calendar.every((r) => !("reason" in r)));
  assert.deepEqual((await workspace()).audit, []);
  assert.ok((await workspace(admin)).audit.some((a) => a.action === "cancel"));
});
test("refresh cookie rotates; logout revokes the access token", async () => {
  const r = await call("auth/login", null, {
    email: "alex@daybook.test",
    password: "DaybookDemo!42",
  });
  assert.match(r.cookie, /HttpOnly/);
  const initial = r.cookie.split(";")[0];
  const fresh = await call("auth/refresh", null, {}, initial);
  assert.equal(fresh.status, 201);
  assert.equal((await call("auth/refresh", null, {}, initial)).status, 401);
  await call("auth/logout", null, {}, fresh.cookie.split(";")[0]);
  assert.equal((await call("workspace", fresh.data.token)).status, 401);
});
test("invalid role, reason and numeric configuration rejected", async () => {
  assert.equal((await request(monday(10), monday(10), 1, manager)).status, 403);
  assert.equal(
    (
      await action("request", {
        kind: 1,
        start: monday(10),
        end: monday(10),
        reason: "  ",
      })
    ).status,
    400,
  );
  assert.equal(
    (await action("policy", { notice: -1, capacity: 0 }, admin)).status,
    400,
  );
});
