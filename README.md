# OSS Fidelity

**Check open source before you trust it.** Paste a link to a GitHub project, or search for one, and get plain-English grades for **Reliability**, **Maintenance**, and **Security**. Every signal, weight, and source sits one tap away. → [ossfidelity.com](https://ossfidelity.com)

Built for the oSTEM 2026 workshop on open source software and digital autonomy. No accounts, no cookies, no analytics, no third-party requests.

## How it works

| Piece | Where |
|---|---|
| The formula (pure function, no network) | `assets/js/lib/formula.js` |
| Weights, reasons, and sources (single source of truth) | `_data/weights.json` |
| Signal collector for GitHub (a Forgejo/Codeberg collector is parked for later) | `assets/js/lib/forges/` |
| GraphQL queries (the proxy forwards only these) | `assets/js/lib/queries.js` |
| Optional GitHub proxy for live checks (Cloudflare Worker) | `proxy/` |
| Tests | `scripts/test.mjs` (`npm test`) |
| Curated project list and hand-verified facts | `_data/projects.yml` |
| Weekly grades (generated) | `_data/scores.json` |
| AI privacy matrix, open models | `_data/privacy.yml`, `_data/models.yml` |
| Model benchmark questions (CC BY 4.0) and every answer | `bench/tasks.json`, `bench/results/` |

## Automations (GitHub Actions)

| Workflow | When | What it does |
|---|---|---|
| **Deploy site** | every push, and after scoring or benchmark runs | Builds Jekyll for whichever address GitHub serves (github.io or ossfidelity.com) |
| **Weekly scoring** | Mondays, and when the project list, weights, or formula change | Regrades every project in `_data/projects.yml` and refreshes model facts from Hugging Face |
| **Model benchmark** | monthly, and when the questions or model list change | Runs each small model with llama.cpp on a 4-core, 16 GB machine and grades every answer with a script |
| **Project discovery** | monthly | Opens one issue listing candidate projects by category. Nothing is added without a human. |
| **Tests** | every pull request, and pushes that touch code or weights | Runs `npm test`: formula rules, license detection, code review, the proxy, and the GraphQL query against GitHub's schema |

The browser and the weekly GitHub Action share the same JavaScript, so live and cached grades use the same formula. Code review needs a GitHub token, so live checks get it from the proxy, or reuse the weekly result when there is no proxy. The method is written up for everyone at [/method/](https://ossfidelity.com/method/).

## Run it locally

```sh
npm install
npm test                                                           # formula, collectors, proxy
GITHUB_TOKEN=ghp_yourReadOnlyToken node scripts/score.mjs        # regrade everything
node scripts/score.mjs --only github.com/llvm/llvm-project       # just one project
bundle install && bundle exec jekyll serve                         # preview at localhost:4000

# benchmark one model locally (needs Docker)
docker run -d -p 8080:8080 -v "$PWD/models:/models" ghcr.io/ggml-org/llama.cpp:server -m /models/model.gguf --host 0.0.0.0 -c 4096 --reasoning-budget 0
node scripts/bench.mjs --model qwen3-4b --endpoint http://localhost:8080
```

## Publish on GitHub Pages (one-time)

1. In this repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
2. In your account **Settings → Pages**, **add and verify `ossfidelity.com`** before pointing DNS at GitHub. This prevents domain takeover.
3. At your domain registrar, add these records:
   - `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `AAAA` records for `@`: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - `CNAME` record for `www` pointing to `willmitchellcodes.github.io`
   - Don't use wildcard (`*`) records.
4. In the repository's **Settings → Pages → Custom domain**, enter `ossfidelity.com` and save. Tick **Enforce HTTPS** once it becomes available, which can take up to 24 hours.
5. In **Actions**, run **Weekly scoring** once by hand. It grades every project and redeploys the site.

## Raise GitHub's API limits (optional)

| Where | Without setup | With setup |
|---|---|---|
| Weekly scoring job | 1,000 requests/hour (the default Actions token) | 5,000/hour from a GitHub App (`SCORER_APP_CLIENT_ID` variable + `SCORER_APP_PRIVATE_KEY` secret), or a read-only fine-grained token saved as `SCORER_TOKEN` |
| Live checks and search in the browser | 60 requests/hour per network, shared by everyone on the same Wi-Fi | 5,000/hour shared by all visitors, plus caching, through the proxy in `proxy/` |

The same GitHub App serves both. Step-by-step setup is in [`proxy/README.md`](proxy/README.md). Until it's set up, everything keeps working as before. Live checks through the proxy pass through Cloudflare's network; the Worker itself keeps no logs.

## Contribute

- **Suggest a project:** open an issue, or add it to `_data/projects.yml` with its canonical home (not a mirror).
- **Disagree with a weight?** Open an issue with your reasoning and a source. Weight changes are logged on the Method page.

## License

_To be decided._
