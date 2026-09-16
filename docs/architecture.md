# Architecture

The Codex shape: a cheap conductor runs the loop, every model call goes through the bridge, the harness around the conductor writes the records.

```
node plugin/agy/run.mjs
  │  builds the pinned argv, renders the conductor prompt and skills
  ▼
agy --print <conductor.md> --output-format stream-json --model gemini-3.8-flash-high
  │  discovers plugin/ from .agents/plugins.json, launches model-dispatch from plugin/mcp_config.json
  │  Gemini conducts: reads the brief, builds TaskPackets, calls the bridge, writes artifacts
  ▼
model-dispatch (MCP, stdio)             ← execute_with_model / preflight_dispatch / load_policy / …
  │  policy rules → adapter → model; appends telemetry.jsonl
  ├─ claude-cli  → claude -p --model claude-opus-5 --effort high     (judgment phases; arm A key or arm B Vertex)
  └─ mcp:model-dispatch → Gemini 3.8 Flash (flash-completion)      (mechanical phases)
       or antigravity-worker → Antigravity SDK agent on Vertex ADC
  ▼
run.mjs reads the stream: models the driver's cost, checks for a pin rejection, writes the driver manifest
plugin/agy/manifest.mjs builds manifest.json from telemetry.jsonl + the driver files
```

## Who does what

| Piece | Owns | Never does |
|---|---|---|
| `run.mjs` | The invocation, the pins, the resume loop, the records | Decide pipeline order, author content |
| The conductor (Gemini on agy) | Reading the brief, building packets, judging results, gates | Author a requirements doc, design, code, test or review |
| The bridge | Routing, adapters, pricing, `telemetry.jsonl` | Anything agy-specific |
| The hooks | The write contract, the bridge-call heartbeat | Block on a bug — they fail open |

## Two dispatch routes

**(a) MCP route, the default.** agy binds the bridge's tools into the model's toolset (`mcp_servers.md`), possibly under a plugin prefix. The conductor prompt names the five tools and the arguments to pass on every call.

**(b) Dispatch fallback.** If a session binds no bridge tool, the conductor runs `node plugin/agy/dispatch.mjs --packet=… --out=…`, which spawns the same server as a stdio subprocess through `plugin/mcp/model-dispatch/src/driverClient.ts` and speaks MCP to it. Same tools, same TaskPacket contract; only who opens the socket differs. Which route ran is a line in the final report.

## Three cost lines

| Line | Source | Kind |
|---|---|---|
| Driver (Gemini on agy) | stream-json `usage` × the policy's `driver.pricing` card. Thinking at the output rate, `cache_read_tokens` at the cached rate | modeled |
| Gemini workers | bridge `telemetry.jsonl` | cash (API key or Vertex) |
| Opus 5 | bridge `telemetry.jsonl`, from the `claude -p` result | cash (Anthropic on arm A, GCP on arm B) |

The modeled line lives in `driver-cost-modeled.jsonl` with `tier: "orchestrator"` and `provenance: "modeled"`, so `buildManifest` partitions it out of dispatched sums if the two files are ever concatenated. Nothing adds modeled and cash dollars into one figure.

## The pin, in one place

The policy's top-level `driver:` block carries `model_name`, `reasoning.effort`, `billing_mode` and the card. `fairnessPin.mjs` reads it, derives the slug, and asserts the argv before anything is spent. It is not a `models[]` entry because preflight builds an adapter for every model.

## Plugin discovery

`.agents/plugins.json` registers `./plugin` from the repo (`json_configs.md`). `run.mjs` launches agy with the repo root as cwd for that reason and adds the project with `--add-dir`. Nothing is written under `~/.gemini/`. If agy does not expand `${VAR}` in a plugin's `mcp_config.json` (check 5), `--inline-env` builds a throwaway workspace under the OS temp dir whose `.agents/plugins/mmo/` is the shipped plugin with the credentials inlined, and removes it after the run.

## Hook mapping from the Claude Code harness

agy has five hook events (`hooks.md`): `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`. No `SessionStart`, no `UserPromptSubmit`.

| Claude Code hook | Purpose there | Here |
|---|---|---|
| `PreToolUse` on `Write\|Edit` | Brownfield write contract | `PreToolUse` on the file-writing step types and `run_command`, `plugin/agy/hooks/write-contract-check.mjs`, reply `{"decision": …}` |
| `PostToolUse` on `mcp__…execute_with_model` | Heartbeat beside the bridge's own telemetry | `PostToolUse` on `mcp_tool`, `plugin/agy/hooks/heartbeat.mjs` |
| `Stop` → auto-ship (governance store) | Ship the run record when the loop ends | `Stop` maps directly; the shipping command is the store's, not this repo's, and is added to `plugin/hooks.json` when the store's hook lands |
| `SessionStart`, `UserPromptSubmit` | Session hydration, prompt-time checks | `PreInvocation` (fires before every model call; use `injectSteps` with an `ephemeralMessage`) |

Hook commands run with cwd = the directory containing `hooks.json` (the plugin dir), so `plugin/hooks.json` names scripts relative to it and no `${CLAUDE_PLUGIN_ROOT}` exists.
