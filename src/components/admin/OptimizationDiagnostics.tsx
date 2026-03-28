type Props = {
  listingResponse: Record<string, unknown> | null | undefined;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry));
}

function formatScore(value: number | null): string {
  if (value == null) return "-";
  return value.toFixed(2);
}

function formatPct(value: number | null): string {
  if (value == null) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 text-sm text-white/90">{value}</div>
    </div>
  );
}

export function OptimizationDiagnostics({ listingResponse }: Props) {
  const root = asObject(listingResponse);
  const diagnostics = asObject(root?.diagnostics);
  if (!diagnostics) return null;

  const listingQuality = asObject(diagnostics.listingQuality);
  const listingFlags = asStringArray(listingQuality?.flags);
  const listingQualityScore = asNumber(listingQuality?.score);

  const mediaQualityScore = asNumber(diagnostics.mediaQualityScore);
  const mediaFlags = asStringArray(diagnostics.mediaQualityFlags);

  const matchConfidence = asNumber(diagnostics.matchConfidence);
  const matchStatus = asString(diagnostics.matchStatus) ?? "-";
  const penalties = asObject(diagnostics.matchPenalties);
  const penaltyEntries = penalties
    ? Object.entries(penalties)
        .map(([key, value]) => ({ key, value: asNumber(value) }))
        .filter((entry) => entry.value != null)
    : [];

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <h3 className="text-lg font-semibold text-white">Optimization Diagnostics</h3>
      <p className="mt-1 text-sm text-white/60">Read-only listing, media, and match quality signals used for operator review.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <KeyValue label="Listing Quality Score" value={formatScore(listingQualityScore)} />
        <KeyValue label="Media Quality Score" value={formatScore(mediaQualityScore)} />
        <KeyValue label="Match Confidence" value={formatPct(matchConfidence)} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <KeyValue
          label="Listing Quality Flags"
          value={listingFlags.length ? listingFlags.join(", ") : "None"}
        />
        <KeyValue
          label="Media Flags"
          value={mediaFlags.length ? mediaFlags.join(", ") : "None"}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <KeyValue label="Match Status" value={matchStatus} />
        <KeyValue
          label="Match Penalties"
          value={
            penaltyEntries.length
              ? penaltyEntries.map((entry) => `${entry.key}: ${entry.value?.toFixed(2)}`).join(" | ")
              : "None"
          }
        />
      </div>
    </section>
  );
}
