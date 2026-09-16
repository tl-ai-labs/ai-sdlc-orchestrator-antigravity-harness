/**
 * Fairness-pin assertion for the agy driver.
 *
 * The pin lives in exactly one place: the policy's top-level `driver:` block
 * (docs/verification/p1-agy-runtime.md, findings 2 and 6). It is read from
 * there and never duplicated as constants here.
 *
 * agy bakes the effort into the model slug (`gemini-3.8-flash-high`, check
 * 14), so the launcher derives one slug from `model_name` + `reasoning.effort`
 * and passes no separate `--effort`.
 */

export const EFFORTS = new Set(["low", "medium", "high"]);
export const BILLING_MODES = new Set(["seat", "gemini-api-key"]);

/**
 * Live checks the pin depends on (p1-agy-runtime.md, "Pins chosen"). While
 * any is pending, run.mjs refuses a paid run unless told to record the pin as
 * unverified. Flip an entry to "pass" only with the check's result written
 * into the doc in the same commit.
 */
export const LIVE_PIN_CHECKS = {
  1: "pending", // bridge tools callable from an agy session (pattern a) + tool prefix
  2: "pending", // bridge subprocess survives without --sandbox
  4: "pending", // --print reaches the prompt / imported skill
  5: "pending", // ${VAR} interpolation in mcp_config.json
  6: "pending", // --dangerously-skip-permissions makes a headless run possible
};

export function pendingPinChecks(checks = LIVE_PIN_CHECKS) {
  return Object.entries(checks)
    .filter(([, state]) => state !== "pass")
    .map(([n]) => Number(n));
}

export function readPin(policy) {
  const d = policy?.driver;
  if (!d) {
    throw new Error(`fairness pin: policy '${policy?.name}' has no top-level driver: block to read the pin from.`);
  }
  if (d.runtime !== "agy") {
    throw new Error(`fairness pin: policy '${policy.name}' driver.runtime is '${d.runtime}', not 'agy'.`);
  }
  const model = d.model_name;
  const effort = d.reasoning?.effort;
  if (!model || !effort) {
    throw new Error(`fairness pin: policy '${policy.name}' driver block is missing model_name or reasoning.effort.`);
  }
  if (!EFFORTS.has(effort)) {
    throw new Error(`fairness pin: driver.reasoning.effort '${effort}' is not one of ${[...EFFORTS].join(", ")} (agy --effort).`);
  }
  const billing = d.billing_mode ?? "seat";
  if (!BILLING_MODES.has(billing)) {
    throw new Error(`fairness pin: driver.billing_mode '${billing}' is not one of ${[...BILLING_MODES].join(", ")}.`);
  }
  for (const k of ["input", "input_cached", "output"]) {
    if (typeof d.pricing?.[k] !== "number") {
      throw new Error(`fairness pin: driver.pricing.${k} is missing — the modeled driver line cannot be priced.`);
    }
  }
  return { model, effort, billing_mode: billing, pricing: d.pricing };
}

/** `gemini-3.8-flash` + `high` → `gemini-3.8-flash-high` (check 14). */
export function driverSlug(pin) {
  return `${pin.model}-${pin.effort}`;
}

export function assertPinnedInvocation(intended, policy) {
  const pin = readPin(policy);
  const slug = driverSlug(pin);
  if (intended.model !== slug) {
    throw new Error(
      `fairness pin violated: about to invoke --model '${intended.model}', but the pinned slug is ` +
        `'${slug}' (plugin/config/policies/${policy.name}.yaml driver block). Aborting rather than ` +
        `running an unpinned, uncomparable pass.`,
    );
  }
  return pin;
}

/**
 * The `result` event is the only place agy reports an error for the whole
 * turn; a rejected model slug lands in `result.error`. Nothing in the
 * stream echoes back which model answered, so this can prove a failure,
 * never a success.
 */
export function findPinRejection(events) {
  for (const ev of events) {
    if (ev.event !== "result") continue;
    const message = ev.result?.error ?? (ev.result?.status === "ERROR" ? ev.result?.response : undefined);
    if (typeof message !== "string" || !message) continue;
    if (/model|effort|not (found|available|supported)|unknown|invalid/i.test(message) && /model|effort/i.test(message)) {
      return message;
    }
  }
  return null;
}
