from pathlib import Path

path = Path("src/lib/marketplaces/trendMarketplaceScanner.ts")
text = path.read_text()

replacements = [
    ("let inserted = 0;", "let upserted = 0;"),
    ("      inserted++;", "      upserted++;"),
    ("    inserted,", "    upserted,"),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"Target not found: {old}")
    text = text.replace(old, new)

path.write_text(text)
print("Renamed inserted -> upserted in marketplace scan summary.")
