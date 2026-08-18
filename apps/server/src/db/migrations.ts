import { resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { Database } from "./client.js";
import { findWorkspaceRoot } from "../config/workspace.js";

export function applyMigrations(database: Database): void {
  migrate(database.orm, {
    migrationsFolder: resolve(findWorkspaceRoot(), "apps/server/drizzle"),
  });
}
