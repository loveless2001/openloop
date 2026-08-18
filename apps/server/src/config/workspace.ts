import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function findWorkspaceRoot(from = process.cwd()): string {
  let current = resolve(from);

  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not locate pnpm-workspace.yaml");
    }
    current = parent;
  }
}
