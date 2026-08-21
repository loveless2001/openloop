import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(resolve(workspaceRoot, ".env"), "utf8");
    for (const sourceLine of contents.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function nativeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function ollamaEnvironment(baseUrl) {
  const url = new URL(baseUrl);
  return { ...process.env, OLLAMA_HOST: url.host };
}

async function isServing(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/version`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilServing(baseUrl, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Ollama exited during startup with code ${child.exitCode}.`,
      );
    }
    if (await isServing(baseUrl)) return;
    await delay(250);
  }
  throw new Error("Ollama did not become ready within 30 seconds.");
}

async function installedModels(baseUrl) {
  const response = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`Could not list Ollama models (HTTP ${response.status}).`);
  const payload = await response.json();
  return new Set(
    (payload.models ?? [])
      .flatMap(({ name, model }) => [name, model])
      .filter(Boolean),
  );
}

function runOllama(args, baseUrl) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("ollama", args, {
      cwd: workspaceRoot,
      env: ollamaEnvironment(baseUrl),
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ollama ${args[0]} exited with code ${code}.`));
    });
  });
}

async function stopOwnedServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolvePromise) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolvePromise();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(finish, 2_000).unref();
  });
}

await loadLocalEnvironment();

const provider = process.env.COMPLETION_PROVIDER ?? "ollama";
const model =
  process.env.COMPLETION_MODEL ??
  "hf.co/mradermacher/SmolLM3-3B-Base-GGUF:Q4_K_M";
const baseUrl = nativeBaseUrl(
  process.env.COMPLETION_BASE_URL ?? "http://127.0.0.1:11434/v1",
);

if (provider !== "ollama") {
  console.log(
    `Autocomplete provider is ${provider}; Ollama setup is not required.`,
  );
  process.exit(0);
}

const url = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error("The setup script only manages a local Ollama endpoint.");
}

const versionCheck = spawnSync("ollama", ["--version"], {
  env: ollamaEnvironment(baseUrl),
  stdio: "ignore",
  windowsHide: true,
});
if (versionCheck.error?.code === "ENOENT") {
  throw new Error(
    "Ollama is not installed or is not on PATH. Install it from https://ollama.com/download and rerun `pnpm setup:ollama`.",
  );
}

let ownedServer;
try {
  if (!(await isServing(baseUrl))) {
    console.log("Starting Ollama for setup…");
    ownedServer = spawn("ollama", ["serve"], {
      env: ollamaEnvironment(baseUrl),
      stdio: "ignore",
      windowsHide: true,
    });
    await waitUntilServing(baseUrl, ownedServer);
  }

  const models = await installedModels(baseUrl);
  if (!models.has(model)) {
    console.log(`Pulling ${model}…`);
    await runOllama(["pull", model], baseUrl);
  } else {
    console.log(`${model} is already installed.`);
  }

  const verifiedModels = await installedModels(baseUrl);
  if (!verifiedModels.has(model)) {
    throw new Error(`Ollama did not report ${model} after setup.`);
  }
  console.log(`Ollama setup complete: ${model}`);
} finally {
  await stopOwnedServer(ownedServer);
}
