from pathlib import Path

path = Path("src/lib/marketplaces/trendMarketplaceScanner.ts")
text = path.read_text()

targets = [
    "inserted:",
    '"inserted":',
]

changed = False
for target in targets:
    if target in text:
        text = text.replace(target, target.replace("inserted", "upserted"))
        changed = True

if not changed:
    raise SystemExit("No remaining summary label targets found.")

path.write_text(text)
print("Updated remaining summary labels from inserted -> upserted.")
