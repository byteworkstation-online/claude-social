import { cred, requireCreds } from "./config.js";
import { request, USER_AGENT } from "./http.js";

// Reddit "script" app using the password grant. Tokens last ~1h and are kept in memory only.
let cached: { token: string; expiresAt: number } | undefined;

function userAgent() {
  return `${USER_AGENT} (by /u/${cred("REDDIT_USERNAME") ?? "unknown"})`;
}

export function redditConfigured(): boolean {
  try {
    requireCreds("Reddit", ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"]);
    return true;
  } catch {
    return false;
  }
}

async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const c = requireCreds("Reddit", ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"]);
  const res = await request("https://www.reddit.com/api/v1/access_token", {
    platform: "Reddit",
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${c.REDDIT_CLIENT_ID}:${c.REDDIT_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(),
    },
    body: new URLSearchParams({ grant_type: "password", username: c.REDDIT_USERNAME, password: c.REDDIT_PASSWORD }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) throw new Error(`Reddit login failed: ${json.error ?? "no access_token returned"}`);
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function api(path: string, form: Record<string, string>) {
  const res = await request(`https://oauth.reddit.com${path}`, {
    platform: "Reddit",
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(),
    },
    body: new URLSearchParams({ api_type: "json", ...form }),
  });
  const json = (await res.json()) as { json?: { errors?: [string, string, string][]; data?: any } };
  const errors = json.json?.errors ?? [];
  if (errors.length) throw new Error("Reddit rejected the request: " + errors.map((e) => `${e[0]}: ${e[1]}`).join("; "));
  return json.json?.data;
}

/** Accepts a fullname (t3_abc / t1_xyz), a post URL, or a comment permalink. */
export function parseThing(input: string): string {
  const s = input.trim();
  if (/^t[13]_[a-z0-9]+$/i.test(s)) return s;
  const m = s.match(/\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i);
  if (m) return m[2] ? `t1_${m[2]}` : `t3_${m[1]}`;
  throw new Error(`Could not parse a Reddit post/comment from "${input}". Use a URL or a fullname like t3_abc123.`);
}

export async function redditSubmit(opts: {
  subreddit: string;
  title: string;
  text?: string;
  url?: string;
  flairId?: string;
  nsfw?: boolean;
  spoiler?: boolean;
}) {
  const sr = opts.subreddit.replace(/^\/?r\//i, "");
  const form: Record<string, string> = {
    sr,
    title: opts.title,
    kind: opts.url ? "link" : "self",
    resubmit: "true",
    sendreplies: "true",
  };
  if (opts.url) form.url = opts.url;
  else form.text = opts.text ?? "";
  if (opts.flairId) form.flair_id = opts.flairId;
  if (opts.nsfw) form.nsfw = "true";
  if (opts.spoiler) form.spoiler = "true";
  const data = await api("/api/submit", form);
  return { id: data?.name as string, url: data?.url as string };
}

export async function redditComment(parent: string, text: string) {
  const data = await api("/api/comment", { thing_id: parseThing(parent), text });
  const c = data?.things?.[0]?.data;
  return { id: c?.name as string, url: c?.permalink ? `https://www.reddit.com${c.permalink}` : undefined };
}

export async function redditDelete(thing: string) {
  await api("/api/del", { id: parseThing(thing) });
}
