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
