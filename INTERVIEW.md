# Demo first, discussion second

## Four-minute live demo

Open the project in VS Code and start Daybook using the README. Keep the app, a terminal showing the test results, and this guide available. The backup recording is [daybook-demo.webm](daybook-demo.webm). The seeded dates move with first installation, so pick dates from your own running instance.

| Time | Show | What to say and verify |
|---|---|---|
| 0:00–0:45 | Employee → Overview → Team calendar | “Alex reports to Mira. Annual leave has an allowance, an approved count and a pending count.” Choose an available upcoming weekday in the displayed balance year. Note the starting balance. |
| 0:45–1:30 | Request leave | Select annual leave, that date and a reason. Read the working-day preview. Submit. The request becomes pending and the balance drops by one. Repeat the same dates with a different leave type to show the overlap error. |
| 1:30–2:10 | Sign out → Manager → Review requests | Find Alex's reason and approve it. “Mira can decide only for her own reports. Approval keeps the reservation in place.” Show the Team calendar entry. The second manager's sign-in is in the README. |
| 2:10–2:45 | Employee → Requests | Cancel that approved request and open Overview. Compare the balance with the original figure. For a request in another year, change the balance year first. |
| 2:45–3:35 | Admin → Configuration | Note the original notice, set it to 30 and save. Sign in as Alex and try a weekday next week. Read the rejection, then restore the original notice as admin. Show the policy change in Activity log. |
| 3:35–4:00 | Terminal → tests | Show the named test for two teammates competing for one spot. Explain why one HTTP request succeeds and one receives a conflict. Point out the weekend, public holiday and cross-year tests. |

If asked for another example, reject a pending request as Mira and show the days becoming available to its owner. To show insufficient balance, create a new type with one day, then try a two-working-day request.

## Web technology and debugging

**Which development tool did you use?** This project was built with OpenAI Codex desktop, PowerShell and npm. VS Code launch configurations are included for practice. Describe your personal use of VS Code or another editor after trying the steps below.

**How do the frontend and backend work together?** HTML gives the page structure, CSS controls its presentation, and Angular handles forms and rendering in the browser. Clicking Submit sends JSON to NestJS. The server calculates working days, checks permissions and availability, and commits to PostgreSQL. Angular fetches fresh state and redraws the balance.

**How do you inspect a website?** Open Chrome DevTools with Ctrl+Shift+I. In Elements, inspect the balance progress bar. Change a CSS color temporarily and reload. In Sources, use Ctrl+P to open the source-mapped `main.ts` under `web`. Put a breakpoint inside `action()` where it calls `this.api`, submit a request, inspect `op` and `b`, then resume with F8.

**How do you watch requests and timing?** Open Network, select Fetch/XHR and enable Preserve log before signing in. Select `POST /api/auth/login` to identify the JSON payload and HTTP 201. Select the subsequent `GET /api/workspace`. Headers shows the bearer authorization scheme, Response shows the returned workspace and Timing shows queueing, waiting and download time. Compare the response's X-Request-ID with the server's JSON log. The server's elapsed milliseconds cover only the server portion. Use the local demo account and keep credential values collapsed on a shared screen. [Chrome Network panel](https://developer.chrome.com/docs/devtools/network/overview)

**What can you run in the console?** The interview's `sessionStorage.getItem('jwt-token')` returns the tab's current access token, or null when absent. For a screen share, demonstrate its presence and the JWT's three-part structure without printing the credential.

```js
const access = sessionStorage.getItem('jwt-token')
Boolean(access)
access?.split('.').length
```

**How do you debug in VS Code?** Open the leave-management folder itself. Ctrl+P opens a file, Ctrl+Shift+F searches the project, and the integrated terminal runs npm. Press F9 on the line that calculates the charged dates in `api/leave.ts`. Stop the normal server before selecting **Daybook API** in Run and Debug, then F5. Submit a request in Chrome. Inspect the role, policy and working dates in Variables, use F10 to step over and F5 to continue. For the browser, start the server and choose **Daybook browser**. Rebuild after TypeScript edits so the source maps match. [VS Code browser debugging](https://code.visualstudio.com/docs/nodejs/browser-debugging)

## Authentication and persistence

**Walk me through a login click.** The form calls `login()` in `web/main.ts`. NestJS looks up the email and calls bcrypt.compare against the stored salted hash. After success, it creates an eight-hour session, stores a digest of a random refresh credential and signs a five-minute access JWT. The browser stores the access JWT in sessionStorage and receives the refresh credential as an HttpOnly cookie. Subsequent calls attach the access JWT as a bearer token. The API verifies the signature, expiry, issuer and audience, checks the live session, and loads the user's role from PostgreSQL.

**What is a JWT?** A signed token with a header, payload and signature. Daybook uses HS256. Its claims identify a subject and session and include an expiry. The signature lets the server detect changes. Anyone holding the token can read its payload, so it contains no passwords or leave reasons.

**What happens on refresh, expiry and logout?** Reloading the page restores the workspace by fetching it from the API. When a protected call returns 401, the browser tries one refresh using its scoped cookie. A successful refresh rotates the opaque credential and returns a fresh access JWT. If the server session has expired, the UI clears the access token and shows a sign-in dialog. Logout deletes the server session, clears the cookie and removes the tab's access token. This Angular app renders on the client. SSR hydration is a separate technique that attaches client behavior to server-rendered HTML.

**Session storage, local storage or cookie?** sessionStorage is scoped to an origin and tab and survives reloads. localStorage is shared across same-origin tabs and persists across browser sessions. JavaScript can read both. HttpOnly prevents JavaScript from reading the refresh cookie. The browser sends it automatically under its path and SameSite rules. A bearer token grants access to whoever holds it, so avoid logging or sharing it.

**Authentication versus authorization?** Checking Alex's login establishes identity. Checking who owns a request and which manager supervises its owner decides permission. A missing or invalid session returns 401. An authenticated manager trying to approve another manager's report receives 403.

**How does the API connect to the DB?** The launcher supplies DATABASE_URL. The pg Pool reuses connections. The business operation checks out a connection and uses BEGIN, parameterized queries and COMMIT or ROLLBACK. The policy-row lock ensures a second simultaneous submission checks the first submission's committed reservation. Use the README's DBeaver/pgAdmin queries to show the actual requests and audit trail.

**How are passwords protected?** bcrypt hashes each seeded password with an independent salt and a cost factor of 10. Login compares the supplied password with that hash. The API omits hashes from the workspace response. Access and refresh credentials, passwords and leave reasons are excluded from request logs.

## AI discussion and screen-share exercise

**Which AI tool and prompt did you use?** OpenAI Codex desktop built this project from the two supplied PDFs and your request to add a feature and prepare for the HR questions. You can describe that actual request in your own words. Cite one result you personally verified, such as the balance before submission and after cancellation.

**How does agentic development differ from a chat answer?** In this project Codex could inspect files, edit the application, run PostgreSQL tests and exercise Chrome. A chat-only exchange can explain an implementation for a person to carry out. The practical difference is access to tools, permission to act, and checking the outcome.

**What are skills, context and tokens?** A skill packages reusable instructions and can include scripts or references. The PDF skill helped read the supplied briefs. Context is the material available for one model response, including instructions, selected files and tool output. A token is a unit of encoded text. The context window bounds how much input and output a model can handle together. An AI token and a login JWT serve different purposes. [OpenAI skills guide](https://learn.chatgpt.com/docs/build-skills)

**Give one prompt live.** Open `api/leave.ts` and `tests/leave.test.mjs`. Ask: “Using only these two files, trace how cancelling an approved request restores an employee's balance. Identify the SQL status filter and the test assertion. Leave the files unchanged.” Open the cited lines and compare the answer with the code. Explain that those files and the conversation supply context. If the client exposes a usage indicator, identify its displayed units and limit. A word count is only an estimate of token usage.

**Which other tools have you heard of?** VS Code is an editor with a debugger. Cursor offers a coding environment and agent. Google Antigravity is an agentic development platform. Claude Code and OpenCode are coding agents with multiple interfaces. Describe which ones you personally tried and one task you performed with each. [Cursor](https://cursor.com/) · [Google Antigravity](https://antigravity.google/) · [Claude Code](https://code.claude.com/docs/en/overview) · [OpenCode](https://opencode.ai/)

**Which extras can you demonstrate?** Show the working-day preview, server validation, audit entries, request IDs, bcrypt, HttpOnly refresh cookie, refresh rotation and session-expired dialog. Google sign-in and Redis are possible extensions. This project authenticates against PostgreSQL and reads balances transactionally.

