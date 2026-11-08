import { createHmac, randomBytes } from "node:crypto";
import { requireCreds } from "./config.js";
import { request } from "./http.js";

// X API v2 with OAuth 1.0a user context. The four keys come straight from the
// developer portal ("Keys and tokens"), so no browser login flow is needed.
const API = "https://api.x.com/2";

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(method: string, url: string): string {
  const c = requireCreds("X", ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.X_API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: c.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  // JSON bodies are not part of the signature; we never send query params.
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${enc(k)}=${enc(oauth[k])}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const key = `${enc(c.X_API_SECRET)}&${enc(c.X_ACCESS_TOKEN_SECRET)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
}

export function xConfigured(): boolean {
  try {
    requireCreds("X", ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]);
    return true;
  } catch {
    return false;
  }
}

/** Accepts a numeric ID or an x.com / twitter.com status URL. */
export function parseTweetId(input: string): string {
  const m = input.match(/status(?:es)?\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  throw new Error(`Could not find a post ID in "${input}"`);
}

export async function xPost(opts: { text: string; replyTo?: string; quote?: string }) {
  const url = `${API}/tweets`;
  const body: Record<string, unknown> = { text: opts.text };
  if (opts.replyTo) body.reply = { in_reply_to_tweet_id: parseTweetId(opts.replyTo) };
  if (opts.quote) body.quote_tweet_id = parseTweetId(opts.quote);
  const res = await request(url, {
    platform: "X",
    method: "POST",
    headers: { Authorization: authHeader("POST", url), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data: { id: string; text: string } };
  return { id: json.data.id, url: `https://x.com/i/status/${json.data.id}` };
}

export async function xDelete(idOrUrl: string) {
  const url = `${API}/tweets/${parseTweetId(idOrUrl)}`;
  const res = await request(url, { platform: "X", method: "DELETE", headers: { Authorization: authHeader("DELETE", url) } });
  const json = (await res.json()) as { data: { deleted: boolean } };
  return json.data.deleted;
}

export async function xWhoAmI() {
  const url = `${API}/users/me`;
  const res = await request(url, { platform: "X", headers: { Authorization: authHeader("GET", url) } });
  const json = (await res.json()) as { data: { username: string; name: string } };
  return json.data;
}
