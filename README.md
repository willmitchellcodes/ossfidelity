# OSS Fidelity

**Check open source before you trust it.** Paste a link to a GitHub project, or search for one, and get plain-English grades for **Reliability**, **Maintenance**, and **Security**. Every signal, weight, and source sits one tap away. → [ossfidelity.com](https://ossfidelity.com)

Built for the oSTEM 2026 workshop on open source software and digital autonomy. No accounts, no cookies, no analytics, no third-party requests.

## How it works

| Piece | Where |
|---|---|
| The formula (pure function, no network) | `assets/js/lib/formula.js` |
| Weights, reasons, and sources (single source of truth) | `_data/weights.json` |
| Signal collector for GitHub (a Forgejo/Codeberg collector is parked for later) | `assets/js/lib/forges/` |
| Curated project list and hand-verified facts | `_data/projects.yml` |
| Weekly grades (generated) | `_data/scores.json` |
| Host checks, AI privacy matrix, open models | `_data/hosts.yml`, `_data/privacy.yml`, `_data/models.yml` |

The browser and the weekly GitHub Action share the same JavaScript, so live and cached grades always agree. The method is written up for everyone at [/method/](https://ossfidelity.com/method/).

## Run it locally

```sh
npm install
GITHUB_TOKEN=ghp_yourReadOnlyToken node scripts/score.mjs        # regrade everything
node scripts/score.mjs --only github.com/llvm/llvm-project       # just one project
bundle install && bundle exec jekyll serve                         # preview at localhost:4000
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

Optional: save a read-only fine-grained token as the repository secret `SCORER_TOKEN` to raise the API limit from 1,000 to 5,000 requests per hour.

## Contribute

- **Suggest a project:** open an issue, or add it to `_data/projects.yml` with its canonical home (not a mirror).
- **Disagree with a weight?** Open an issue with your reasoning and a source. Weight changes are logged on the Method page.

## License

_To be decided._
