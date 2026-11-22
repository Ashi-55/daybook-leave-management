import { PoolClient } from "pg";
import { hash } from "bcryptjs";
import { readFileSync } from "node:fs";
export async function initialize(db: PoolClient) {
  await db.query(readFileSync(process.env.DAYBOOK_SCHEMA_PATH || "api/schema.sql", "utf8"));
  if ((await db.query("select id from policy")).rowCount) return;
  await db.query(
    "insert into policy values(1,1,2);insert into kinds(name,allowance) values('Annual leave',20),('Sick leave',12),('Unpaid leave',30)",
  );
  const names = [
    "Mira Shah",
    "Dev Patel",
    "Alex Morgan",
    "Priya Nair",
    "Sam Lee",
    "Riya Das",
    "Noah Kim",
    "Tara Roy",
    "Leo Chen",
    "Zara Khan",
    "Ira Bose",
  ];
  for (const [i, name] of names.entries()) {
    const role = i < 2 ? "manager" : i === 10 ? "admin" : "employee";
    await db.query(
      "insert into people(name,email,password_hash,role,manager) values($1,$2,$3,$4,$5)",
      [
        name,
        name.split(" ")[0].toLowerCase() + "@daybook.test",
        await hash(process.env.DEMO_PASSWORD || "DaybookDemo!42", 10),
        role,
        role === "employee" ? (i < 6 ? 1 : 2) : null,
      ],
    );
  }
  await db.query(
    `insert into holidays select make_date(y,m,d),label from generate_series(extract(year from current_date)::int,extract(year from current_date)::int+2)y cross join (values(1,1,'New Year'),(1,26,'Republic Day'),(8,15,'Independence Day'),(12,25,'Christmas')) h(m,d,label)`,
  );
  const dates = (
    await db.query(
      `select d::date::text as day from generate_series(current_date+2,current_date+150,interval '1 day') d where extract(isodow from d)<6 and d::date not in(select day from holidays) order by d limit 40`,
    )
  ).rows;
  for (let i = 0; i < 40; i++) {
    const day = dates[i].day;
    const status = ["pending", "approved", "rejected", "cancelled"][
      (i + Math.floor(i / 8)) % 4
    ];
    const row = await db.query(
      "insert into requests(employee,kind,start_date,end_date,reason,status) values($1,$2,$3,$3,$4,$5) returning id",
      [
        3 + (i % 8),
        1 + (i % 3),
        day,
        ["Family visit", "Medical appointment", "Personal day"][i % 3],
        status,
      ],
    );
    await db.query("insert into charged_days values($1,$2)", [
      row.rows[0].id,
      day,
    ]);
  }
}
