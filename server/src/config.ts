import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// All secrets live outside the plugin directory so plugin updates never touch them.
export const CONFIG_DIR = process.env.CLAUDE_SOCIAL_CONFIG_DIR ?? join(homedir(), ".config", "claude-social");
export const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const TOKENS_FILE = join(CONFIG_DIR, "tokens.json");

export const CREDENTIAL_KEYS = [
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_REDIRECT_PORT",
  "LINKEDIN_API_VERSION",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_USERNAME",
  "REDDIT_PASSWORD",
] as const;
export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writePrivateJson(path: string, data: unknown) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Environment variables win over the credentials file. Re-read on every call so edits apply without a restart. */
export function cred(key: CredentialKey): string | undefined {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const file = readJson<Partial<Record<CredentialKey, string>>>(CREDENTIALS_FILE);
  return file?.[key] || undefined;
}

export function requireCreds<K extends CredentialKey>(platform: string, keys: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  const missing: string[] = [];
  for (const k of keys) {
    const v = cred(k);
    if (v) out[k] = v;
    else missing.push(k);
  }
  if (missing.length) {
    throw new Error(
      `${platform} is not configured. Missing: ${missing.join(", ")}. ` +
        `Add them to ${CREDENTIALS_FILE} (or set them as environment variables), then retry.`,
    );
  }
  return out;
}

export function ensureCredentialsTemplate() {
  if (existsSync(CREDENTIALS_FILE)) return;
  const template = Object.fromEntries(
    CREDENTIAL_KEYS.filter((k) => k !== "LINKEDIN_REDIRECT_PORT" && k !== "LINKEDIN_API_VERSION").map((k) => [k, ""]),
  );
  writePrivateJson(CREDENTIALS_FILE, template);
}

export interface LinkedInToken {
  access_token: string;
  expires_at: number; // epoch ms
  person_urn: string;
  name?: string;
}

interface TokenStore {
  linkedin?: LinkedInToken;
}

export function loadTokens(): TokenStore {
  return readJson<TokenStore>(TOKENS_FILE) ?? {};
}

export function saveTokens(update: Partial<TokenStore>) {
  writePrivateJson(TOKENS_FILE, { ...loadTokens(), ...update });
}
