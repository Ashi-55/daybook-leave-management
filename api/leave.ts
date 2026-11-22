import { HttpException } from "@nestjs/common";
import { PoolClient } from "pg";
export type Person = {
  id: number;
  name: string;
  email: string;
  role: string;
  manager: number | null;
};
export function requireValue(
  value: unknown,
  message: string,
  status = 400,
): asserts value {
  if (!value) throw new HttpException(message, status);
}
function integer(value: unknown, min: number, max: number) {
  requireValue(
    typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max,
    "Number outside allowed range.",
  );
  return value;
}
function date(value: unknown) {
  requireValue(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Enter a valid date.",
  );
  const time = Date.parse(value + "T00:00:00Z");
  requireValue(
    Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value,
    "Enter a valid date.",
  );
  return value;
}
const active = "('approved','pending')";
export async function state(db: PoolClient, user: Person, year: number) {
  const team = user.role === "manager" ? user.id : user.manager;
  const history = (
    await db.query(
      `select r.id,p.name employee,k.name kind,r.start_date::text as start,r.end_date::text "end",r.reason,r.status,count(d.day)::int days
 from requests r join people p on r.employee=p.id join kinds k on k.id=r.kind join charged_days d on d.request=r.id
 where $1='admin' or ($1='manager' and p.manager=$2) or r.employee=$3 group by r.id,p.name,k.name order by r.id desc`,
      [user.role, team, user.id],
    )
  ).rows;
  const calendar = (
    await db.query(
      `select d.day::text as day,p.name employee,r.status from charged_days d join requests r on r.id=d.request join people p on p.id=r.employee where r.status in ${active} and ($1='admin' or p.manager=$2) order by d.day,p.name`,
      [user.role, team],
    )
  ).rows;
  const balances = (
    await db.query(
      `select k.id,k.name,k.allowance,count(d.day) filter(where r.status='pending')::int pending,count(d.day) filter(where r.status='approved')::int used
 from kinds k left join requests r on r.kind=k.id and r.employee=$1 left join charged_days d on d.request=r.id and extract(year from d.day)=$2 group by k.id order by k.id`,
      [user.id, year],
    )
  ).rows;
  return {
    user,
    history,
    calendar,
    balances,
    year,
    policy: (await db.query("select notice,capacity from policy")).rows[0],
    holidays: (
      await db.query("select day::text,name from holidays order by day")
    ).rows,
    audit:
      user.role === "admin"
        ? (
            await db.query(
              "select p.name,a.action,a.target,a.created from audit a join people p on p.id=a.actor order by a.id desc limit 50",
            )
          ).rows
        : [],
  };
}
export async function change(
  db: PoolClient,
  user: Person,
  op: string,
  b: Record<string, unknown>,
) {
  // All rule-changing operations share this lock. Waiting writers then read committed values.
  const policy = (await db.query("select * from policy where id=1 for update"))
    .rows[0];
  let target: number | null = null;
  if (op === "request") {
    requireValue(user.role === "employee", "Employee access required.", 403);
    const start = date(b.start),
      end = date(b.end),
      kind = integer(b.kind, 1, 2147483647);
    requireValue(end >= start, "End date must follow the start date.");
    requireValue(
      Date.parse(end) - Date.parse(start) <= 366 * 86400000,
      "Choose a range of up to 367 calendar days.",
    );
    requireValue(
      typeof b.reason === "string" &&
        b.reason.trim().length > 0 &&
        b.reason.trim().length <= 500,
      "Enter a reason of 1–500 characters.",
    );
    requireValue(
      (
        await db.query("select $1::date >= current_date + $2::int ok", [
          start,
          policy.notice,
        ])
      ).rows[0].ok,
      "Request falls inside the minimum notice period.",
    );
    const type = (
      await db.query("select allowance from kinds where id=$1", [kind])
    ).rows[0];
    requireValue(type, "Unknown leave type.");
    const days = (
      await db.query(
        `select d::date::text as day from generate_series($1::date,$2::date,interval '1 day')d where extract(isodow from d)<6 and d::date not in(select day from holidays)`,
        [start, end],
      )
    ).rows.map((r) => r.day as string);
    requireValue(days.length, "The range contains no working days.");
    requireValue(
      !(
        await db.query(
          `select 1 from requests where employee=$1 and status in ${active} and start_date<=$3 and end_date>=$2 limit 1`,
          [user.id, start, end],
        )
      ).rowCount,
      "You already have leave in this date range.",
      409,
    );
    for (const year of new Set(days.map((d) => d.slice(0, 4)))) {
      const usage = await db.query(
        `select count(*)::int used from charged_days d join requests r on r.id=d.request where r.employee=$1 and r.kind=$2 and r.status in ${active} and extract(year from day)=$3`,
        [user.id, kind, year],
      );
      requireValue(
        usage.rows[0].used + days.filter((d) => d.startsWith(year)).length <=
          type.allowance,
        "Insufficient leave balance for " + year + ".",
        409,
      );
    }
    const full = await db.query(
      `select day::text as day from charged_days d join requests r on r.id=d.request join people p on p.id=r.employee where p.manager=$1 and r.status in ${active} and day=any($2::date[]) group by day having count(distinct p.id)>=$3 limit 1`,
      [user.manager, days, policy.capacity],
    );
    requireValue(
      !full.rowCount,
      "Team coverage limit reached on " + full.rows[0]?.day + ".",
      409,
    );
    target = (
      await db.query(
        "insert into requests(employee,kind,start_date,end_date,reason,status) values($1,$2,$3,$4,$5,'pending') returning id",
        [user.id, kind, start, end, b.reason.trim()],
      )
    ).rows[0].id;
    await db.query("insert into charged_days select $1,unnest($2::date[])", [
      target,
      days,
    ]);
  } else if (["approve", "reject", "cancel"].includes(op)) {
    target = integer(b.id, 1, 2147483647);
    const r = (
      await db.query(
        "select r.*,p.manager from requests r join people p on p.id=r.employee where r.id=$1",
        [target],
      )
    ).rows[0];
    requireValue(r, "Request unavailable.", 404);
    if (op === "cancel")
      requireValue(
        user.role === "employee" && r.employee === user.id,
        "Only the request owner can cancel.",
        403,
      );
    else
      requireValue(
        user.role === "manager" && r.manager === user.id,
        "Only the reporting manager can decide.",
        403,
      );
    requireValue(
      r.status === "pending" || (op === "cancel" && r.status === "approved"),
      "Request has already been decided.",
      409,
    );
    await db.query("update requests set status=$1 where id=$2", [
      op === "cancel"
        ? "cancelled"
        : op === "approve"
          ? "approved"
          : "rejected",
      target,
    ]);
  } else if (op === "policy") {
    requireValue(user.role === "admin", "Administrator access required.", 403);
    await db.query("update policy set notice=$1,capacity=$2", [
      integer(b.notice, 0, 365),
      integer(b.capacity, 1, 1000),
    ]);
  } else if (op === "type") {
    requireValue(user.role === "admin", "Administrator access required.", 403);
    requireValue(
      typeof b.name === "string" &&
        b.name.trim().length > 0 &&
        b.name.trim().length <= 60,
      "Enter a leave type name (1–60 characters).",
    );
    const allowance = integer(b.allowance, 0, 366);
    if (b.id) {
      target = integer(b.id, 1, 2147483647);
      requireValue(
        (
          await db.query("update kinds set name=$1,allowance=$2 where id=$3", [
            b.name.trim(),
            allowance,
            target,
          ])
        ).rowCount,
        "Unknown leave type.",
      );
    } else
      target = (
        await db.query(
          "insert into kinds(name,allowance) values($1,$2) returning id",
          [b.name.trim(), allowance],
        )
      ).rows[0].id;
  } else throw new HttpException("Unknown action.", 404);
  await db.query("insert into audit(actor,action,target) values($1,$2,$3)", [
    user.id,
    op,
    target,
  ]);
  return { id: target };
}
