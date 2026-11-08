---
name: social-posting
description: Use when the user wants to write, post, publish, share, reply to, comment on, or delete something on LinkedIn, X (Twitter) or Reddit, or asks to set up or check their social media connection. Covers drafting platform-appropriate copy and the approval step before anything is published.
---

# Posting to social media

The `social` MCP server provides these tools:

| Platform | Tools |
|---|---|
| All | `social_status` |
| LinkedIn | `linkedin_login`, `linkedin_post`, `linkedin_comment`, `linkedin_delete_post` |
| X | `x_post` (use `reply_to` to reply or comment, `quote` to quote), `x_delete_post` |
| Reddit | `reddit_submit`, `reddit_comment`, `reddit_delete` |

## Rule: always get approval before publishing

Anything posted goes out publicly under the user's name. Before calling any posting or commenting tool:

1. Write the draft and show it to the user **exactly** as it will be sent: platform, target (subreddit, or the post being replied to), title, body, and the character count where a limit applies.
2. Wait for explicit approval ("post it", "yes", "looks good"). If the user asks for edits, show the revised draft again.
3. Publish exactly the approved text. Don't make silent "small fixes" after approval.
4. Report back the returned URL.

If the user asks for the same content on several platforms, show one draft per platform and get approval for each one. Never batch-publish unapproved variants.

Delete only when the user clearly asks for it and names the target post.

## Platform guidance

- **LinkedIn**: max 3000 chars. Only the first ~210 chars show before "…see more", so put the hook first. Use short paragraphs and 3–5 hashtags at the end. Use `article_url` and `article_title` for a link-preview card. Commenting may need extra API permissions. If it fails with 403, say so plainly.
- **X**: 280 chars on standard accounts. Count carefully: URLs count as 23. For threads, post the first item, then `reply_to` the returned ID for each following item, and get the whole thread approved up front.
- **Reddit**: every subreddit has its own rules, and many forbid self-promotion or require flair. Before submitting, remind the user to check the rules, and ask for a `flair_id` if the subreddit requires one. Write in a native, non-marketing tone. Use `text` for a self post or `url` for a link post, never both.

## Setup and troubleshooting

Start with `social_status`. It shows which platforms are configured, the credentials file path, and the LinkedIn redirect URI.

- Missing credentials: the user fills in `~/.config/claude-social/credentials.json`. Point them to the plugin README for where each key comes from. Never ask the user to paste secrets into the chat.
- LinkedIn not logged in or expired (tokens last 60 days): call `linkedin_login`, show the URL it returns, then call `social_status` once they have approved it in the browser.
- X 401/403: the app usually lacks **Read and write** permission, or its access token was generated before that permission was enabled. Regenerating the access token fixes it.
- Reddit `invalid_grant`: wrong password, or the account has 2FA enabled (script apps don't support 2FA).
