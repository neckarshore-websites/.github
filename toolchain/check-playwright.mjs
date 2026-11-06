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

import { readFileSync } from "node:fs";
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

  const { ok, problems, seen } = checkPlaywright({ expected, packageJson, packageLock });
  if (ok) {
    console.log(`ok: Playwright ${expected} in package.json and in ${seen.length} lockfile entries`);
    return 0;
  }
  for (const p of problems) console.log(`::error file=${p.file}::${p.message}`);
  console.log("");
  console.log(`Fix: npm install --save-dev --save-exact @playwright/test@${expected}`);
  console.log("Then commit package.json and package-lock.json.");
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
