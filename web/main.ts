import "zone.js";
import "@angular/compiler";
import { Component, provideZoneChangeDetection } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { bootstrapApplication } from "@angular/platform-browser";
import template from "./app.html";

@Component({
  selector: "daybook-app",
  standalone: true,
  imports: [FormsModule, CommonModule],
  template,
})
class Daybook {
  s: any;
  loading = true;
  busy = false;
  error = "";
  note = "";
  timedOut = false;
  tab = "Overview";
  modal = false;
  email = "alex@daybook.test";
  password = "DaybookDemo!42";
  role = "Employee";
  today = new Date();
  year = this.today.getUTCFullYear();
  month = new Date(this.today.getFullYear(), this.today.getMonth(), 1);
  form = { kind: 1, start: "", end: "", reason: "" };
  policy = { notice: 1, capacity: 2 };
  newType = { name: "", allowance: 10 };
  weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  filter = "All";
  chosenDay = "";
  private refreshing?: Promise<boolean>;
  async ngOnInit() {
    try {
      if (sessionStorage.getItem("jwt-token") || (await this.refresh()))
        await this.load();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }
  select(role: string) {
    this.role = role;
    this.email =
      (
        { Employee: "alex", Manager: "mira", Admin: "ira" } as Record<
          string,
          string
        >
      )[role] + "@daybook.test";
    this.password = "DaybookDemo!42";
  }
  async refresh() {
    if (!this.refreshing)
      this.refreshing = (async () => {
        const r = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!r.ok) return false;
        sessionStorage.setItem("jwt-token", (await r.json()).token);
        return true;
      })().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }
  async api(path: string, body?: any, again = true): Promise<any> {
    const r = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (sessionStorage.getItem("jwt-token") || ""),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401 && !path.startsWith("auth/")) {
      if (again && (await this.refresh())) return this.api(path, body, false);
      this.clear();
      this.timedOut = true;
      throw Error("Your session expired. Sign in to continue.");
    }
    const data = await r.json();
    if (!r.ok) throw Error(data.message || "Request failed.");
    return data;
  }
  async run(fn: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.note = "";
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
  login() {
    return this.run(async () => {
      const r = await this.api("auth/login", {
        email: this.email,
        password: this.password,
      });
      sessionStorage.setItem("jwt-token", r.token);
      await this.load();
    });
  }
  clear() {
    sessionStorage.removeItem("jwt-token");
    this.s = null;
    this.tab = "Overview";
    this.modal = false;
    this.chosenDay = "";
    this.filter = "All";
  }
  logout() {
    return this.run(async () => {
      await this.api("auth/logout", {});
      this.clear();
    });
  }
  async load() {
    this.s = await this.api("workspace?year=" + this.year);
    this.policy = { ...this.s.policy };
  }
  go(tab: string) {
    this.tab = tab;
    this.error = "";
    this.note = "";
    this.filter = "All";
  }
  action(op: string, b: any) {
    return this.run(async () => {
      await this.api("actions/" + op, b);
      this.modal = false;
      if (op === "request")
        this.form = { kind: 1, start: "", end: "", reason: "" };
      if (op === "type") this.newType = { name: "", allowance: 10 };
      await this.load();
      this.note =
        (
          {
            request: "Request submitted for review.",
            approve: "Request approved.",
            reject: "Request rejected.",
            cancel: "Request cancelled. Reserved days released.",
          } as Record<string, string>
        )[op] || "Configuration saved.";
    });
  }
  changeYear() {
    return this.run(() => this.load());
  }
  get availability() {
    return (
      this.s.calendar
        .filter((r: any) => r.day === this.chosenDay)
        .map((r: any) => r.employee + " (" + r.status + ")")
        .join(", ") || "No team members have leave booked."
    );
  }
  get tabs() {
    return [
      "Overview",
      this.s.user.role === "manager" ? "Review requests" : "Requests",
      "Team calendar",
      ...(this.s.user.role === "admin"
        ? ["Configuration", "Activity log"]
        : []),
    ];
  }
  get rows() {
    return this.s.history.filter(
      (r: any) => this.filter === "All" || r.status === this.filter,
    );
  }
  get pending() {
    return this.s.history.filter((r: any) => r.status === "pending").length;
  }
  get monthName() {
    return this.month.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });
  }
  moveMonth(n: number) {
    this.month = new Date(
      this.month.getFullYear(),
      this.month.getMonth() + n,
      1,
    );
    this.chosenDay = "";
  }
  get cells() {
    const y = this.month.getFullYear(),
      m = this.month.getMonth();
    const start = (this.month.getDay() + 6) % 7;
    return Array.from(
      { length: Math.ceil((start + new Date(y, m + 1, 0).getDate()) / 7) * 7 },
      (_, i) => {
        const n = i - start + 1;
        if (n < 1 || n > new Date(y, m + 1, 0).getDate()) return null;
        const day =
          y +
          "-" +
          String(m + 1).padStart(2, "0") +
          "-" +
          String(n).padStart(2, "0");
        return {
          n,
          day,
          off: this.s.calendar.filter((r: any) => r.day === day),
          holiday: this.s.holidays.find((h: any) => h.day === day)?.name,
        };
      },
    );
  }
  get preview() {
    if (!this.form.start || !this.form.end) return "";
    const a = Date.parse(this.form.start),
      b = Date.parse(this.form.end);
    if (b < a || b - a > 366 * 86400000) return "Check your date range.";
    let count = 0;
    for (let t = a; t <= b; t += 86400000) {
      const d = new Date(t);
      if (
        ![0, 6].includes(d.getUTCDay()) &&
        !this.s.holidays.some(
          (h: any) => h.day === d.toISOString().slice(0, 10),
        )
      )
        count++;
    }
    return count + " working day" + (count === 1 ? "" : "s");
  }
  fmt(d: string) {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
}
bootstrapApplication(Daybook, { providers: [provideZoneChangeDetection()] });
