export const USER_AGENT = "claude-social/0.1.0";

/** fetch wrapper that turns non-2xx responses into readable errors including the platform's message. */
export async function request(url: string, init: RequestInit & { platform: string }): Promise<Response> {
  const { platform, ...rest } = init;
  const res = await fetch(url, rest);
  if (!res.ok) {
    let body = await res.text();
    if (body.length > 1500) body = body.slice(0, 1500) + "…";
    throw new Error(`${platform} API ${res.status} ${res.statusText}: ${body}`);
  }
  return res;
}
