// Copyright (c) 2026 Sub Rosa contributors
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkSnapshots, REQUIRED_CATEGORIES } from "./check-snapshots.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("check-snapshots", () => {
  it("passes on the committed contract snapshots and dashboard/event evidence", () => {
    const res = checkSnapshots({ rootDir: REPO_ROOT });
    assert.equal(
      res.ok,
      true,
      `Expected pass, got missing=${res.missing.join(",")} stale=${res.staleEvidence.join(",")}`,
    );
    assert.ok(res.filesFound >= REQUIRED_CATEGORIES.length);
  });

  it("fails when a required contract snapshot category is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "snapshots-missing-"));
    try {
      for (const cat of REQUIRED_CATEGORIES.slice(1)) {
        writeFileSync(join(tmp, `${cat}.1.json`), "{}");
      }
      const res = checkSnapshots({ snapshotDir: tmp, checkEvidence: false });
      assert.equal(res.ok, false);
      assert.deepEqual(res.missing, [REQUIRED_CATEGORIES[0]]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when a committed snapshot file contains corrupted JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "snapshots-corrupt-"));
    try {
      for (const cat of REQUIRED_CATEGORIES) {
        writeFileSync(join(tmp, `${cat}.1.json`), "{}");
      }
      writeFileSync(join(tmp, `${REQUIRED_CATEGORIES[0]}.1.json`), "{not-json");
      const res = checkSnapshots({ snapshotDir: tmp, checkEvidence: false });
      assert.equal(res.ok, false);
      assert.equal(res.staleEvidence.length, 1);
      assert.match(res.staleEvidence[0], /invalid or truncated JSON/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("wires snapshot:check and snapshot:test into CI and documents the check", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["snapshot:check"], "node scripts/check-snapshots.mjs");
    assert.equal(
      pkg.scripts["snapshot:test"],
      "node --test scripts/check-snapshots.test.mjs",
    );
    assert.match(pkg.scripts["coverage:test"], /check-snapshots\.test\.mjs/);
    assert.match(pkg.scripts["coverage:test"], /check-snapshots\.mjs/);

    const ciDocs = readFileSync(join(REPO_ROOT, "docs", "CI.md"), "utf8");
    assert.match(ciDocs, /pnpm snapshot:check/);
    assert.match(ciDocs, /pnpm snapshot:test/);
  });
});
