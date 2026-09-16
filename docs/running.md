# Running the harness

Two shapes. Interactive is how you build and debug the plugin; headless is how a measured run is recorded.

## Interactive

Open `agy` in the repo root. `.agents/plugins.json` registers `plugin/` as the `mmo` plugin; `/plugins` lists it, `/mcp` shows `model-dispatch`, `/skills` lists the entry points. Invoke a skill, answer the gates by hand. Credentials come from the shell that launched `agy` (see [SETUP.md](../SETUP.md)).

## Headless

```bash
node plugin/agy/run.mjs \
  --brief=examples/quick-demo/brief.md \
  --project-root=/path/to/empty/dir \
  --output-dir=/path/to/empty/dir/.sdlc \
  --policy=antigravity-flash38-plus-haiku45 \
  --gates=auto-approve \
  --run-id=quick-demo-1 \
  --dry-run
```

`--dry-run` prints the invocation with the prompt truncated and every credential reported only as set/unset. Drop it to run.

| Flag | Default | Meaning |
|---|---|---|
| `--brief` | `<project-root>/brief.md` | The brief the conductor reads |
| `--project-root` | cwd | The application's repo; added to the agy workspace with `--add-dir` |
| `--output-dir` | `<project-root>/.sdlc` | The run record. Added to the workspace when it is outside the project |
| `--code-dir` | `<project-root>/src` | Where the application is written |
| `--policy` | `antigravity-flash38-plus-opus5` | Policy name under `plugin/config/policies/` |
| `--run-id` | timestamp | `pass_id` on every telemetry event |
| `--gates` | `prompt` | `prompt` waits for you; `auto-approve` records `auto-approved` and continues; `auto-abort` stops at the first gate |
| `--mode`, `--intent`, `--seed` | — | The brownfield handover the guide's step 4 reads |
| `--resume=<conversation-id>` | — | Continue an earlier session instead of starting one |
| `--max-turns` | 12 | Cap on agy invocations per run |
| `--print-timeout` | `6h` | agy's own print-mode timeout; the default is 5 minutes |
| `--agy-bin` | `agy` | Path to the binary when it is not on PATH |
| `--inline-env` | off | Check-5 fallback: build a per-run root under the OS temp dir with credentials inlined into `mcp_config.json` |
| `--keep-run-root` | off | Keep that root after the run, for inspection |
| `--allow-unverified-pin` | off | Run while the pin's live checks are pending; stamps `pin.verified: false` in the manifest |

### What the invocation pins

| argv | Why | Check |
|---|---|---|
| `--model gemini-3.8-flash-high` | The driver pin, slug derived from the policy's `driver:` block | 14 |
| `--dangerously-skip-permissions` | Print mode soft-denies every tool that would prompt | 6 |
| no `--sandbox` | The bridge is a piped subprocess | 2 |
| `--print-timeout 6h` | A pass runs hours | — |
| cwd = repo root | `.agents/plugins.json` is what discovers the plugin | 10 |
| `--add-dir <project>` | Mandatory; the workspace is otherwise the harness repo | — |

### The pin gate

`docs/verification/p1-agy-runtime.md` says nothing may be pinned on a pending check. `plugin/agy/telemetry/fairnessPin.mjs` lists the checks the pin depends on (1, 2, 4, 5, 6) with their state; while any is pending, `run.mjs` refuses to spawn `agy` unless you pass `--allow-unverified-pin`, and then writes `pin.verified: false` into `driver-manifest.json`. Flip a check to `pass` only in the same commit that records its result in the doc.

### The resume loop

One `agy --print` invocation may end before the pipeline does. `run.mjs` reads the `conversation_id` from the stream, and while `SUMMARY.md` is absent and agy exited 0, re-invokes with `--conversation <id>` and a short resume prompt, up to `--max-turns`. The stream of every invocation is concatenated, and the event reader differences the cumulative `usage` counters so each turn is priced once.

## The run directory

| File | Written by | What |
|---|---|---|
| `policy_snapshot.yaml` | `run.mjs` at launch | The policy as it was when the run started |
| `skills/pipeline.md`, `skills/brownfield-guide.md` | `run.mjs` at launch | The playbook with real paths rendered in |
| `preflight.json` | the conductor, from `preflight_dispatch` | Rule 0's verdict |
| `telemetry.jsonl` | the bridge | Every dispatched call, vendor-metered |
| `gates.jsonl` | the conductor | One line per gate with the decision mode |
| `driver-events.jsonl` | `run.mjs` | The raw stream-json, every invocation |
| `driver-stderr.log` | `run.mjs` | agy's stderr, where soft-denials and hook notices land |
| `driver-cost-modeled.jsonl` | `run.mjs` | One `provenance: "modeled"` event per turn at the driver card |
| `driver-manifest.json` | `run.mjs` | The pin, exit status, invocations, completion, modeled driver cost |
| `manifest.json` | `plugin/agy/manifest.mjs` | The code-written run record the console and the store ingest |
| `SUMMARY.md` | the conductor | The completion signal |

`node tools/report.mjs <dir>` prints the cost report, keeping the modeled driver line apart from the cash lines.
