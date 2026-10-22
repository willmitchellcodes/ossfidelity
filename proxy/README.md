# GitHub proxy

Without an account, GitHub lets each network make about 60 API requests an hour. A live check takes 15–30, so a room on shared Wi-Fi runs out after a few checks. This Cloudflare Worker answers the same read-only requests with a GitHub App's token (5,000 an hour) and caches the answers, so repeat checks cost nothing. It also lets live checks run the code-review query, which needs a token.

The site works without it: if `github_proxy` in `_config.yml` is blank, or the proxy can't be reached, pages go straight to GitHub as before.

## What it forwards, and what it doesn't

| Forwards | Refuses |
|---|---|
| `GET /repos/{owner}/{repo}` and its `contents`, `stats`, `commits`, `releases`, `tags`, `readme`, `license`, `community` endpoints | Everything else, including downloads (`tarball`, `zipball`), user and organization endpoints, and any write |
| `GET /search/issues` when the query names one `repo:` | Searches without a `repo:` |
| `GET /search/repositories` (the search box) | |
| `POST /graphql`, only for the queries in `assets/js/lib/queries.js`, word for word | Any other GraphQL query |

It answers only pages listed in `ALLOWED_ORIGINS`, limits each visitor's address to 600 requests a minute and 20 uncached searches a minute, writes no logs, and sets no cookies. Visitors' requests do pass through Cloudflare's network, so mention that wherever the site describes its privacy.

The origin check stops other websites, not scripts, so the per-visitor limits are what protect the App's budget (5,000 requests an hour, and 30 searches a minute). Turn on the `RATE_LIMITER` binding in `wrangler.toml`: it holds across Worker instances, which the built-in counter doesn't. If the budget runs out anyway, pages notice and go straight to GitHub, which is how the site works today.

## Set it up (about 15 minutes)

### 1. Create the GitHub App

1. On GitHub, click your **profile picture** (top right) → **Settings**. This is your account's settings, not the repository's Settings tab. Then, at the bottom of the left sidebar, **Developer settings → GitHub Apps → New GitHub App**.
2. Name it (for example `ossfidelity-reader`), and set the homepage to `https://ossfidelity.com`.
3. Untick **Webhook → Active**. No callback URL is needed.
4. **Permissions:** leave everything at *No access*. GitHub adds *Metadata: read-only* automatically, which is all the proxy needs, since it only reads public data.
5. **Where can this GitHub App be installed?** *Only on this account.* Create it.
6. On the App's settings page, note the **Client ID** (under *About*), then scroll to **Private keys → Generate a private key**. A `.pem` file downloads. Keep it out of the repository.
7. In the App's left sidebar, **Install App** → **Install** next to your account. If GitHub asks which repositories, choose **Only select repositories** → `ossfidelity`; with no repository permissions it may not ask. GitHub says an App always has read-only access to public repositories, which is all the proxy uses.

### 2. Check that the token can read other public repositories

GitHub's docs don't promise this, so test it once from the repository root (Node 20 or later):

```sh
node proxy/check-token.mjs <Client ID> /path/to/key.pem
```

Expect "Reads a public repository it isn't installed on: yes" and "Requests per hour: 5000". If it says NO, use a read-only fine-grained personal token for the weekly job instead (`SCORER_TOKEN`, see the main README) and skip the proxy for now.

### 3. Use the App in the weekly scoring job

In the repository's **Settings → Secrets and variables → Actions**:

- **Variables** tab: `SCORER_APP_CLIENT_ID` = the Client ID.
- **Secrets** tab: `SCORER_APP_PRIVATE_KEY` = the whole contents of the `.pem` file.

The next **Weekly scoring** run uses the App's token. Until both are set, it keeps using `SCORER_TOKEN` or the default token.

### 4. Deploy the Worker

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. In `proxy/wrangler.toml`, set `GITHUB_APP_CLIENT_ID`, and check `ALLOWED_ORIGINS`.
3. From the `proxy` folder:

   ```sh
   npx wrangler@4 login
   npx wrangler@4 secret put GITHUB_APP_PRIVATE_KEY < /path/to/key.pem
   npx wrangler@4 deploy
   ```

   Paste the key file as downloaded; the Worker converts its format itself. Deploy prints the address, like `https://ossfidelity-github-proxy.<you>.workers.dev`.
4. Try it: `curl -H "Origin: https://ossfidelity.com" https://<that address>/repos/llvm/llvm-project | head -c 200`.
5. Put the address in `_config.yml` as `github_proxy` (no trailing slash) and push.

Optional: give the Worker a custom domain such as `api.ossfidelity.com` (the domain's DNS must be on Cloudflare). Cloudflare's shared cache only works on custom domains; on a `workers.dev` address each Worker instance keeps its own smaller cache.

## Cost

Cloudflare's free plan includes 100,000 requests a day and 10 ms of CPU time per request. A live check is 15–30 requests, and cached answers don't reach GitHub at all.

## Tests

`npm test` from the repository root covers the allowlist, origin check, GraphQL filter, and key conversion (JWT signed with a freshly generated key and verified).
