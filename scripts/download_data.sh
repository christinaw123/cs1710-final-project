#!/usr/bin/env bash
# Downloads the official College Scorecard source files and documentation used by
# scripts/build_data.py, and records retrieval time + SHA-256 in data/raw/MANIFEST.tsv.
#
# Usage: bash scripts/download_data.sh
# Source page: https://collegescorecard.ed.gov/data/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/data/raw"
DOCS="$ROOT/data/docs"
mkdir -p "$RAW" "$DOCS"

# The release stamp (MMDDYYYY) is part of the official filename. Update it when a new
# release is published; build_data.py reads RELEASE from the same place.
RELEASE="10152026"
BASE="https://ed-public-download.scorecard.network/downloads"

FILES=(
  "$BASE/College_Scorecard_Raw_Data_${RELEASE}.zip|$RAW"
  "https://collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx|$DOCS"
  "https://collegescorecard.ed.gov/files/FieldOfStudyDataDocumentation.pdf|$DOCS"
  "https://collegescorecard.ed.gov/files/InstitutionDataDocumentation.pdf|$DOCS"
  "https://nces.ed.gov/ipeds/cipcode/Files/CIPCode2020.csv|$RAW"
)

MANIFEST="$RAW/MANIFEST.tsv"
printf "file\turl\tretrieved_utc\tlast_modified\tbytes\tsha256\n" > "$MANIFEST"

for entry in "${FILES[@]}"; do
  url="${entry%%|*}"
  dest="${entry##*|}"
  name="$(basename "$url")"
  echo "Downloading $name ..."
  headers="$(curl -fsSL -D - -o "$dest/$name" "$url")"
  last_mod="$(printf "%s" "$headers" | grep -i '^last-modified:' | tail -1 | cut -d' ' -f2- | tr -d '\r')"
  bytes="$(wc -c < "$dest/$name" | tr -d ' ')"
  sha="$(shasum -a 256 "$dest/$name" | cut -d' ' -f1)"
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$name" "$url" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$last_mod" "$bytes" "$sha" >> "$MANIFEST"
done

echo "Done. Manifest written to $MANIFEST"
