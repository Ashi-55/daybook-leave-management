# Daybook

A local leave-management workspace with an Angular frontend, NestJS API and PostgreSQL database. Start with the [interview walkthrough](INTERVIEW.md) or play the [backup demo](daybook-demo.webm).

## Run on a clean machine

Install Node.js 22.20 or a compatible Node 22 LTS with npm. Use a regular user account. Open this project's directory in a terminal. On Windows PowerShell, use `npm.cmd` if script execution is restricted.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:8130**. On first start, the launcher initializes a private PostgreSQL cluster under `.pgdata` on port 55442 and seeds it. Allow time for database initialization. Subsequent starts retain data. Stop with Ctrl+C. Run one launcher per data directory. The npm installation needs internet access and the native embedded PostgreSQL package for the host platform. For external PostgreSQL, set `DATABASE_URL` to an empty dedicated database before starting. The schema assumes a fresh application database.

The sign-in page prefills a local demo account for each role. All seeded accounts initially use **DaybookDemo!42**. Set `DEMO_PASSWORD` before the first seed to use a different password, then type it into the login form. The example accounts and loopback launcher are intended for interviews.

| Role | Account | Demo |
|---|---|---|
| Employee | alex@daybook.test | Request or cancel leave, view balances and calendar |
| Manager | mira@daybook.test | Review Alex, Priya, Sam and Riya |
| Second manager | dev@daybook.test | Review Noah, Tara, Leo and Zara |
| Admin | ira@daybook.test | Configure types, allowances, minimum notice and daily cap |

## Architecture and rules

Angular submits JSON over same-origin HTTP. NestJS authenticates the request, loads the user's current role and manager relationship, and calls the business rules. The PostgreSQL driver uses a connection pool and parameterized SQL. One checked-out connection owns each transaction and is released in a finally block.

- **Dates** use UTC calendar days. Start and end are inclusive. Saturday, Sunday and seeded holidays carry zero charge. An entirely nonworking range is invalid. Notice counts calendar days. Requests may span two calendar years and are limited to 367 calendar days.
- **Balance** for a type and year is its configured allowance minus approved and pending working days in that year. Each charged date is stored individually. A cancellation or rejection changes the status once, releasing its days without a second balance update.
- **Overlap** checks an employee's active date ranges across all leave types. Team coverage counts distinct employees with pending or approved leave on each charged day. An employee's manager defines their team.
- **Concurrency** uses one policy-row lock to serialize requests, decisions and configuration writes. The next writer checks committed state before reserving leave. This intentionally trades write throughput for a simple concurrency guarantee in a small organization.
- **Configuration** applies to subsequent submissions immediately. Already accepted requests keep their charged days. Lowering an allowance below existing commitments can display a negative balance and blocks additional requests of that type.
- **Authentication** uses bcrypt, a five-minute signed JWT, an eight-hour server session and a rotating opaque refresh credential in an HttpOnly, SameSite=Strict cookie. Set `COOKIE_SECURE=true` when serving over HTTPS. Set a high-entropy `JWT_SECRET` or the launcher generates one locally. Logging out deletes the session. The API checks it on every authenticated request.
- **Visibility** limits requests and reasons to the owner, their manager and administrators. The team calendar shares names and statuses. Successful business actions and their audit entries commit together. Request logs contain method, path, status, elapsed time and a correlation ID.

## Data model and files

| Table | Contents |
|---|---|
| people | Identity, salted password hash, role and manager reference |
| kinds, policy, holidays | Annual allowances, notice, daily cap and nonworking dates |
| requests | Owner, type, inclusive range, reason and workflow status |
| charged_days | One request/date pair per working day |
| sessions | User, session ID, refresh credential digest and absolute expiry |
| audit | Actor, action, target record and timestamp |

Start with `api/leave.ts` for rules, `api/main.ts` for HTTP and authentication, `api/schema.sql` for the schema and `web/main.ts` for the browser flow. The seed creates two managers, eight employees, one administrator, three leave types, a sample holiday list for three years and 40 mixed-state requests. The calendar is an example company calendar.

## Vercel and Neon

From the project directory run `npm run build:vercel`. The generated `dist/vercel` directory contains the Angular site and a Node function serving the NestJS API. Deploy from that directory. The local database launcher is excluded.

Link that directory to a dedicated Daybook Vercel project using `npx vercel link`. Connect a new Neon database through the Vercel Marketplace and enable its pooled TLS `DATABASE_URL` for Production. Set a stable random `JWT_SECRET` of at least 32 characters in the project's server-side environment variables. HTTPS refresh cookies are enabled automatically on Vercel. The first API request initializes the schema and fictional demo records in this dedicated database. Keep real personnel records out of the shared demo accounts.

Run `npx vercel deploy --prod` from the linked directory. Verify employee login, a persisted request after reloading, a manager decision and logout on the returned HTTPS URL.

## Verification

```sh
npm test
```

This builds TypeScript, starts a disposable PostgreSQL cluster on port 55443, binds an ephemeral HTTP port, exercises the running API, and removes the test cluster. Tests cover balances, year boundaries, overlap, parallel team reservations, decisions, cancellation, configuration changes, authorization, auth rotation and audit visibility. Use another terminal while the demo is running.

## Inspect records in DBeaver or pgAdmin

Create a PostgreSQL connection to `127.0.0.1:55442`, database and username `postgres`. Use the generated password from `.pgdata/password` privately. The following read-only queries are suitable for screen sharing.

```sql
select p.name, k.name as leave_type, r.start_date, r.end_date, r.status,
       count(d.day) as working_days
from requests r join people p on p.id=r.employee join kinds k on k.id=r.kind
join charged_days d on d.request=r.id
group by r.id, p.name, k.name order by r.id desc limit 12;

select p.name, a.action, a.target, a.created
from audit a join people p on p.id=a.actor order by a.id desc limit 12;

select role, count(*) from people group by role;
```

