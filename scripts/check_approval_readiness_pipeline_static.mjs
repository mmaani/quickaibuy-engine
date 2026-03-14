import fs from 'node:fs';

const checks = [
  {
    file: 'src/app/api/admin/review/decision/route.ts',
    includes: [
      'validateProfitSafety',
      'effectiveDecisionStatus = "MANUAL_REVIEW"',
      'listingEligible = false',
      'listing_eligible = $5',
      'listing_block_reason = $6',
    ],
    description: 'Approval route fail-closes to MANUAL_REVIEW and updates listing eligibility fields',
  },
  {
    file: 'src/lib/listings/prepareListingPreviews.ts',
    includes: [
      'decisionStatus !== "APPROVED"',
      'candidate must be APPROVED before preparing preview',
      'findListingDuplicatesForCandidate',
      'LISTING_PREVIEW_BLOCKED_DUPLICATE',
    ],
    description: 'Preview preparation requires APPROVED candidate and blocks duplicates',
  },
  {
    file: 'src/lib/listings/markListingReadyToPublish.ts',
    includes: [
      'if (decisionStatus !== "APPROVED")',
      'if (!listingEligible)',
      'const failClosed =',
      'LISTING_BLOCKED_SUPPLIER_DRIFT',
      'duplicate live-path listing already exists for candidate',
      'status = ${LISTING_PUBLISH_ENTRY_STATUS}',
    ],
    description: 'READY_TO_PUBLISH promotion enforces approval, eligibility, fail-closed safety, and duplicate blocking',
  },
  {
    file: 'src/lib/listings/getListingExecutionCandidates.ts',
    includes: [
      'l.status = ${LISTING_STATUSES.READY_TO_PUBLISH}',
      "pc.decision_status = 'APPROVED'",
      'pc.listing_eligible = TRUE',
    ],
    description: 'Execution queue only selects READY_TO_PUBLISH rows that are APPROVED + listing_eligible',
  },
  {
    file: 'src/app/admin/listings/page.tsx',
    includes: [
      'if (!item.listingEligible) return "Candidate is not listing eligible.";',
      'if (item.duplicateDetected) return item.duplicateReason || "Duplicate listing conflict detected.";',
      'if (item.previewStatus !== "PREPARED") return "Preview data is incomplete.";',
    ],
    description: 'Admin surface exposes promote-entry blockers',
  },
];

let ok = true;

for (const check of checks) {
  const source = fs.readFileSync(check.file, 'utf8');
  const missing = check.includes.filter((needle) => !source.includes(needle));
  if (missing.length > 0) {
    ok = false;
    console.error(`FAIL: ${check.description}`);
    console.error(`  file: ${check.file}`);
    for (const needle of missing) {
      console.error(`  missing: ${needle}`);
    }
  } else {
    console.log(`PASS: ${check.description}`);
  }
}

if (!ok) process.exit(1);
console.log('\nStatic approval->readiness guard checks passed.');
