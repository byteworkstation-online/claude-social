import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CREDENTIALS_FILE, ensureCredentialsTemplate } from "./config.js";
import { linkedinComment, linkedinDelete, linkedinLogin, linkedinLoginResult, linkedinPost, linkedinStatus, redirectUri } from "./linkedin.js";
import { xConfigured, xDelete, xPost, xWhoAmI } from "./x.js";
import { redditComment, redditConfigured, redditDelete, redditSubmit } from "./reddit.js";

const server = new McpServer({ name: "social", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
// Errors go back to Claude as tool errors instead of crashing the server.
const run =
  <A>(fn: (args: A) => Promise<unknown> | unknown) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  };

const PUBLISHES = { destructiveHint: false, openWorldHint: true, readOnlyHint: false };
const DELETES = { destructiveHint: true, openWorldHint: true, readOnlyHint: false };

// ---------- status ----------
server.registerTool(
  "social_status",
  {
    title: "Social accounts status",
    description: "Show which social platforms (LinkedIn, X, Reddit) are configured and logged in. Optionally verifies X credentials live.",
    inputSchema: { verify: z.boolean().optional().describe("Make a live API call to verify X credentials") },
    annotations: { readOnlyHint: true },
  },
  run(async ({ verify }) => {
    const li = linkedinStatus();
    const status: Record<string, unknown> = {
      credentials_file: CREDENTIALS_FILE,
      linkedin: {
        app_configured: li.configured,
        logged_in_as: li.token?.name,
        token_expires: li.token ? new Date(li.token.expires_at).toISOString() : undefined,
        expired: li.expired,
        redirect_uri_to_register: redirectUri(),
        last_login_result: linkedinLoginResult(),
      },
      x: { configured: xConfigured() },
      reddit: { configured: redditConfigured() },
    };
    if (verify && xConfigured()) {
      try {
        status.x = { configured: true, account: await xWhoAmI() };
      } catch (e) {
        status.x = { configured: true, verify_error: (e as Error).message };
      }
    }
    return status;
  }),
);

// ---------- LinkedIn ----------
server.registerTool(
  "linkedin_login",
  {
    title: "Log in to LinkedIn",
    description:
      "Start the LinkedIn OAuth login. Opens the browser and returns the authorization URL (show it to the user in case the browser did not open). " +
      "Login completes in the background; call social_status afterwards to confirm.",
    inputSchema: {},
  },
  run(() => {
    const { url, alreadyPending } = linkedinLogin();
    return `${alreadyPending ? "A login is already in progress." : "Opened the browser for LinkedIn login."}\nIf it did not open, visit:\n${url}\n\nAfter approving, call social_status to confirm.`;
  }),
);

server.registerTool(
  "linkedin_post",
  {
    title: "Publish a LinkedIn post",
    description: "Publish a post to the logged-in member's LinkedIn feed. Only call after the user has approved the exact text.",
    inputSchema: {
      text: z.string().min(1).max(3000).describe("Post text (max 3000 chars). Hashtags inline as #tag."),
      visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC"),
      article_url: z.string().url().optional().describe("Optional link to attach as an article card"),
      article_title: z.string().optional(),
      article_description: z.string().optional(),
    },
    annotations: PUBLISHES,
  },
  run((a) =>
    linkedinPost({
      text: a.text,
      visibility: a.visibility,
      articleUrl: a.article_url,
      articleTitle: a.article_title,
      articleDescription: a.article_description,
    }),
  ),
);

server.registerTool(
  "linkedin_comment",
  {
    title: "Comment on a LinkedIn post",
    description: "Comment on a LinkedIn post as the logged-in member. Only call after the user has approved the exact text.",
    inputSchema: {
      post: z.string().describe("Post URN (urn:li:share:…, urn:li:ugcPost:…, urn:li:activity:…) or a linkedin.com/feed/update/ URL"),
      text: z.string().min(1).max(1250),
    },
    annotations: PUBLISHES,
  },
  run((a) => linkedinComment(a.post, a.text)),
);

server.registerTool(
  "linkedin_delete_post",
  {
    title: "Delete a LinkedIn post",
    description: "Delete one of the member's own LinkedIn posts.",
    inputSchema: { post: z.string().describe("Post URN or /feed/update/ URL") },
    annotations: DELETES,
  },
  run(async (a) => {
    await linkedinDelete(a.post);
    return "Deleted.";
  }),
);

// ---------- X ----------
server.registerTool(
  "x_post",
  {
    title: "Post on X",
    description:
      "Publish a post on X (Twitter). Set reply_to to reply/comment on another post, or quote to quote it. Only call after the user has approved the exact text.",
    inputSchema: {
      text: z.string().min(1).max(25000).describe("Post text. Standard accounts are limited to 280 characters."),
      reply_to: z.string().optional().describe("Post ID or x.com status URL to reply to"),
      quote: z.string().optional().describe("Post ID or x.com status URL to quote"),
    },
    annotations: PUBLISHES,
  },
  run((a) => xPost({ text: a.text, replyTo: a.reply_to, quote: a.quote })),
);

server.registerTool(
  "x_delete_post",
  {
    title: "Delete an X post",
    description: "Delete one of the user's own posts on X.",
    inputSchema: { post: z.string().describe("Post ID or x.com status URL") },
    annotations: DELETES,
  },
  run(async (a) => ((await xDelete(a.post)) ? "Deleted." : "X did not confirm the deletion.")),
);

// ---------- Reddit ----------
server.registerTool(
  "reddit_submit",
  {
    title: "Submit a Reddit post",
    description:
      "Submit a text post (text) or link post (url) to a subreddit. Check the subreddit's rules first: many require flair or forbid self-promotion. Only call after the user has approved the exact title and body.",
    inputSchema: {
      subreddit: z.string().describe("Subreddit name, e.g. 'golang' or 'r/golang'. Use 'u_<username>' for your profile."),
      title: z.string().min(1).max(300),
      text: z.string().max(40000).optional().describe("Markdown body for a text post"),
      url: z.string().url().optional().describe("URL for a link post (mutually exclusive with text)"),
      flair_id: z.string().optional(),
      nsfw: z.boolean().optional(),
      spoiler: z.boolean().optional(),
    },
    annotations: PUBLISHES,
  },
  run((a) => {
    if (a.text && a.url) throw new Error("Provide either text or url, not both.");
    return redditSubmit({ subreddit: a.subreddit, title: a.title, text: a.text, url: a.url, flairId: a.flair_id, nsfw: a.nsfw, spoiler: a.spoiler });
  }),
);

server.registerTool(
  "reddit_comment",
  {
    title: "Comment on Reddit",
    description: "Reply to a Reddit post or comment. Only call after the user has approved the exact text.",
    inputSchema: {
      parent: z.string().describe("Post/comment URL, or fullname (t3_… for posts, t1_… for comments)"),
      text: z.string().min(1).max(10000).describe("Markdown comment body"),
    },
    annotations: PUBLISHES,
  },
  run((a) => redditComment(a.parent, a.text)),
);

server.registerTool(
  "reddit_delete",
  {
    title: "Delete a Reddit post or comment",
    description: "Delete one of the user's own Reddit posts or comments.",
    inputSchema: { thing: z.string().describe("URL or fullname (t3_…/t1_…)") },
    annotations: DELETES,
  },
  run(async (a) => {
    await redditDelete(a.thing);
    return "Deleted.";
  }),
);

ensureCredentialsTemplate();
await server.connect(new StdioServerTransport());
console.error("claude-social MCP server running");
