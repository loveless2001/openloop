import { loadEnvironment } from "../config/env.js";
import { openDatabase } from "./client.js";
import { applyMigrations } from "./migrations.js";

const environment = loadEnvironment();
const database = openDatabase(environment.DATABASE_URL);

try {
  applyMigrations(database);
  console.log("OpenLoop database migrations applied.");
} finally {
  database.sqlite.close();
}
