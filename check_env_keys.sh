#!/usr/bin/env bash
set -euo pipefail

A="${1:-.env.vercel}"
B="${2:-.env}"

extract_keys() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" \
      | sed 's/=.*$//' \
      | sort -u
  fi
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

extract_keys "$A" > "$tmpdir/a.keys"
extract_keys "$B" > "$tmpdir/b.keys"
env | sed 's/=.*$//' | sort -u > "$tmpdir/shell.keys"

echo "===================="
echo "FILES FOUND"
echo "===================="
[[ -f "$A" ]] && echo "OK  $A" || echo "MISS  $A"
[[ -f "$B" ]] && echo "OK  $B" || echo "MISS  $B"

echo
echo "===================="
echo "KEY COUNTS"
echo "===================="
echo "$A : $(wc -l < "$tmpdir/a.keys" 2>/dev/null || echo 0)"
echo "$B : $(wc -l < "$tmpdir/b.keys" 2>/dev/null || echo 0)"
echo "shell env : $(wc -l < "$tmpdir/shell.keys")"

echo
echo "===================="
echo "KEYS IN $A"
echo "===================="
cat "$tmpdir/a.keys" || true

echo
echo "===================="
echo "KEYS IN $B"
echo "===================="
cat "$tmpdir/b.keys" || true

echo
echo "===================="
echo "IN $A BUT MISSING FROM $B"
echo "===================="
comm -23 "$tmpdir/a.keys" "$tmpdir/b.keys" || true

echo
echo "===================="
echo "IN $B BUT MISSING FROM $A"
echo "===================="
comm -13 "$tmpdir/a.keys" "$tmpdir/b.keys" || true

echo
echo "===================="
echo "IN $A BUT NOT IN CURRENT SHELL ENV"
echo "===================="
comm -23 "$tmpdir/a.keys" "$tmpdir/shell.keys" || true

echo
echo "===================="
echo "IN CURRENT SHELL ENV BUT NOT IN $A"
echo "===================="
comm -13 "$tmpdir/a.keys" "$tmpdir/shell.keys" || true

echo
echo "===================="
echo "COMMON KEYS BETWEEN $A AND $B"
echo "===================="
comm -12 "$tmpdir/a.keys" "$tmpdir/b.keys" || true
