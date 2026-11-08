import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { cred, loadTokens, requireCreds, saveTokens, type LinkedInToken } from "./config.js";
import { request } from "./http.js";

// LinkedIn "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" products.
// Member tokens last 60 days; refresh tokens are only issued to approved partners, so we re-login on expiry.
const SCOPES = "openid profile w_member_social";

function port() {
  return Number(cred("LINKEDIN_REDIRECT_PORT") ?? 8765);
}
export function redirectUri() {
  return `http://localhost:${port()}/callback`;
}

/** LinkedIn versions are YYYYMM and each is supported ~1 year; default to two months ago. */
function apiVersion() {
  const v = cred("LINKEDIN_API_VERSION");
  if (v) return v;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 2);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function linkedinStatus(): { configured: boolean; token?: LinkedInToken; expired?: boolean } {
  let configured = true;
  try {
    requireCreds("LinkedIn", ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]);
  } catch {
    configured = false;
  }
  const token = loadTokens().linkedin;
  return { configured, token, expired: token ? token.expires_at < Date.now() : undefined };
}

function currentToken(): LinkedInToken {
  const t = loadTokens().linkedin;
  if (!t) throw new Error("LinkedIn is not logged in. Call the linkedin_login tool first.");
  if (t.expires_at < Date.now()) throw new Error("LinkedIn token expired. Call the linkedin_login tool to log in again.");
  return t;
}

let pending: { server: Server; url: string; result?: string } | undefined;

/** Starts a localhost callback server and returns the authorization URL. Completes in the background. */
export function linkedinLogin(): { url: string; alreadyPending: boolean } {
  if (pending && pending.result === undefined) return { url: pending.url, alreadyPending: true };
  const c = requireCreds("LinkedIn", ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]);
  const state = randomBytes(16).toString("hex");
  const url =
    "https://www.linkedin.com/oauth/v2/authorization?" +
    new URLSearchParams({
      response_type: "code",
      client_id: c.LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri(),
      state,
      scope: SCOPES,
    });

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", redirectUri());
    if (u.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const finish = (msg: string, ok: boolean) => {
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<html><body style="font-family:sans-serif;padding:2em"><h2>${msg}</h2><p>You can close this tab and return to Claude.</p></body></html>`);
      if (pending) pending.result = msg;
      server.close();
    };
    try {
      if (u.searchParams.get("state") !== state) return finish("LinkedIn login failed: state mismatch.", false);
      const err = u.searchParams.get("error");
      if (err) return finish(`LinkedIn login failed: ${err} ${u.searchParams.get("error_description") ?? ""}`, false);
      const code = u.searchParams.get("code");
      if (!code) return finish("LinkedIn login failed: no code returned.", false);

      const tokRes = await request("https://www.linkedin.com/oauth/v2/accessToken", {
        platform: "LinkedIn",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri(),
          client_id: c.LINKEDIN_CLIENT_ID,
          client_secret: c.LINKEDIN_CLIENT_SECRET,
        }),
      });
      const tok = (await tokRes.json()) as { access_token: string; expires_in: number };
      const meRes = await request("https://api.linkedin.com/v2/userinfo", {
        platform: "LinkedIn",
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const me = (await meRes.json()) as { sub: string; name?: string };
      saveTokens({
        linkedin: {
          access_token: tok.access_token,
          expires_at: Date.now() + tok.expires_in * 1000,
          person_urn: `urn:li:person:${me.sub}`,
          name: me.name,
        },
      });
      finish(`Logged in to LinkedIn as ${me.name ?? me.sub}.`, true);
    } catch (e) {
      finish(`LinkedIn login failed: ${(e as Error).message}`, false);
    }
  });
  server.on("error", (e) => {
    if (pending) pending.result = `LinkedIn login server error: ${e.message}`;
  });
  server.listen(port(), "127.0.0.1");
  setTimeout(() => server.close(), 10 * 60_000).unref();
  pending = { server, url };

  // Best effort; the URL is also returned so the user can open it manually.
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  return { url, alreadyPending: false };
}

export function linkedinLoginResult(): string | undefined {
  return pending?.result;
}

function headers(t: LinkedInToken) {
  return {
    Authorization: `Bearer ${t.access_token}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": apiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/** Accepts a urn:li:share/ugcPost/activity URN or a linkedin.com/feed/update/... URL. */
export function parsePostUrn(input: string): string {
  const m = input.match(/urn:li:(share|ugcPost|activity):\d+/);
  if (m) return m[0];
  throw new Error(`Could not find a LinkedIn post URN in "${input}". Expected something like urn:li:share:123 or a /feed/update/ URL.`);
}

export async function linkedinPost(opts: {
  text: string;
  visibility: "PUBLIC" | "CONNECTIONS";
  articleUrl?: string;
  articleTitle?: string;
  articleDescription?: string;
}) {
  const t = currentToken();
  const body: Record<string, unknown> = {
    author: t.person_urn,
    commentary: opts.text,
    visibility: opts.visibility,
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (opts.articleUrl) {
    body.content = {
      article: {
        source: opts.articleUrl,
        title: opts.articleTitle ?? opts.articleUrl,
        ...(opts.articleDescription ? { description: opts.articleDescription } : {}),
      },
    };
  }
  const res = await request("https://api.linkedin.com/rest/posts", {
    platform: "LinkedIn",
    method: "POST",
    headers: headers(t),
    body: JSON.stringify(body),
  });
  const urn = res.headers.get("x-restli-id") ?? "";
  return { urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined };
}

export async function linkedinComment(post: string, text: string) {
  const t = currentToken();
  const urn = parsePostUrn(post);
  const res = await request(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(urn)}/comments`, {
    platform: "LinkedIn",
    method: "POST",
    headers: headers(t),
    body: JSON.stringify({ actor: t.person_urn, object: urn, message: { text } }),
  });
  return { id: res.headers.get("x-restli-id") ?? undefined, url: `https://www.linkedin.com/feed/update/${urn}/` };
}

export async function linkedinDelete(post: string) {
  const t = currentToken();
  await request(`https://api.linkedin.com/rest/posts/${encodeURIComponent(parsePostUrn(post))}`, {
    platform: "LinkedIn",
    method: "DELETE",
    headers: headers(t),
  });
}
