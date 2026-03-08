from pathlib import Path

path = Path("src/lib/marketplaces/trendMarketplaceScanner.ts")
text = path.read_text()

replacements = [
    ('inserted:', 'upserted:'),
    ('"inserted"', '"upserted"'),
]

original = text
for old, new in replacements:
    text = text.replace(old, new)

if text == original:
    raise SystemExit("No target text changed. Review file manually before patching.")

path.write_text(text)
print("Updated marketplace scan summary labels from inserted -> upserted.")
