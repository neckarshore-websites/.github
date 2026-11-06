#!/usr/bin/env bash
# Opens one pull request per website that moves Playwright to <version>.
#
#   toolchain/bump-playwright.sh <version>            # preview: what would change
#   toolchain/bump-playwright.sh <version> --apply    # branch, commit, push, PR
#
# The sites come from "sites" in toolchain.json. Each site is cloned fresh
# into a temporary directory, so no local working copy is touched. Only the
# lockfile is rewritten (npm --package-lock-only), then the same checker CI
# runs proves the result before anything is pushed.
#
# Order of a bump (toolchain/README.md): open this PR set and the PR that
# changes toolchain.json together; merge toolchain.json first. From then on
# every site is red until its bump merges, which is the point.
set -euo pipefail

version="${1:-}"
apply="${2:-}"
prefix="${BUMP_BRANCH_PREFIX:-linus}"
org="neckarshore-websites"
here="$(cd "$(dirname "$0")" && pwd)"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <x.y.z> [--apply]" >&2
  exit 2
fi
if [[ -n "$apply" && "$apply" != "--apply" ]]; then
  echo "unknown option: $apply" >&2
  exit 2
fi

sites=$(node -e 'for (const s of require(process.argv[1]).sites) console.log(s)' "$here/toolchain.json")
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '{ "playwright": "%s" }\n' "$version" > "$work/target.json"
branch="$prefix/playwright-$version"

for site in $sites; do
  echo "== $site"
  dir="$work/$site"
  gh repo clone "$org/$site" "$dir" -- --quiet --depth 1
  if git ls-remote --exit-code --heads "https://github.com/$org/$site.git" "$branch" >/dev/null; then
    echo "   $branch already exists on GitHub, skipped (open its PR by hand if missing)"
    continue
  fi
  if (cd "$dir" && node "$here/check-playwright.mjs" "$work/target.json" >/dev/null); then
    echo "   already on $version, nothing to do"
    continue
  fi
  (cd "$dir" && npm install --package-lock-only --save-dev --save-exact --ignore-scripts --no-audit --no-fund "@playwright/test@$version" >/dev/null)
  (cd "$dir" && node "$here/check-playwright.mjs" "$work/target.json")
  (cd "$dir" && git --no-pager diff --stat)
  if [[ "$apply" != "--apply" ]]; then
    echo "   preview only; rerun with --apply to push $branch and open the PR"
    continue
  fi
  (
    cd "$dir"
    git switch -q -c "$branch"
    git add package.json package-lock.json
    git commit -q -m "chore(test): Playwright $version, the estate number

Moves @playwright/test, playwright and playwright-core to $version as set in
neckarshore-websites/.github toolchain/toolchain.json, so every website uses
one browser build. Opened by toolchain/bump-playwright.sh."
    git push -q -u origin "$branch"
    gh pr create --repo "$org/$site" --base main --head "$branch" --title "chore(test): Playwright $version, the estate number" --body "Moves Playwright to **$version**, the number in [toolchain.json](https://github.com/$org/.github/blob/main/toolchain/toolchain.json). Lockfile only; the full e2e suite of this site runs on this PR.

Opened by \`toolchain/bump-playwright.sh\`."
  )
done
