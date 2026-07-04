// The build/test gates execute REPO-CONTROLLED code (package.json scripts,
// TEST_CMD targets) as this host process — a malicious or poisoned work product
// would otherwise inherit every secret in our environment (ANTHROPIC_API_KEY,
// tokens from .env, …). Passing an allowlisted env strips those. This is a
// mitigation, not a sandbox: the child still has our filesystem and network;
// a real boundary needs a container (tracked separately).
const KEEP = [
  "PATH",
  "HOME", // npm/npx need it for their cache
  "SHELL",
  "TMPDIR",
  "TERM",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_ENV",
];

export function gateEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of KEEP) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

// The agent CLIs (claude/codex/grok) run MODEL-CONTROLLED work — a prompt-injected
// research session or poisoned repo can make them print their environment. Unlike
// the gates they need most of our env (HOME for their auth files, PATH, locale…),
// so instead of an allowlist we strip only OUR secrets: nothing an agent does
// should ever see the orchestrator token, dashboard password, or DB URL.
const STRIP = [
  "ORCH_TOKEN",
  "DASHBOARD_PASSWORD",
  "DASHBOARD_USERNAME",
  "DATABASE_URL",
];

export function agentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIP.includes(key)) env[key] = value;
  }
  return env;
}
