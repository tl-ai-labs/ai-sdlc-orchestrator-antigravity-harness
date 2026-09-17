/**
 * tools/setup.mjs — the script prompt 1 drives. The pure pieces (argv,
 * project registration) are unit-tested; the whole wizard runs once
 * non-interactively against an empty project with dummy credentials.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, registrationFor, mergeRegistration, registerProject } from "../setup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("parseArgs takes --key=value, --key value for the two path flags, and bare flags", () => {
  assert.deepEqual(parseArgs(["--project-root", "/p", "--policy=x", "--yes", "--no-agent"]), { "project-root": "/p", policy: "x", yes: true, "no-agent": true });
});

test("a project outside the clone is registered by absolute path; the clone itself keeps path '.'", () => {
  assert.deepEqual(registrationFor("/some/project", "/h"), { entries: [{ path: "/h", include_only: ["^plugin$"] }] });
  assert.deepEqual(registrationFor("/h", "/h").entries[0].path, ".");
  assert.deepEqual(registrationFor(ROOT), JSON.parse(readFileSync(join(ROOT, ".agents", "plugins.json"), "utf8")), "the committed file is what the clone would get");
});

test("mergeRegistration keeps a project's other entries and never duplicates ours", () => {
  const reg = registrationFor("/p", "/h");
  const merged = mergeRegistration({ entries: [{ path: "tools/skills" }], inherits: [] }, reg);
  assert.deepEqual(merged.entries, [{ path: "tools/skills" }, { path: "/h", include_only: ["^plugin$"] }]);
  assert.deepEqual(merged.inherits, []);
  assert.deepEqual(mergeRegistration(merged, reg), merged);
});

test("registerProject writes .agents/plugins.json once and reports no change the second time", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-setup-"));
  try {
    const first = registerProject(dir, "/h");
    assert.equal(first.changed, true);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, ".agents", "plugins.json"), "utf8")).entries[0].path, "/h");
    assert.equal(registerProject(dir, "/h").changed, false);
    writeFileSync(join(dir, ".agents", "plugins.json"), "not json");
    assert.equal(registerProject(dir, "/h").changed, true, "an unreadable file is replaced, not left to break discovery");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the wizard runs non-interactively against an empty project and leaves it registered with a policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-setup-run-"));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "tools", "setup.mjs"), `--project-root=${dir}`, "--yes", "--no-agent", "--policy=antigravity-flash38-plus-haiku45"], {
      encoding: "utf8", timeout: 120_000,
      env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-dummy", GEMINI_API_KEY: "AIza-dummy" },
    });
    const out = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(existsSync(join(dir, ".agents", "plugins.json")), out);
    assert.equal(JSON.parse(readFileSync(join(dir, ".sdlc", "project.json"), "utf8")).default_policy, "antigravity-flash38-plus-haiku45");
    assert.match(out, /Register the plugin with this project/);
    assert.match(out, /Arm A: ANTHROPIC_API_KEY is set/);
    assert.match(out, /Start a NEW agy session|Setup incomplete/);
    assert.ok(!/plugin install/.test(out.replace(/Do not run `agy plugin install`/g, "")), "never tells anyone to install globally");
    assert.ok(!out.includes("sk-ant-dummy"), "never prints a key");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
