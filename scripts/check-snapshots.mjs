#!/usr/bin/env node
import { normalizeError } from "../packages/logging/src/errors.cjs";
// Copyright (c) 2026 Sub Rosa contributors
import { createLogger } from "../packages/logging/src/index.cjs";
const diagnostics = createLogger("scripts.check-snapshots");
// check-snapshots.mjs
//
// CI guard for Issue #120 & Issue #521 — contract snapshot inventory and
// committed dashboard / event evidence health check.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "..");

export const REQUIRED_CATEGORIES = [
  // ── Create ──────────────────────────────────────────────────────────────
  "create_round_happy_path",
  "create_round_rejects_commit_after_reveal",
  "create_round_rejects_deadline_in_past",

  // ── Commit ───────────────────────────────────────────────────────────────
  "commit_locks_escrow",
  "commit_after_deadline_rejected",
  "commit_zero_escrow_rejected",
  "commit_on_settled_round_rejected",
  "commit_overwrite_before_close_refunds_prior_escrow",
  "overwrite_to_larger_escrow_conserves_tokens",
  "repeated_overwrites_escrow_conservation",

  // ── Reveal ───────────────────────────────────────────────────────────────
  "duplicate_reveal_rejected",
  "reveal_hash_mismatch_invalidates_bid",
  "reveal_wrong_nonce_rejected",
  "reveal_on_settled_round_rejected",
  "late_reveal_rejected_after_window_even_with_seal_present",
  "open_reveal_extends_seal_through_reveal_window",
  "open_reveal_on_settled_round_rejected",
  "missing_reveal_bid_is_skipped_during_clear",
  "no_valid_bids_after_reveal_window",

  // ── Settle ───────────────────────────────────────────────────────────────
  "double_settle_rejected",
  "settle_exact_payouts_table",
  "settled_round_persistent_state_survives_seal_expiry",
  "contract_balance_zero_after_settle",
  "clear_and_settle_work_after_seal_expiry",

  // ── Void ─────────────────────────────────────────────────────────────────
  "double_void_rejected",
  "void_before_grace_rejected",
  "void_after_grace_refunds_all",
  "voided_round_refunds_survive_seal_expiry",
  "contract_balance_zero_after_void",

  // ── Pagination ───────────────────────────────────────────────────────────
  "get_bidders_page_empty",
  "get_bidders_page_exact",
  "get_bidders_page_partial",
  "get_bidders_page_final",
  "get_bidders_page_multi",
  "get_bidders_page_cursor_at_total",
  "get_bidders_page_cursor_beyond_total",
  "get_bidders_page_rejects_limit_zero",
  "get_bidders_page_rejects_limit_over_max",
  "get_bidders_page_preserves_order",
  "get_bidders_returns_ordered_index",
  "get_bidders_still_returns_full_list",

  // ── Drand / lifecycle ────────────────────────────────────────────────────
  "full_lifecycle_real_drand_signature",
  "active_round_seal_ttl_covers_reveal_window",
  "observer_reads_round_and_bid_state_after_lifecycle_completion",
  "token_conservation_full_lifecycle",

  // ── Clearing rules ───────────────────────────────────────────────────────
  "highest_bid_table_driven",
  "highest_bid_tie_is_deterministic_first_inserter_wins",
  "lowest_bid_table_driven",
  "lowest_bid_tie_is_deterministic_first_inserter_wins",
  "seeded_case_42_highest_bid_reproducible",
  "seeded_case_7_lowest_bid_reproducible",
];

const REQUIRED_EVENT_NAMES = [
  "created",
  "commit",
  "revealing",
  "reveal",
  "cleared",
  "settled",
  "voided",
];

/**
 * Check contract snapshot directory and committed evidence fixtures.
 * @param {{ snapshotDir?: string, rootDir?: string, checkEvidence?: boolean }} [opts]
 */
export function checkSnapshots(opts = {}) {
  const rootDir = opts.rootDir ?? process.env.SNAPSHOT_ROOT ?? DEFAULT_ROOT;
  const snapshotDir =
    opts.snapshotDir ??
    process.env.SNAPSHOT_DIR ??
    resolve(rootDir, "contracts/round/test_snapshots/test");
  const checkEvidence = opts.checkEvidence ?? !opts.snapshotDir;

  let files;
  try {
    files = readdirSync(snapshotDir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    return {
      ok: false,
      snapshotDir,
      filesFound: 0,
      missing: [],
      staleEvidence: [`Cannot read snapshot directory ${snapshotDir}: ${normalizeError(err).message}`],
    };
  }

  const presentCategories = new Set(
    files.map((f) => f.replace(/\.\d+\.json$/, "")),
  );

  const missing = REQUIRED_CATEGORIES.filter(
    (cat) => !presentCategories.has(cat),
  );

  const staleEvidence = [];
  for (const file of files) {
    const full = resolve(snapshotDir, file);
    try {
      const parsed = JSON.parse(readFileSync(full, "utf8"));
      if (!parsed || typeof parsed !== "object") {
        staleEvidence.push(`Snapshot ${file} does not contain a JSON object`);
      }
    } catch {
      staleEvidence.push(`Snapshot ${file} contains invalid or truncated JSON`);
    }
  }

  if (checkEvidence) {
    const eventSnapPath = resolve(
      rootDir,
      "packages/round-bindings/fixtures/event-snapshot.json",
    );
    if (!existsSync(eventSnapPath)) {
      staleEvidence.push("Missing packages/round-bindings/fixtures/event-snapshot.json");
    } else {
      try {
        const eventSnap = JSON.parse(readFileSync(eventSnapPath, "utf8"));
        const names = new Set((eventSnap.events ?? []).map((e) => e.name));
        for (const req of REQUIRED_EVENT_NAMES) {
          if (!names.has(req)) {
            staleEvidence.push(
              `event-snapshot.json is missing required contract event "${req}"`,
            );
          }
        }
      } catch {
        staleEvidence.push("event-snapshot.json is not valid JSON");
      }
    }

    const dashboardFixturePath = resolve(
      rootDir,
      "apps/web/src/dashboard/fixture.ts",
    );
    if (!existsSync(dashboardFixturePath)) {
      staleEvidence.push("Missing apps/web/src/dashboard/fixture.ts");
    } else {
      const fixtureText = readFileSync(dashboardFixturePath, "utf8");
      if (
        !fixtureText.includes("DASHBOARD_FIXTURE") ||
        !fixtureText.includes('status: "Settled"') ||
        !fixtureText.includes('currentPhase: "complete"') ||
        !fixtureText.includes("contractBalance: 0")
      ) {
        staleEvidence.push(
          "apps/web/src/dashboard/fixture.ts is missing required settled round evidence fields",
        );
      }
    }
  }

  return {
    ok: missing.length === 0 && staleEvidence.length === 0,
    snapshotDir,
    filesFound: files.length,
    missing,
    staleEvidence,
  };
}

function main() {
  const res = checkSnapshots();
  const required = REQUIRED_CATEGORIES.length;

  diagnostics.info("contract-snapshot-inventory", "\nContract snapshot inventory");
  diagnostics.info("directory", `  Directory : ${res.snapshotDir}`);
  diagnostics.info("files-found", `  Files found  : ${res.filesFound}`);
  diagnostics.info("categories-checked", `  Categories checked : ${required}`);

  if (res.ok) {
    diagnostics.info(
      "all",
      `\n✓ All ${required} required snapshot categories and committed evidence fixtures are healthy.\n`,
    );
    process.exit(0);
  }

  if (res.missing.length > 0) {
    diagnostics.error(
      "progress-2",
      `\n✗ ${res.missing.length} required snapshot category/categories missing:\n`,
    );
    for (const cat of res.missing) {
      diagnostics.error("progress-3", `    - ${cat}`);
    }
  }
  if (res.staleEvidence.length > 0) {
    for (const issue of res.staleEvidence) {
      diagnostics.error("stale-evidence", `  ✗ ${issue}`);
    }
  }
  diagnostics.error(
    "regenerate-snapshots-with-cargo-test-p-sub-rosa-round",
    "\n  Regenerate snapshots with: cargo test -p sub-rosa-round\n",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
