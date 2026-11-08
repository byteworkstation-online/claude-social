# claude-social

A Claude Code plugin for posting, commenting, replying and deleting on **LinkedIn**, **X** and **Reddit** from a Claude conversation. It uses only the platforms' official APIs and your own developer apps, so no third-party service sees your tokens.

```
> Write a LinkedIn post announcing our new release, and a shorter version for X
  …Claude drafts both and shows them to you…
> Post both
  ✓ https://www.linkedin.com/feed/update/urn:li:share:…/
  ✓ https://x.com/i/status/…
```

The bundled `social-posting` skill makes Claude show you the exact text and get your approval before anything is published. Claude Code also asks for permission on each tool call unless you have allowlisted it.

## Install

Requires [Claude Code](https://claude.com/claude-code) and Node.js 20 or newer on your `PATH`.

```bash
# in Claude Code
/plugin marketplace add byteworkstation-online/claude-social
/plugin install social@claude-social
```

Or from a terminal:

```bash
claude plugin marketplace add byteworkstation-online/claude-social
claude plugin install social@claude-social
```

To update later, run `/plugin marketplace update claude-social`.

Restart Claude Code, then ask "check my social status". On first run the server creates `~/.config/claude-social/credentials.json` (mode 600). Fill in the platforms you want. You can also set any key as an environment variable, which takes precedence over the file.

## Platform setup

### LinkedIn (personal profile)
1. Go to https://www.linkedin.com/developers/apps and create an app. It must be linked to a LinkedIn Company Page; any page you admin will do.
2. On the **Products** tab, add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
3. On the **Auth** tab, add the redirect URL `http://localhost:8765/callback`.
4. Copy the Client ID and Client Secret into `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
5. In Claude, ask it to "log in to LinkedIn". Your browser opens, you approve, and the token is saved to `~/.config/claude-social/tokens.json`. Tokens last 60 days, so log in again when they expire.

Optional settings: `LINKEDIN_REDIRECT_PORT` (default 8765; update the redirect URL to match) and `LINKEDIN_API_VERSION` (`YYYYMM`; defaults to two months ago).

Posting to a **company page** and commenting reliably need LinkedIn's Community Management API, which requires a separate application and approval.

### X (Twitter)
1. Go to https://developer.x.com and create a Project and App. Write access requires a paid tier or pay-per-use credits; check current pricing.
2. Under **User authentication settings**, set app permissions to **Read and write**. Any callback and website URL will do.
3. Under **Keys and tokens**, copy the API Key and Secret, then **generate the Access Token and Secret after** setting Read and write.
4. Fill in `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`.

### Reddit
1. Go to https://www.reddit.com/prefs/apps, click **create another app**, and choose type **script**. The redirect URI can be `http://localhost:8080`.
2. The ID under the app name is `REDDIT_CLIENT_ID`; the secret is `REDDIT_CLIENT_SECRET`.
3. Fill in `REDDIT_USERNAME` and `REDDIT_PASSWORD`. Script apps don't work with 2FA-enabled accounts; use a dedicated account if you need 2FA on your main one.

Reddit has been tightening API access, and new apps may need approval under its Responsible Builder Policy. If app creation is blocked, request access through Reddit's developer support.

## Tools

| Tool | What it does |
|---|---|
| `social_status` | Shows what's configured and logged in (`verify: true` makes a live X call) |
| `linkedin_login` | Browser OAuth login |
| `linkedin_post` | Text post, optionally with an article link card; visibility PUBLIC or CONNECTIONS |
| `linkedin_comment` | Comment on a post (URN or `/feed/update/` URL) |
| `linkedin_delete_post` | Delete your post |
| `x_post` | Post, reply (`reply_to`) or quote (`quote`); takes an ID or URL |
| `x_delete_post` | Delete your post |
| `reddit_submit` | Text or link post to a subreddit, with optional flair, NSFW or spoiler |
| `reddit_comment` | Reply to a post or comment (URL or `t3_`/`t1_` fullname) |
| `reddit_delete` | Delete your post or comment |

## Development

```bash
cd server   # after cloning the repo
npm install
npm run typecheck
npm run build        # bundles to ../dist/server.mjs, which the plugin runs
```

`dist/server.mjs` is committed, so installing the plugin doesn't require `npm install`. Rebuild after changing `server/src`, then run `/reload-plugins` in Claude Code (or restart it).

To test without installing: `claude --plugin-dir /path/to/claude-social`.

## Security notes
- Secrets stay in `~/.config/claude-social/`, outside the plugin folder and git. Don't paste them into the chat.
- Avoid adding `mcp__plugin_social_social__*` to your permission allowlist, so every publish still prompts you.
