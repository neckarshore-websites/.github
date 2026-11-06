# toolchain — one Playwright version for every website

Every website in this organisation pins Playwright exactly. Without a shared number the pins drifted: on 2026-11-06 ten sites used five versions (1.59.1 to 1.64.1), none the current one. Each version needs its own browser build, so working across sites meant downloading browsers again and again, and 1.59.1's browser did not install at all on a current Mac (the unzip hung twice). This folder holds the number and the means to keep every site on it.

## The three parts

| # | Part | File | What it does |
|---|------|------|--------------|
| 1 | The number | `toolchain.json` | `playwright` is the estate version; `sites` lists the websites that follow it. |
| 2 | The check | `check-playwright.mjs`, `../.github/workflows/toolchain-check.yml` | Each site runs it on every pull request, every push to `main` and once a week. It reads `package.json` and every Playwright entry in `package-lock.json` (what CI actually installs) and fails when one differs from the number. |
| 3 | The bump | `bump-playwright.sh` | Opens one pull request per site that moves it to a new number. Preview by default; `--apply` pushes. |

## A site joins

Add `.github/workflows/toolchain.yml` to the site:

```yaml
name: Toolchain
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "23 5 * * 1"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  toolchain:
    uses: neckarshore-websites/.github/.github/workflows/toolchain-check.yml@main
```

Then add the site to `sites` (A to Z). A site with Dependabot gets `ignore` entries for `@playwright/test`, `playwright` and `playwright-core`, so the bot cannot move one site alone.

## A bump

1. Run `toolchain/bump-playwright.sh <x.y.z>` and read the preview.
2. Open the pull request that changes `playwright` in `toolchain.json`, then run the script again with `--apply`.
3. Merge `toolchain.json` first. From then on every site is red until its own bump merges; that is the signal, not a fault.
4. Merge the site pull requests once each site's own e2e suite is green.

## Limits

- **Red is visible, not blocking,** until the check is a required status check on a site's `main`. That is a repository setting.
- **Not covered yet:** `logibright-website` (not on the website persona's write list on 2026-11-06) and `pet-foster-finder` (parked by the Founder on 2026-11-03).
- The check holds the version only. Whether a site's tests pass on it is the site's own e2e suite.
