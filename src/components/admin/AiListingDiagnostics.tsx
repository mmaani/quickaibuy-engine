import { LISTING_PACK_LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai/schemas";

type Props = {
  listingResponse: Record<string, unknown> | null | undefined;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function formatFlag(flag: string): string {
  return flag.replaceAll("_", " ");
}

function formatConfidence(value: number | null): string {
  if (value == null) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function formatValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value.trim() || "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractSpecifics(value: unknown): Array<{ key: string; value: string | null }> {
  const record = asObject(value);
  if (!record) return [];
  return Object.entries(record).map(([key, entry]) => ({
    key,
    value: entry == null ? null : formatValue(entry),
  }));
}

function renderBadge(label: string, tone: "rose" | "amber" | "cyan" | "emerald") {
  const styles = {
    rose: "border-rose-300/30 bg-rose-400/12 text-rose-100",
    amber: "border-amber-300/30 bg-amber-400/12 text-amber-100",
    cyan: "border-cyan-300/30 bg-cyan-400/12 text-cyan-100",
    emerald: "border-emerald-300/30 bg-emerald-400/12 text-emerald-100",
  }[tone];

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${styles}`}>
      {label}
    </span>
  );
}

function PackField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 text-sm text-white/90">{value}</div>
    </div>
  );
}

function SpecificsList({
  title,
  entries,
  emptyLabel,
  highlightNulls = false,
}: {
  title: string;
  entries: Array<{ key: string; value: string | null }>;
  emptyLabel: string;
  highlightNulls?: boolean;
}) {
  return (
    <details className="rounded-2xl border border-white/10 bg-black/20 p-3" open>
      <summary className="cursor-pointer text-[11px] uppercase tracking-[0.18em] text-white/45">{title}</summary>
      <div className="mt-3">
        {entries.length ? (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-sm">
                <span className="text-white/70">{entry.key}</span>
                <span className={highlightNulls && entry.value == null ? "text-amber-200" : "text-white/90"}>
                  {entry.value ?? "null"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-white/55">{emptyLabel}</div>
        )}
      </div>
    </details>
  );
}

export function AiListingDiagnostics({ listingResponse }: Props) {
  const response = asObject(listingResponse);
  const aiListing = asObject(response?.aiListing);
  const auditData = asObject(aiListing?.postPublishAudit) ?? asObject(response?.postPublishAudit);

  if (!aiListing && !auditData) return null;

  const generatedPack = asObject(aiListing?.generatedPack);
  const verifiedPack = asObject(aiListing?.verifiedPack);
  const correctedFields = asStringArray(aiListing?.correctedFields ?? verifiedPack?.corrected_fields);
  const removedClaims = asStringArray(aiListing?.removedClaims ?? verifiedPack?.removed_claims);
  const riskFlags = asStringArray(aiListing?.riskFlags ?? verifiedPack?.risk_flags);
  const verificationConfidence = asNumber(aiListing?.verificationConfidence ?? verifiedPack?.verification_confidence);
  const manualReviewRequired = Boolean(
    asBoolean(aiListing?.manualReviewRequired) ?? asBoolean(verifiedPack?.review_required) ?? false
  );
  const lowVerificationConfidence = Boolean(
    asBoolean(aiListing?.lowVerificationConfidence) ??
      (verificationConfidence != null && verificationConfidence < LISTING_PACK_LOW_CONFIDENCE_THRESHOLD) ??
      riskFlags.includes("VERIFICATION_CONFIDENCE_LOW")
  );

  const generatedSpecifics = extractSpecifics(generatedPack?.item_specifics);
  const verifiedSpecifics = extractSpecifics(verifiedPack?.verified_item_specifics);
  const nulledSpecifics = generatedSpecifics.filter((entry) => {
    const generatedValue = entry.value;
    const verifiedValue = verifiedSpecifics.find((candidate) => candidate.key === entry.key)?.value ?? null;
    return generatedValue != null && verifiedValue == null;
  });

  const generatedCategoryId = asString(generatedPack?.category_id);
  const generatedCategoryName = asString(generatedPack?.category_name);
  const verifiedCategoryId = asString(verifiedPack?.verified_category_id);
  const verifiedCategoryName = asString(verifiedPack?.verified_category_name);
  const categoryChanged =
    Boolean(generatedCategoryId || verifiedCategoryId || generatedCategoryName || verifiedCategoryName) &&
    (generatedCategoryId !== verifiedCategoryId || generatedCategoryName !== verifiedCategoryName);
  const categoryConflict = riskFlags.includes("CATEGORY_EVIDENCE_CONFLICT");
  const categoryFallback = riskFlags.includes("CATEGORY_EVIDENCE_WEAK");

  const correctionDraft = asObject(auditData?.correctionDraft);
  const auditRiskFlags = asStringArray(auditData?.riskFlags ?? correctionDraft?.riskFlags);
  const mismatchFields = Array.isArray(correctionDraft?.mismatches)
    ? (correctionDraft?.mismatches as unknown[])
        .map((entry) => asObject(entry))
        .map((entry) => asString(entry?.field))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const driftNotes = Array.isArray(correctionDraft?.mismatches)
    ? (correctionDraft?.mismatches as unknown[])
        .map((entry) => asObject(entry))
        .map((entry) => {
          const field = asString(entry?.field);
          const reason = asString(entry?.reason);
          return field && reason ? `${field}: ${reason}` : field ?? reason;
        })
        .filter((entry): entry is string => Boolean(entry))
    : [];

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">AI Verification Diagnostics</h3>
          <p className="mt-1 text-sm text-white/60">
            Generated output vs verified output, with manual-review reasons surfaced first.
          </p>
        </div>
        <div className="text-sm text-white/80">
          Verification confidence: <span className={lowVerificationConfidence ? "text-amber-200" : "text-emerald-200"}>{formatConfidence(verificationConfidence)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {manualReviewRequired ? renderBadge("Manual Review Required", "rose") : renderBadge("Review Signal Cleared", "emerald")}
        {lowVerificationConfidence ? renderBadge("Verification Confidence Low", "amber") : null}
        {removedClaims.length ? renderBadge("Claims Removed", "amber") : null}
        {correctedFields.length ? renderBadge("Fields Corrected", "cyan") : null}
        {categoryFallback ? renderBadge("Category Fallback", "amber") : null}
        {categoryConflict ? renderBadge("Category Conflict", "rose") : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <PackField label="Manual Review" value={manualReviewRequired ? "Required" : "No"} />
        <PackField label="Low Confidence Trigger" value={lowVerificationConfidence ? "Yes" : "No"} />
        <PackField label="Corrected Fields" value={correctedFields.length || 0} />
        <PackField label="Removed Claims" value={removedClaims.length || 0} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-3xl border border-cyan-300/20 bg-cyan-400/[0.05] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-cyan-100">Generated By AI</div>
          <PackField label="Title" value={asString(generatedPack?.optimized_title) ?? "-"} />
          <PackField
            label="Category"
            value={[generatedCategoryId, generatedCategoryName].filter(Boolean).join(" / ") || "-"}
          />
          <SpecificsList title="Item Specifics" entries={generatedSpecifics} emptyLabel="No generated specifics." />
          <details className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-[11px] uppercase tracking-[0.18em] text-white/45">Bullets + Description</summary>
            <div className="mt-3 space-y-3 text-sm text-white/90">
              <div>
                <div className="mb-1 text-white/55">Bullets</div>
                <ul className="space-y-1">
                  {asStringArray(generatedPack?.bullet_points).length ? (
                    asStringArray(generatedPack?.bullet_points).map((bullet) => <li key={bullet}>- {bullet}</li>)
                  ) : (
                    <li className="text-white/55">No generated bullets.</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-white/55">Description</div>
                <div className="whitespace-pre-wrap text-white/85">{asString(generatedPack?.description) ?? "-"}</div>
              </div>
            </div>
          </details>
        </div>

        <div className="space-y-3 rounded-3xl border border-emerald-300/20 bg-emerald-400/[0.05] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-emerald-100">Verified / Corrected</div>
          <PackField label="Title" value={asString(verifiedPack?.verified_title) ?? "-"} />
          <PackField
            label="Category"
            value={[verifiedCategoryId, verifiedCategoryName].filter(Boolean).join(" / ") || "-"}
          />
          <SpecificsList
            title="Item Specifics"
            entries={verifiedSpecifics}
            emptyLabel="No verified specifics."
            highlightNulls
          />
          <details className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-[11px] uppercase tracking-[0.18em] text-white/45">Bullets + Description</summary>
            <div className="mt-3 space-y-3 text-sm text-white/90">
              <div>
                <div className="mb-1 text-white/55">Bullets</div>
                <ul className="space-y-1">
                  {asStringArray(verifiedPack?.verified_bullet_points).length ? (
                    asStringArray(verifiedPack?.verified_bullet_points).map((bullet) => <li key={bullet}>- {bullet}</li>)
                  ) : (
                    <li className="text-white/55">No verified bullets.</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-white/55">Description</div>
                <div className="whitespace-pre-wrap text-white/85">{asString(verifiedPack?.verified_description) ?? "-"}</div>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <details className="rounded-2xl border border-white/10 bg-black/20 p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-white">Corrections and removals</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Corrected Fields</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {correctedFields.length ? correctedFields.map((field) => (
                  <span key={field} className="rounded-full border border-cyan-300/30 bg-cyan-400/12 px-2.5 py-1 text-xs text-cyan-100">
                    {field}
                  </span>
                )) : <span className="text-sm text-white/55">No corrected fields recorded.</span>}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Removed Claims</div>
              <div className="mt-2 space-y-2">
                {removedClaims.length ? removedClaims.map((claim) => (
                  <div key={claim} className="rounded-xl border border-amber-300/20 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-100">
                    {claim}
                  </div>
                )) : <div className="text-sm text-white/55">No removed claims recorded.</div>}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <SpecificsList
              title="Nulled Item Specifics"
              entries={nulledSpecifics}
              emptyLabel="No generated specifics were nulled during verification."
              highlightNulls
            />
          </div>
        </details>

        <details className="rounded-2xl border border-white/10 bg-black/20 p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-white">Risk diagnostics</summary>
          <div className="mt-3 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Risk Flags</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {riskFlags.length ? riskFlags.map((flag) => (
                  <span key={flag} className="rounded-full border border-rose-300/30 bg-rose-400/12 px-2.5 py-1 text-xs text-rose-100">
                    {formatFlag(flag)}
                  </span>
                )) : <span className="text-sm text-white/55">No AI risk flags recorded.</span>}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <PackField
                label="Category Review"
                value={
                  categoryChanged
                    ? `Generated ${[generatedCategoryId, generatedCategoryName].filter(Boolean).join(" / ") || "-"} -> Verified ${[verifiedCategoryId, verifiedCategoryName].filter(Boolean).join(" / ") || "-"}`
                    : categoryFallback
                      ? "Evidence weak. Generated category kept and remains review-sensitive."
                      : "No category correction recorded."
                }
              />
              <PackField
                label="Verification Reasoning"
                value={
                  lowVerificationConfidence
                    ? `Confidence below ${formatConfidence(LISTING_PACK_LOW_CONFIDENCE_THRESHOLD)} fail-closed threshold.`
                    : "Verification confidence stayed above the manual-review warning threshold."
                }
              />
            </div>
          </div>
        </details>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm font-semibold text-white">Post-Publish Audit Recommendations</div>
        <div className="mt-1 text-sm text-white/60">
          Display slot only. No live audit execution or autonomous edits are enabled here.
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PackField
            label="Correction Draft Summary"
            value={
              correctionDraft
                ? `${asNumber(correctionDraft.mismatchCount) ?? mismatchFields.length} mismatch(es), manual approval only`
                : "Awaiting audit data"
            }
          />
          <PackField label="Mismatch Fields" value={mismatchFields.length ? mismatchFields.join(", ") : "No audit mismatches yet"} />
          <PackField label="Risk Flags" value={auditRiskFlags.length ? auditRiskFlags.map(formatFlag).join(", ") : "No audit risk flags yet"} />
          <PackField label="Live vs Verified Drift" value={driftNotes.length ? driftNotes.slice(0, 2).join(" | ") : "No drift notes yet"} />
        </div>
      </div>
    </section>
  );
}
