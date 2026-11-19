// Tests for check-playwright.mjs. Run: node --test toolchain/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkPlaywright, checkSystemDeps } from "./check-playwright.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-playwright.mjs");

const pkg = (v) => ({ devDependencies: { "@playwright/test": v } });
const lock = (test, pw = test, core = test, extra = {}) => ({
  lockfileVersion: 3,
  packages: {
    "": {},
    "node_modules/@playwright/test": { version: test },
    "node_modules/playwright": { version: pw },
    "node_modules/playwright-core": { version: core },
    ...extra,
  },
});

test("all three packages on the estate number pass", () => {
  const r = checkPlaywright({ expected: "1.64.1", packageJson: pkg("1.64.1"), packageLock: lock("1.64.1") });
  assert.equal(r.ok, true);
  assert.equal(r.seen.length, 3);
});

test("an old lockfile fails even when package.json is right", () => {
  const r = checkPlaywright({ expected: "1.64.1", packageJson: pkg("1.64.1"), packageLock: lock("1.59.1") });
  assert.equal(r.ok, false);
  assert.equal(r.problems.filter((p) => p.file === "package-lock.json").length, 3);
});

test("playwright-core alone off the number fails", () => {
  const r = checkPlaywright({ expected: "1.64.1", packageJson: pkg("1.64.1"), packageLock: lock("1.64.1", "1.64.1", "1.63.0") });
  assert.equal(r.ok, false);
  assert.match(r.problems[0].message, /playwright-core resolves to 1\.63\.0/);
});

test("a nested second copy off the number fails", () => {
  const extra = { "node_modules/some-tool/node_modules/playwright-core": { version: "1.50.0" } };
  const r = checkPlaywright({ expected: "1.64.1", packageJson: pkg("1.64.1"), packageLock: lock("1.64.1", "1.64.1", "1.64.1", extra) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0].message, /some-tool\/node_modules\/playwright-core/);
});

test("a range in package.json fails", () => {
  const r = checkPlaywright({ expected: "1.64.1", packageJson: pkg("^1.64.1"), packageLock: lock("1.64.1") });
  assert.equal(r.ok, false);
  assert.match(r.problems[0].message, /pinned as "\^1\.64\.1"/);
});

test("a site without @playwright/test fails", () => {
  const r = checkPlaywright({ expected: "1.64.1", packageJson: {}, packageLock: { lockfileVersion: 3, packages: { "": {} } } });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
});

test("a directly declared playwright off the number fails", () => {
  const packageJson = { devDependencies: { "@playwright/test": "1.64.1", playwright: "1.60.0" } };
  const r = checkPlaywright({ expected: "1.64.1", packageJson, packageLock: lock("1.64.1") });
  assert.equal(r.ok, false);
});

test("a lockfile without a packages map fails", () => {
  const r = checkPlaywright({ expected: "1.64.1", packageJson: pkg("1.64.1"), packageLock: { lockfileVersion: 1, dependencies: {} } });
  assert.equal(r.ok, false);
});

function runCli(toolchain, packageJson, packageLock, workflows = {}) {
  const dir = mkdtempSync(join(tmpdir(), "toolchain-"));
  writeFileSync(join(dir, "toolchain.json"), JSON.stringify(toolchain));
  if (packageJson) writeFileSync(join(dir, "package.json"), JSON.stringify(packageJson));
  if (packageLock) writeFileSync(join(dir, "package-lock.json"), JSON.stringify(packageLock));
  if (Object.keys(workflows).length) {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    for (const [name, content] of Object.entries(workflows)) {
      writeFileSync(join(dir, ".github", "workflows", name), content);
    }
  }
  return spawnSync(process.execPath, [SCRIPT, join(dir, "toolchain.json")], { cwd: dir, encoding: "utf8" });
}

test("cli: exit 0 on a match", () => {
  const r = runCli({ playwright: "1.64.1" }, pkg("1.64.1"), lock("1.64.1"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok: Playwright 1\.64\.1/);
});

test("cli: exit 1 and a fix line on a mismatch", () => {
  const r = runCli({ playwright: "1.64.1" }, pkg("1.59.1"), lock("1.59.1"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error file=package-lock\.json::/);
  assert.match(r.stdout, /npm install --save-dev --save-exact @playwright\/test@1\.64\.1/);
});

test("cli: exit 2 when toolchain.json carries no exact version", () => {
  const r = runCli({ playwright: "^1.64.1" }, pkg("1.64.1"), lock("1.64.1"));
  assert.equal(r.status, 2);
});

test("cli: exit 2 when the lockfile is missing", () => {
  const r = runCli({ playwright: "1.64.1" }, pkg("1.64.1"), null);
  assert.equal(r.status, 2);
});

// --- Second rule: no install of Playwright's system packages ---------------

const E2E_OK = `jobs:
  e2e:
    steps:
      - name: Install Playwright browser
        run: npx playwright install chromium
`;

test("system deps: the browser-only install passes", () => {
  const r = checkSystemDeps({ files: [{ path: ".github/workflows/e2e.yml", content: E2E_OK }] });
  assert.equal(r.ok, true);
});

test("system deps: --with-deps in a run step fails with file and line", () => {
  const content = E2E_OK.replace("install chromium", "install --with-deps chromium");
  const r = checkSystemDeps({ files: [{ path: ".github/workflows/e2e.yml", content }] });
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].file, ".github/workflows/e2e.yml");
  assert.equal(r.problems[0].line, 5);
});

test("system deps: --with-deps after the browser name fails too", () => {
  const content = E2E_OK.replace("install chromium", "install chromium --with-deps");
  assert.equal(checkSystemDeps({ files: [{ path: "w.yml", content }] }).ok, false);
});

test("system deps: inside a multi-line run block fails", () => {
  const content = `jobs:
  e2e:
    steps:
      - run: |
          npm ci
          npx playwright install --with-deps
`;
  const r = checkSystemDeps({ files: [{ path: "w.yml", content }] });
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].line, 6);
});

test("system deps: playwright install-deps fails", () => {
  const content = E2E_OK.replace("install chromium", "install-deps");
  assert.equal(checkSystemDeps({ files: [{ path: "w.yml", content }] }).ok, false);
});

test("system deps: a YAML comment that names the flag passes", () => {
  const content = `# --with-deps was dropped on 2026-11-06 (slow font mirror).\n${E2E_OK}`;
  assert.equal(checkSystemDeps({ files: [{ path: "w.yml", content }] }).ok, true);
});

test("system deps: an npm script with --with-deps fails", () => {
  const r = checkSystemDeps({ scripts: { "e2e:setup": "playwright install --with-deps chromium" } });
  assert.equal(r.ok, false);
  assert.match(r.problems[0].message, /script "e2e:setup"/);
});

test("cli: exit 1 and a fix line when a workflow installs system packages", () => {
  const r = runCli({ playwright: "1.64.1" }, pkg("1.64.1"), lock("1.64.1"), {
    "e2e.yml": E2E_OK.replace("install chromium", "install --with-deps chromium"),
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /::error file=\.github\/workflows\/e2e\.yml,line=5::/);
  assert.match(r.stdout, /npx playwright install chromium \(no --with-deps\)/);
  assert.doesNotMatch(r.stdout, /npm install --save-dev/);
});

test("cli: exit 0 names how many workflows it read", () => {
  const r = runCli({ playwright: "1.64.1" }, pkg("1.64.1"), lock("1.64.1"), {
    "e2e.yml": E2E_OK,
    "toolchain.yml": "jobs: {}\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no system-package install in 2 workflows/);
});

// The estate number itself. A typo here turns every site's check red at once.
test("toolchain.json: an exact version and a sorted list of unique sites", () => {
  const toolchain = JSON.parse(readFileSync(join(dirname(SCRIPT), "toolchain.json"), "utf8"));
  assert.match(toolchain.playwright, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(toolchain.sites) && toolchain.sites.length > 0);
  assert.deepEqual(toolchain.sites, [...new Set(toolchain.sites)].sort());
});
