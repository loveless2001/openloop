import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { findWorkspaceRoot } from "../config/workspace.js";
import * as schema from "./schema.js";

export function databasePathFromUrl(databaseUrl: string): string {
  const rawPath = databaseUrl.slice("file:".length);
  return isAbsolute(rawPath) ? rawPath : resolve(findWorkspaceRoot(), rawPath);
}

export function openDatabase(databaseUrl: string) {
  const databasePath = databasePathFromUrl(databaseUrl);
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  return {
    orm: drizzle(sqlite, { schema }),
    sqlite,
  };
}

export type Database = ReturnType<typeof openDatabase>;
