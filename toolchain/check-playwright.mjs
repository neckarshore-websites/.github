#!/usr/bin/env node
// Holds one website repository to the estate's Playwright version.
//
// Usage (from the website's repository root):
//   node <path>/check-playwright.mjs <path>/toolchain.json
//
// Why: each website pins Playwright exactly, and without a shared number
// the pins drifted to five versions across ten sites. Every version wants
// its own browser build, so switching between sites downloaded and deleted
// browsers in turn. This check makes a site that leaves the estate number
// fail its own CI.
//
// What it reads is what CI installs: package-lock.json, every copy of
// @playwright/test, playwright and playwright-core in it, plus the exact
// pin in package.json. Exit 0 when all match, 1 on any mismatch, 2 when
// the inputs cannot be read.
//
// Second rule (Founder 2026-11-19, "Ja, bauen"): no workflow and no npm
// script may install Playwright's system packages, that is
// `playwright install --with-deps` or `playwright install-deps`. On
// 2026-11-06 that flag was behind the slow E2E runs (nine font packages from
// a slow Ubuntu mirror, 26 of 524 runs) and was removed from seven sites. The
// browser runs without those packages on GitHub's ubuntu-latest. This rule
// keeps the flag from coming back by copy from an old workflow or a tutorial.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGES = ["@playwright/test", "playwright", "playwright-core"];

export function checkPlaywright({ expected, packageJson, packageLock }) {
  const problems = [];
  const seen = [];

  const declared =
    packageJson.devDependencies?.["@playwright/test"] ??
    packageJson.dependencies?.["@playwright/test"];
  if (declared === undefined) {
    problems.push({
      file: "package.json",
      message: "@playwright/test is not declared, but this site runs the Playwright check",
    });
  } else if (declared !== expected) {
    problems.push({
      file: "package.json",
      message: `@playwright/test is pinned as "${declared}", the estate number is ${expected} (exact, no ^ or ~)`,
    });
  }

  for (const name of ["playwright", "playwright-core"]) {
    const direct = packageJson.devDependencies?.[name] ?? packageJson.dependencies?.[name];
    if (direct !== undefined && direct !== expected) {
      problems.push({
        file: "package.json",
        message: `${name} is pinned as "${direct}", the estate number is ${expected}`,
      });
    }
  }

  if (!packageLock.packages) {
    problems.push({
      file: "package-lock.json",
      message: `lockfileVersion ${packageLock.lockfileVersion} has no "packages" map; regenerate it with a current npm`,
    });
  } else {
    for (const [key, entry] of Object.entries(packageLock.packages)) {
      const name = PACKAGES.find((p) => key === `node_modules/${p}` || key.endsWith(`/node_modules/${p}`));
      if (!name) continue;
      seen.push(key);
      if (entry.version !== expected) {
        problems.push({
          file: "package-lock.json",
          message: `${key} resolves to ${entry.version}, the estate number is ${expected}`,
        });
      }
    }
    if (!seen.includes("node_modules/@playwright/test")) {
      problems.push({
        file: "package-lock.json",
        message: "node_modules/@playwright/test is missing; run npm install and commit the lockfile",
      });
    }
  }

  return { ok: problems.length === 0, problems, seen };
}

// Matches the two ways of installing Playwright's system packages. The
// optional @version covers `npx playwright@1.64.1 install-deps`.
const SYSTEM_DEPS = /--with-deps\b|\bplaywright(?:@\S+)?\s+install-deps\b/;
// The same install-deps call split over two lines, as a folded (`>`) run
// block joins them into one command.
const SYSTEM_DEPS_SPLIT = /\bplaywright(?:@\S+)?[ \t]*\n[ \t]*install-deps\b/g;

// YAML comments: a whole comment line, or " # ..." after the content (YAML
// needs whitespace before a trailing "#"). A workflow may still explain why
// the flag is gone. A "#" inside a quoted string is cut too; that can only
// hide a match, never invent one.
function withoutComment(line) {
  if (line.trimStart().startsWith("#")) return "";
  return line.replace(/\s#.*$/, "");
}

// files: [{ path, content }] for every workflow; scripts: package.json scripts.
export function checkSystemDeps({ files = [], scripts = {} }) {
  const problems = [];
  const report = (path, lineNo, text) =>
    problems.push({
      file: path,
      line: lineNo,
      message: `installs Playwright's system packages (${text.trim()}); use "npx playwright install chromium" without --with-deps`,
    });
  for (const { path, content } of files) {
    const lines = content.split("\n").map(withoutComment);
    lines.forEach((line, i) => {
      if (SYSTEM_DEPS.test(line)) report(path, i + 1, line);
    });
    const text = lines.join("\n");
    for (const m of text.matchAll(SYSTEM_DEPS_SPLIT)) {
      const lineNo = text.slice(0, m.index + m[0].length).split("\n").length;
      report(path, lineNo, m[0].replace(/\s+/g, " "));
    }
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string" && SYSTEM_DEPS.test(command)) {
      problems.push({
        file: "package.json",
        message: `script "${name}" installs Playwright's system packages (${command}); drop --with-deps`,
      });
    }
  }
  return { ok: problems.length === 0, problems };
}

function readWorkflows(root) {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((f) => ({ path: `.github/workflows/${f}`, content: readFileSync(join(dir, f), "utf8") }));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv) {
  const toolchainPath = argv[2];
  if (!toolchainPath) {
    console.error("usage: check-playwright.mjs <toolchain.json>");
    return 2;
  }
  let toolchain, packageJson, packageLock;
  try {
    toolchain = readJson(toolchainPath);
    packageJson = readJson(join(process.cwd(), "package.json"));
    packageLock = readJson(join(process.cwd(), "package-lock.json"));
  } catch (err) {
    console.error(`::error::cannot read the inputs: ${err.message}`);
    return 2;
  }
  const expected = toolchain.playwright;
  if (typeof expected !== "string" || !/^\d+\.\d+\.\d+$/.test(expected)) {
    console.error(`::error::toolchain.json carries no exact "playwright" version (found ${JSON.stringify(expected)})`);
    return 2;
  }

  const version = checkPlaywright({ expected, packageJson, packageLock });
  let workflows;
  try {
    workflows = readWorkflows(process.cwd());
  } catch (err) {
    console.error(`::error::cannot read .github/workflows: ${err.message}`);
    return 2;
  }
  const deps = checkSystemDeps({ files: workflows, scripts: packageJson.scripts ?? {} });

  if (version.ok && deps.ok) {
    console.log(`ok: Playwright ${expected} in package.json and in ${version.seen.length} lockfile entries`);
    console.log(`ok: no system-package install in ${workflows.length} workflows and the npm scripts`);
    return 0;
  }
  for (const p of [...version.problems, ...deps.problems]) {
    const where = p.line ? `file=${p.file},line=${p.line}` : `file=${p.file}`;
    console.log(`::error ${where}::${p.message}`);
  }
  console.log("");
  if (!version.ok) {
    console.log(`Fix: npm install --save-dev --save-exact @playwright/test@${expected}`);
    console.log("Then commit package.json and package-lock.json.");
  }
  if (!deps.ok) {
    console.log("Fix: install the browser only, npx playwright install chromium (no --with-deps).");
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
