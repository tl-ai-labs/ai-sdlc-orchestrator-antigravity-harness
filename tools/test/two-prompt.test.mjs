/**
 * The two-prompt user surface (README "Setup — the two-prompt flow") and the
 * agy vocabulary of the entry-point skills. Regressions here are silent:
 * a `${CLAUDE_PLUGIN_ROOT}` left in a skill is a path the model cannot
 * resolve, and a `/mmo:` reference names a command this runtime does not
 * register.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("README carries prompt 1 (the repo URL, verbatim) and prompt 2 (a new session, then the skills)", () => {
  const readme = read("README.md");
  assert.match(readme, /## Setup — the two-prompt flow/);
  assert.match(readme, /Set up this plugin from this repo - https:\/\/github\.com\/tl-ai-labs\/ai-sdlc-orchestrator-antigravity-harness/);
  assert.match(readme, /\*\*Prompt 2 — run\.\*\* Start a \*\*new `agy` session in the same folder\*\*/);
  assert.match(readme, /\/greenfield/);
  assert.match(readme, /\/brownfield/);
  assert.match(readme, /node tools\/setup\.mjs --project-root/);
  assert.ok(!/agy plugin install/.test(readme.replace(/Do not run `agy plugin install`/g, "")), "never a global install");
});

test("README's skills table names every shipped entry-point skill and no /mmo: command", () => {
  const readme = read("README.md");
  const skills = readdirSync(join(ROOT, "plugin", "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const s of skills) assert.match(readme, new RegExp(`\\[\`${s}\`\\]\\(plugin/skills/${s}/SKILL\\.md\\)|\`${s}\``), s);
  assert.ok(!/\/mmo:/.test(readme));
});

test("INSTALL.md and SETUP.md describe the project-folder flow: clone beside, register, new session", () => {
  const install = read("INSTALL.md");
  assert.match(install, /tools\/setup\.mjs --project-root/);
  assert.match(install, /\.agents\/plugins\.json/);
  assert.match(install, /new\*\* `agy` session/);
  const setup = read("SETUP.md");
  assert.match(setup, /Arm A/); assert.match(setup, /Arm B/);
  assert.match(setup, /antigravity-flash38-plus-haiku45/);
  assert.match(setup, /Before any paid run/);
});

test("entry-point skills use ${MMO_PLUGIN_ROOT} and skill names, never Claude Code's variable or slash commands", () => {
  const skills = readdirSync(join(ROOT, "plugin", "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const s of skills) {
    const text = read(join("plugin", "skills", s, "SKILL.md"));
    assert.ok(!text.includes("${CLAUDE_PLUGIN_ROOT}"), `${s}: \${CLAUDE_PLUGIN_ROOT}`);
    assert.ok(!/\/mmo:[a-z-]+/.test(text), `${s}: /mmo: reference`);
    assert.ok(!/~\/\.claude|\.claude\/settings/.test(text), `${s}: Claude Code settings path`);
  }
  const rules = read("plugin/rules/AGENTS.md");
  assert.match(rules, /MMO_PLUGIN_ROOT/, "the rules say how to resolve it");
  assert.match(rules, /include_only/);
});

test("the pass skill accepts only --auth=vendor on this runtime", () => {
  const pass = read("plugin/skills/pass/SKILL.md");
  assert.match(pass, /`--auth=vendor` — \*\*required\*\*, and `vendor` is the only value/);
  assert.ok(!/CLAUDE_CODE_SUBAGENT_MODEL` must be set/.test(pass));
});
