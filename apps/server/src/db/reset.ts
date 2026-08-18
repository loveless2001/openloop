import { rmSync } from "node:fs";

import { loadEnvironment } from "../config/env.js";
import { databasePathFromUrl, openDatabase } from "./client.js";
import { applyMigrations } from "./migrations.js";

const environment = loadEnvironment();
const databasePath = databasePathFromUrl(environment.DATABASE_URL);
rmSync(databasePath, { force: true });

const database = openDatabase(environment.DATABASE_URL);
try {
  applyMigrations(database);
  console.log(`Reset OpenLoop database at ${databasePath}.`);
} finally {
  database.sqlite.close();
}
