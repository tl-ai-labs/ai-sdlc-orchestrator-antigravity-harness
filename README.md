# AI-SDLC Orchestrator — Antigravity CLI harness

The third runtime harness for the multi-model AI-SDLC pipeline, after the [Claude Code harness](https://github.com/tl-ai-labs/ai-sdlc-orchestrator-claude-code-harness) and the [Codex harness](https://github.com/tl-ai-labs/ai-sdlc-orchestrator-codex-harness). The same `mmo` plugin, the same `model-dispatch` bridge, ported to Google's Antigravity CLI (`agy`).

| Role | Model | Path |
|---|---|---|
| Conductor (driver) | Gemini 3.8 Flash, effort high | `agy` itself, on your Google seat |
| Judgment phases | Claude Opus 5 | bridge → `claude-cli` adapter → `claude -p` (the Claude Agent SDK engine). Arm A bills an Anthropic key; arm B bills a GCP project through Vertex |
| Mechanical phases | Gemini 3.8 Flash | bridge → `flash-completion` on `GEMINI_API_KEY`, or the Antigravity SDK worker on Vertex ADC |

The conductor authors no shipped content. Every requirements document, design, packet result, review and test comes back from a bridge dispatch, where it is priced and recorded in `telemetry.jsonl`.

## Status

**P4 — records and parity.** The plugin, bridge, policies, prompts, the headless driver (`plugin/agy/`) and the code-written `manifest.json` are in place; the offline test suite passes and `run.mjs --dry-run` prints the pinned invocation. The pin's live checks in [docs/verification/p1-agy-runtime.md](docs/verification/p1-agy-runtime.md) (1, 2, 4, 5, 6) are still pending a signed-in `agy` session, so `run.mjs` refuses a paid run unless told to stamp the pin as unverified. No measured run has been made.

## Layout

| Path | What |
|---|---|
| `plugin/plugin.json`, `plugin/mcp_config.json`, `plugin/rules/AGENTS.md` | The agy plugin manifest, its bridge registration, and the conductor rules |
| `plugin/skills/<name>/SKILL.md` | The 13 entry points (`greenfield`, `pass`, `brownfield`, …) plus `pipeline` and `brownfield-guide` |
| `plugin/agents/*.md` | The five role prompts, carried as content: each becomes the system prompt of a bridge dispatch |
| `plugin/mcp/model-dispatch/` | The bridge: routing policy → adapter → model, with its own telemetry ledger. `dist/` is gitignored; build it |
| `plugin/config/policies/` | Routing policies. `antigravity-flash38-plus-opus5.yaml` is the study policy; `antigravity-flash38-plus-haiku45.yaml` proves the wiring for cents |
| `plugin/agy/run.mjs` | The headless driver: builds the pinned `agy --print` invocation, captures stream-json, writes the driver's modeled cost and manifest |
| `plugin/agy/prompts/conductor.md` | The conductor prompt: state machine, TaskPacket contract, gates, the MCP route and the dispatch fallback |
| `plugin/agy/telemetry/` | `fairnessPin.mjs` reads the pin off the policy's `driver:` block; `event-reader.mjs` prices stream-json `usage` as a labeled modeled line |
| `plugin/agy/dispatch.mjs` | Pattern (b): the conductor shells out to this when its session binds no bridge tool; it speaks MCP via `mcp/model-dispatch/src/driverClient.ts` |
| `plugin/agy/hooks/`, `plugin/hooks.json` | The write-contract PreToolUse guard and the bridge-call heartbeat, in agy's hook format |
| `plugin/agy/verify-setup.mjs`, `plugin/agy/env-checks.mjs` | Offline setup check and repair (`npm run verify -- --fix`) |
| `plugin/agy/manifest.mjs` | Writes `manifest.json` from the run directory: the bridge's rollups plus `harness`, `usage` and `cost` (three labeled lines) |
| `plugin/policy-console/` | The one UI: a local page (`npm run console`, then http://127.0.0.1:3000) to pick or customize a routing policy. Shows the agy driver pin on every card and carries it into saved policies |
| `.agents/plugins.json` | Registers `plugin/` with agy from the repo. Nothing is written under `~/.gemini/` |
| `docs/verification/p1-agy-runtime.md` | Numbered runtime checks. Every pin cites one |
| `examples/*/brief.md` | Briefs. `quick-demo` is the first paid run |
| `tools/setup.mjs` | The setup wizard prompt 1 drives: checks, build, project registration, policy pick |
| `tools/report.mjs` | Cost report over a run directory |

## What you need

| To | You need |
|---|---|
| **Try it at all** | Node.js 20+, the Antigravity CLI (`agy` ≥ 1.2.3) signed in to a Google account, Claude Code (`claude`) on PATH, and one Claude wallet: `ANTHROPIC_API_KEY` (arm A) or a GCP project with Claude enabled in Model Garden (arm B) |
| **Run the mechanical tier** | A Gemini door: `GEMINI_API_KEY` from [AI Studio](https://aistudio.google.com/app/apikey), or Application Default Credentials from `gcloud auth application-default login` |
| **Use the Antigravity agent path** | The above, plus Python 3.10+ and Vertex ADC — there is no API-key door for the agent worker |

You do not pick a Gemini door yourself — setup asks. You do not write a policy — `antigravity-flash38-plus-opus5` loads by default.

## Setup — the two-prompt flow

**Prompt 1 — setup.** Open `agy` in the folder you want to work in (an empty folder for greenfield, an existing repo for brownfield) and paste this verbatim:

```
Set up this plugin from this repo - https://github.com/tl-ai-labs/ai-sdlc-orchestrator-antigravity-harness
```

agy follows [INSTALL.md](INSTALL.md): clones the harness next to your project (or finds an existing clone), builds the bundled MCP server, checks `agy`, `claude` and the credentials in your shell, asks whether to use the Antigravity SDK agent path (only when Vertex ADC is present), writes `.agents/plugins.json` into your project so agy discovers the plugin from the clone, and opens the browser once to pick this project's policy (or hit Save on `antigravity-flash38-plus-opus5`). Nothing is written under `~/.gemini/`.

**Prompt 2 — run.** Start a **new `agy` session in the same folder**, then whichever fits:

```
/greenfield          # empty folder + project brief
/brownfield          # existing repo, pick a job type
```

Type `/` and pick the skill from the list if the name differs — the slash name a plugin skill gets is check 4 in [docs/verification/p1-agy-runtime.md](docs/verification/p1-agy-runtime.md), still pending live confirmation. Both check the install, show which model each phase runs on, confirm the plan (Gate 0 in brownfield), and only then start spending.

> **Why a new session matters.** agy loads a plugin's skills, rules, hooks and MCP servers when a session begins. In the setup session the `mmo` skills and the `model-dispatch` bridge are not yet live — a run started there would have no bridge to dispatch through.

Prefer to drive it yourself:

```bash
git clone https://github.com/tl-ai-labs/ai-sdlc-orchestrator-antigravity-harness.git
cd ai-sdlc-orchestrator-antigravity-harness && npm ci && npm run build
node tools/setup.mjs --project-root /path/to/your/project
```

## Skills

The workflow ships as 15 agy skills under [plugin/skills/](plugin/skills/). In a session, type `/` to pick one.

### Run the pipeline

| Skill | What it does | When to use it |
|---|---|---|
| [`greenfield`](plugin/skills/greenfield/SKILL.md) | Runs the greenfield pipeline. Interviews you for the brief (or reads one you point at), confirms the output path, shows the routing plan, then starts spending. Takes no arguments | Empty folder + a project brief. Generates a whole new app into `./src/` |
| [`brownfield`](plugin/skills/brownfield/SKILL.md) | Runs the brownfield pipeline. Hydrates prior state, runs discovery (or resumes), asks for the intent and brief, freezes scope at Gate 0, then executes. Takes no arguments | Existing repo. Extends the code you already have |
| [`pass`](plugin/skills/pass/SKILL.md) | Headless twin of the above. Every setting a flag: `--auth`, `--policy`, `--study`, `--run-id`, `--mode`, `--intent`, `--gates`, and more | CI, scripted replays, batch runs. The measured runs use `plugin/agy/run.mjs`, which wraps the same pipeline with the pinned `agy` invocation |

### Run a specific brownfield job

Seven aliases into `brownfield`, each with the job type pre-selected — one shared manual, one Gate 0, no second pipeline. An optional free-text argument seeds the brief; Gate 0 still fires and re-confirms scope either way.

| Skill | Job type | Example |
|---|---|---|
| [`docs`](plugin/skills/docs/SKILL.md) | `docs` | write API docs, README, ADRs, docstrings for the auth module |
| [`bugfix`](plugin/skills/bugfix/SKILL.md) | `bugfix` | fix the /login endpoint returning 500 on missing password |
| [`feature-extend`](plugin/skills/feature-extend/SKILL.md) | `feature-extend` | add a `?filter` param to the existing /users endpoint |
| [`feature-new`](plugin/skills/feature-new/SKILL.md) | `feature-new` | add a webhooks module (endpoint, storage, retry loop) |
| [`refactor`](plugin/skills/refactor/SKILL.md) | `refactor` | extract shared date logic into a util module and update all call sites |
| [`test`](plugin/skills/test/SKILL.md) | `test` | backfill unit tests for src/payments to reach 80% line coverage |
| [`deps`](plugin/skills/deps/SKILL.md) | `deps` | upgrade jest 28 → 29 (and adapt breaking changes) |

These and `pass` start a full billable run; invoke them, never expect them to fire from a matching phrase.

### Setup and configuration

| Skill | What it does |
|---|---|
| [`setup`](plugin/skills/setup/SKILL.md) | Re-verify or re-configure the plugin for this project: bridge build, environment, credentials, Gemini door, policy. Idempotent |
| [`policy`](plugin/skills/policy/SKILL.md) | Show or change this project's default policy; `change` opens the policy console |
| [`revert`](plugin/skills/revert/SKILL.md) | Revert the file changes of one brownfield run from its provenance record |

`pipeline` and `brownfield-guide` are the playbooks the other skills read; you do not invoke them.

## Quick start from the clone

[INSTALL.md](INSTALL.md) has the steps an agent (or you) can follow verbatim; [SETUP.md](SETUP.md) has credentials, the two Claude arms and the Gemini doors.

```bash
npm ci
npm run build
npm test
npm run verify
```

A headless run, dry first:

```bash
node plugin/agy/run.mjs --brief=examples/quick-demo/brief.md --project-root=/path/to/empty/dir --output-dir=/path/to/empty/dir/.sdlc --gates=auto-approve --dry-run
```

An offline end-to-end run against the stub `agy` (no sign-in, no credentials, $0):

```bash
mkdir -p /tmp/smoke && cp examples/quick-demo/brief.md /tmp/smoke/brief.md && npm run smoke -- --project-root=/tmp/smoke --output-dir=/tmp/smoke/.sdlc && node tools/report.mjs /tmp/smoke/.sdlc
```

[docs/running.md](docs/running.md) has the flags, the resume loop and what the run directory holds.

## Standing rules

- Generic engine only: no campaign values, seeds or study ids in code.
- Never commit keys, credential files, run databases, run folders, or `dist/`.
- Every change ships its tests, offline and free, reachable from `npm test`.
- Pricing preflight before any paid run; no paid run without an explicit go.
- The `google-antigravity` SDK is never the driver and never carries a Claude call. agy's built-in Claude is never used.
- Nothing under `~/.gemini/` or `~/.claude` is edited; everything lives under `.agents/` in the repo.
- Modeled dollars (the driver line) and cash dollars (bridge dispatches) are never summed into one figure.

## Licence

MIT — see [LICENSE](LICENSE).
