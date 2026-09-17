#!/usr/bin/env node
/**
 * Setup wizard — the script prompt 1 drives (README, "Setup — the two-prompt
 * flow"). Checks Node / agy / claude / credentials, builds the bundled MCP
 * server, optionally selects the Antigravity SDK agent path, registers this
 * harness with the project you will run in, and picks that project's policy.
 *
 * What is agy-specific here: agy discovers a plugin from the WORKSPACE it is
 * opened in — `<project>/.agents/plugins.json` — never from a global install
 * (docs/verification/p1-agy-runtime.md check 10). So the one step the Claude
 * and Codex harnesses do not have is writing that file into the project,
 * pointing at this clone by absolute path. Nothing under ~/.gemini is touched.
 *
 * Shares its checks with plugin/agy/verify-setup.mjs by import — one copy.
 *
 * Usage:
 *   node tools/setup.mjs                                  # project = cwd
 *   node tools/setup.mjs --project-root=<dir>             # register another project
 *   node tools/setup.mjs --policy=<name>                  # skip the console; write the name
 *   node tools/setup.mjs --no-agent | --agent             # pre-answer the Gemini door
 *   node tools/setup.mjs --yes                            # every question takes its default
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  buildWorkerEnvironment, workerPaths, vertexCredentialState, inspectCredentialFile, probeAgyCli, probeClaudeCli,
  meetsMinVersion, mcpPaths, MIN_AGY_VERSION, AGENT_WORKER_SELECT, observePolicy, claudeArmState, pluginDiscoveryState,
} from "../plugin/agy/verify-setup.mjs";
import { writeMmoSelectFile } from "../plugin/agy/mmoSelect.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = join(ROOT, "plugin");
const ADC_FILE = join(homedir(), ".config", "gcloud", "application_default_credentials.json");

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
    else if (["project-root", "policy"].includes(a.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith("--")) args[a.slice(2)] = argv[++i];
    else args[a.slice(2)] = true;
  }
  return args;
}

/**
 * The registration a project needs so that opening `agy` in it discovers this
 * harness's plugin. Absolute path: `.agents/plugins.json` resolves bare paths
 * against the project's own repo root, which is not where the clone is.
 * Inside the harness clone itself the committed file (`path: "."`) already
 * does this, so it is left alone.
 */
export function registrationFor(projectRoot, harnessRoot = ROOT) {
  const inside = resolve(projectRoot) === resolve(harnessRoot);
  return { entries: [{ path: inside ? "." : resolve(harnessRoot), include_only: ["^plugin$"] }] };
}

/** Merge this harness into an existing plugins.json without dropping other entries. */
export function mergeRegistration(existing, registration) {
  const wanted = registration.entries[0];
  const entries = Array.isArray(existing?.entries) ? existing.entries.slice() : [];
  const already = entries.some((e) => e?.path === wanted.path && (e.include_only ?? []).includes("^plugin$"));
  if (!already) entries.push(wanted);
  return { ...(existing && typeof existing === "object" ? existing : {}), entries };
}

export function registerProject(projectRoot, harnessRoot = ROOT, io = { existsSync, readFileSync, writeFileSync, mkdirSync }) {
  const path = join(projectRoot, ".agents", "plugins.json");
  const registration = registrationFor(projectRoot, harnessRoot);
  let existing = null;
  if (io.existsSync(path)) {
    try { existing = JSON.parse(io.readFileSync(path, "utf8")); } catch { existing = null; }
  }
  const merged = mergeRegistration(existing, registration);
  const changed = JSON.stringify(merged) !== JSON.stringify(existing);
  if (changed) {
    io.mkdirSync(dirname(path), { recursive: true });
    io.writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  }
  return { path, changed, registration: merged };
}

const c = { dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", amber: "\x1b[33m", red: "\x1b[31m", reset: "\x1b[0m" };
const ok = (m) => console.log(`  ${c.green}✓${c.reset} ${m}`);
const warn = (m) => console.log(`  ${c.amber}!${c.reset} ${m}`);
const fail = (m) => console.log(`  ${c.red}✗${c.reset} ${m}`);
const hint = (m) => console.log(`  ${c.dim}${m}${c.reset}`);
let stepNo = 0;
const step = (m) => console.log(`\n${c.bold}[${++stepNo}]${c.reset} ${m}`);

async function main(args) {
  const projectRoot = resolve(args["project-root"] ?? process.cwd());
  const interactive = input.isTTY === true && !args.yes;
  const rl = interactive ? createInterface({ input, output }) : null;
  const askYesNo = async (q, defaultYes = true) => {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    if (!interactive) {
      console.log(`  ${c.dim}?${c.reset} ${q} ${suffix} ${c.dim}→ ${defaultYes ? "yes" : "no"}${c.reset}`);
      return defaultYes;
    }
    const a = (await rl.question(`  ? ${q} ${suffix} `)).trim().toLowerCase();
    if (!a) return defaultYes;
    return a.startsWith("y");
  };
  const run = (cmd, argv, cwd) => spawnSync(cmd, argv, { cwd, encoding: "utf8", stdio: "pipe" });

  console.log(`\n${c.bold}AI-SDLC orchestrator (antigravity harness) — setup${c.reset}`);
  console.log(`${c.dim}Harness: ${ROOT}\nProject: ${projectRoot}${c.reset}`);
  let blocked = false;

  step("Node.js");
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor >= 20) ok(`Node ${process.versions.node}`);
  else { fail(`Node ${process.versions.node} — this repo needs Node 20 or newer.`); rl?.close(); return 1; }

  step("Antigravity CLI (agy)");
  const agy = probeAgyCli();
  if (agy.unprovable) warn(`Could not run agy --version (${agy.detail}); run this from a plain terminal to check it.`);
  else if (!agy.present) {
    fail("agy is not on PATH.");
    hint("curl -fsSL https://antigravity.google/cli/install.sh | bash   — then open a new shell.");
    blocked = true;
  } else if (!meetsMinVersion(agy.version, MIN_AGY_VERSION)) {
    fail(`agy ${agy.version.join(".")} — this harness is verified against ${MIN_AGY_VERSION.join(".")} or newer. Run: agy update`);
    blocked = true;
  } else {
    ok(`agy ${agy.version.join(".")}`);
    hint("Sign-in is not checked here (every agy command that needs it opens a browser). `agy models` must list models before a run.");
  }

  step("Claude Code (the Opus worker)");
  const claude = probeClaudeCli();
  if (claude.present) ok(`claude ${claude.version?.join(".") ?? ""}`.trim());
  else if (claude.unprovable) warn("Could not run claude --version from here.");
  else { fail("claude is not on PATH — the claude-cli adapter spawns `claude -p` for every judgment phase."); hint("https://code.claude.com/docs"); blocked = true; }

  step("Credentials");
  const env = process.env;
  const policy = observePolicy(PLUGIN_ROOT, projectRoot);
  const policyLabel = policy.selected ? `policy '${policy.name}'` : `default policy '${policy.name}'`;
  const arm = claudeArmState(env);
  if (arm.arm === "A") ok("Arm A: ANTHROPIC_API_KEY is set — Opus 5 bills the Anthropic key.");
  else if (arm.arm === "B" && !arm.missing?.length) ok(`Arm B: Vertex — Opus 5 bills GCP project ${env.ANTHROPIC_VERTEX_PROJECT_ID} (${env.CLOUD_ML_REGION}).`);
  else if (arm.arm === "B") { fail(`Arm B is incomplete: ${arm.detail}.`); blocked = true; }
  else if (arm.arm === "both") { fail(`Both Claude arms are set (${arm.detail}). Unset one.`); blocked = true; }
  else if (policy.usesClaudeCli === false) ok(`No Claude wallet, and the ${policyLabel} does not need one.`);
  else {
    fail(`No Claude wallet, and the ${policyLabel} bills one.`);
    hint("Arm A: export ANTHROPIC_API_KEY=…   Arm B: CLAUDE_CODE_USE_VERTEX=1 ANTHROPIC_VERTEX_PROJECT_ID=… CLOUD_ML_REGION=global");
    blocked = true;
  }
  const vertex = vertexCredentialState({
    env,
    serviceAccountFile: env.GOOGLE_APPLICATION_CREDENTIALS ? inspectCredentialFile(env.GOOGLE_APPLICATION_CREDENTIALS) : null,
    adcFile: inspectCredentialFile(ADC_FILE),
  });
  if (env.GEMINI_API_KEY) ok("GEMINI_API_KEY is set — the mechanical tier reaches Gemini via AI Studio.");
  else if (vertex.state === "credential") ok(`Vertex credential found (${vertex.source}) — the mechanical tier reaches Gemini via Vertex.`);
  else if (vertex.state === "broken") { fail(`A Google credential is configured but unusable: ${vertex.detail}`); blocked = true; }
  else if (policy.usesGemini === false) ok(`No Gemini credential, and the ${policyLabel} does not need one.`);
  else {
    fail("No Gemini credential — mechanical phases would abort at the first dispatch.");
    hint("export GEMINI_API_KEY=…   (https://aistudio.google.com/app/apikey)   or: gcloud auth application-default login");
    blocked = true;
  }

  step("How the mechanical tier reaches Gemini");
  hint("model path — one completion call per packet (flash-completion). The default.");
  hint("agent path — an Antigravity SDK session with tools (flash-agsdk-worker). Vertex ADC only.");
  let wantAgent = false;
  if (args.agent) wantAgent = true;
  else if (!args["no-agent"] && vertex.state === "credential") wantAgent = await askYesNo("Use the agent path for mechanical work?", false);
  if (wantAgent) {
    if (vertex.state !== "credential") { fail("The agent path needs Vertex ADC; none found."); blocked = true; }
    else { const p = writeMmoSelectFile(projectRoot, AGENT_WORKER_SELECT); ok(`Agent path selected (MMO_SELECT=${AGENT_WORKER_SELECT}) — ${p}`); hint("The MCP route reads MMO_SELECT from the shell that launches agy; export it there too."); }
  } else ok("Model path (the default). Nothing to configure.");

  step("Bundled MCP server");
  const { serverDir, distEntry, nodeModules } = mcpPaths(PLUGIN_ROOT);
  if (existsSync(distEntry) && existsSync(nodeModules)) ok("Already installed and built.");
  else if (await askYesNo("Install dependencies and build the bridge now?", true)) {
    for (const [label, argv] of [["installing dependencies", ["ci"]], ["building", ["run", "build"]]]) {
      process.stdout.write(`  ${c.dim}→ ${label}…${c.reset}\n`);
      const r = run("npm", argv, serverDir);
      if (r.status !== 0) { fail(`${label} failed:\n${(r.stderr || r.stdout || "").trim()}`); blocked = true; break; }
    }
    if (existsSync(distEntry)) ok("Built.");
  } else { warn("Skipped — the bridge cannot dispatch until it is built."); blocked = true; }

  if (wantAgent) {
    step("Antigravity agent worker (Python)");
    const { venvPython } = workerPaths(PLUGIN_ROOT);
    if (existsSync(venvPython)) ok("Python environment already present.");
    else if (await askYesNo("Build the worker's Python environment now? (needs Python 3.10+)", true)) {
      const built = buildWorkerEnvironment(PLUGIN_ROOT, (m) => console.log(m));
      if (built.ok) ok(`Built with ${built.detail}`); else { fail(built.detail); blocked = true; }
    } else warn("Skipped — mechanical packets on the agent path would fail until it exists.");
  }

  step("Register the plugin with this project");
  const discovery = pluginDiscoveryState(PLUGIN_ROOT);
  if (!discovery.ok) { fail(`The harness clone is incomplete: ${discovery.problems.join("; ")}`); blocked = true; }
  const reg = registerProject(projectRoot);
  const relPath = relative(process.cwd(), reg.path);
  const rel = !relPath || relPath.startsWith("..") ? reg.path : relPath;
  if (reg.changed) ok(`Wrote ${rel} → agy opened in this project discovers the mmo plugin from the clone.`);
  else ok(`${rel} already registers the plugin.`);
  hint("Nothing under ~/.gemini is edited. Do not run `agy plugin install` on this repo.");

  step("This project's default policy");
  const projectJson = join(projectRoot, ".sdlc", "project.json");
  let current = null;
  try { current = JSON.parse(readFileSync(projectJson, "utf8")).default_policy ?? null; } catch { /* none yet */ }
  if (args.policy) {
    const r = run(process.execPath, [join(PLUGIN_ROOT, "scripts", "setup-policy.mjs"), "--policy", String(args.policy), "--project-root", projectRoot, "--skip-install"], ROOT);
    if (r.status === 0) ok(`default_policy = ${args.policy} (${projectJson})`);
    else { fail(`Could not write the policy: ${(r.stderr || r.stdout || "").trim()}`); blocked = true; }
  } else if (current) {
    ok(`default_policy = ${current} (already chosen). Change it: node plugin/scripts/setup-policy.mjs --project-root "${projectRoot}"`);
  } else if (interactive && (await askYesNo("Open the policy console in your browser to pick one now?", true))) {
    const r = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "setup-policy.mjs"), "--project-root", projectRoot], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) warn("The console did not record a choice; the launcher falls back to antigravity-flash38-plus-opus5.");
  } else {
    ok("No project policy chosen; the launcher and the skills fall back to antigravity-flash38-plus-opus5.");
    hint(`Pick one later: node plugin/scripts/setup-policy.mjs --project-root "${projectRoot}"   or --policy=<name> here.`);
  }

  console.log("");
  if (blocked) {
    console.log(`${c.bold}Setup incomplete.${c.reset} Resolve the items marked ✗ above, then re-run:  node tools/setup.mjs --project-root "${projectRoot}"`);
    console.log(`${c.dim}Re-check without the questions: npm run verify${c.reset}`);
  } else {
    console.log(`${c.bold}Setup complete.${c.reset} Start a NEW agy session in ${projectRoot} — plugins and MCP servers load when a session begins — then:`);
    console.log(`  type / and pick greenfield (empty folder + brief) or brownfield (existing repo)`);
    console.log(`\nHeadless instead:\n  node "${join(ROOT, "plugin", "agy", "run.mjs")}" --brief=./brief.md --project-root="${projectRoot}" --output-dir="${projectRoot}/.sdlc" --dry-run`);
    console.log(`${c.dim}Re-check any time: npm run verify${c.reset}`);
  }
  rl?.close();
  return blocked ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main(parseArgs(process.argv.slice(2))));
}
