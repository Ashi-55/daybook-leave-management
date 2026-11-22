import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Param,
  Query,
  Body,
  Module,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Pool, PoolClient } from "pg";
import { compare } from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { initialize } from "./seed";
import { change, state, requireValue, Person } from "./leave";

export async function createApp() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || !process.env.DATABASE_URL)
    throw Error("Set DATABASE_URL and a JWT_SECRET of at least 32 characters.");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: process.env.VERCEL ? 3 : 10,
    connectionTimeoutMillis: 10000,
  });
  async function transaction<T>(
    work: (db: PoolClient) => Promise<T>,
    snapshot = false,
  ) {
    const db = await pool.connect();
    try {
      await db.query(
        snapshot ? "begin isolation level repeatable read" : "begin",
      );
      await db.query("set local time zone 'UTC'");
      const result = await work(db);
      await db.query("commit");
      return result;
    } catch (e) {
      await db.query("rollback");
      if ((e as any).code === "23505")
        throw new HttpException("This name already exists.", 409);
      throw e;
    } finally {
      db.release();
    }
  }
  try { await transaction(async (db) => {
    await db.query("select pg_advisory_xact_lock(843195)");
    await initialize(db);
  }); } catch (error) {
    await pool.end();
    throw error;
  }
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  const cookie = {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.VERCEL === "1" || process.env.COOKIE_SECURE === "true",
    path: "/api/auth",
  };
  const rawCookie = (req: any) =>
    /(?:^|;\s*)daybook_refresh=([a-f0-9]{96})(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1] || "";
  async function identity(db: PoolClient, req: any): Promise<Person> {
    try {
      const token =
        String(req.headers.authorization || "").match(/^Bearer (.+)$/)?.[1] ||
        "";
      const claim = jwt.verify(token, secret!, {
        algorithms: ["HS256"],
        issuer: "daybook",
        audience: "daybook-web",
      }) as jwt.JwtPayload;
      const person = (
        await db.query(
          "select p.id,p.name,p.email,p.role,p.manager from sessions s join people p on p.id=s.person where s.id=$1 and p.id=$2 and s.expires>now()",
          [claim.sid, claim.sub],
        )
      ).rows[0];
      requireValue(person, "Session expired.", 401);
      return person;
    } catch (e) {
      if (e instanceof jwt.JsonWebTokenError)
        throw new HttpException("Please sign in again.", 401);
      throw e;
    }
  }
  function ticket(id: number, sid: string) {
    return {
      token: jwt.sign({ sid }, secret!, {
        subject: String(id),
        algorithm: "HS256",
        issuer: "daybook",
        audience: "daybook-web",
        expiresIn: "5m",
      }),
    };
  }
  @Controller("api")
  class LeaveController {
    @Post("auth/:action") async auth(
      @Param("action") op: string,
      @Req() req: any,
      @Res({ passthrough: true }) res: any,
      @Body() b: any,
    ) {
      const refresh = randomBytes(48).toString("hex");
      const result = await transaction(async (db) => {
        if (op === "login") {
          requireValue(
            typeof b.email === "string" &&
              b.email.length < 255 &&
              typeof b.password === "string" &&
              b.password.length <= 128,
            "Enter email and password.",
          );
          const u = (
            await db.query("select * from people where email=$1", [
              b.email.trim().toLowerCase(),
            ])
          ).rows[0];
          requireValue(
            u && (await compare(b.password, u.password_hash)),
            "Incorrect email or password.",
            401,
          );
          const sid = randomUUID();
          await db.query(
            "insert into sessions values($1,$2,$3,now()+interval '8 hours')",
            [sid, u.id, digest(refresh)],
          );
          await db.query("insert into audit(actor,action) values($1,'login')", [
            u.id,
          ]);
          return ticket(u.id, sid);
        }
        if (op === "refresh") {
          const row = (
            await db.query(
              "update sessions set digest=$2 where digest=$1 and expires>now() returning id,person",
              [digest(rawCookie(req)), digest(refresh)],
            )
          ).rows[0];
          requireValue(row, "Session expired.", 401);
          return ticket(row.person, row.id);
        }
        requireValue(op === "logout", "Unknown action.", 404);
        const removed = (
          await db.query(
            "delete from sessions where digest=$1 returning person",
            [digest(rawCookie(req))],
          )
        ).rows[0];
        if (removed)
          await db.query(
            "insert into audit(actor,action) values($1,'logout')",
            [removed.person],
          );
        return {};
      });
      if (op === "logout") res.clearCookie("daybook_refresh", cookie);
      else
        res.cookie("daybook_refresh", refresh, {
          ...cookie,
          maxAge: 8 * 3600000,
        });
      return result;
    }
    @Get("workspace") workspace(@Req() req: any, @Query("year") y: string) {
      const year = y === undefined ? new Date().getUTCFullYear() : Number(y);
      requireValue(
        Number.isInteger(year) && year >= 1900 && year <= 9999,
        "Invalid balance year.",
      );
      return transaction(
        async (db) => state(db, await identity(db, req), year),
        true,
      );
    }
    @Post("actions/:action") command(
      @Req() req: any,
      @Param("action") op: string,
      @Body() b: any,
    ) {
      return transaction(async (db) =>
        change(db, await identity(db, req), op, b),
      );
    }
  }
  @Module({ controllers: [LeaveController] })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
  });
  app.use("/api", (req: any, res: any, next: Function) => {
    const id = randomUUID(),
      start = performance.now();
    res.setHeader("X-Request-ID", id);
    res.setHeader("Cache-Control", "no-store");
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          id,
          method: req.method,
          path: req.originalUrl.split("?")[0],
          status: res.statusCode,
          ms: Math.round(performance.now() - start),
        }),
      ),
    );
    if (req.method === "POST" && !req.is("application/json"))
      return res.status(415).json({ message: "JSON content required." });
    next();
  });
  app.useStaticAssets(resolve("dist/web"));
  return { app, pool };
}
