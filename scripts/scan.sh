#!/usr/bin/env bash
# scan.sh : pre-publish safety scan for this repository.
#
#   ./scripts/scan.sh
#
# Exit codes: 0 = clean, 1 = findings, 2 = setup problem.
#
# What it checks
#   1. Generic patterns: emails, long IDs (Google Sheet IDs, hashes), Telegram
#      chat IDs and bot tokens, API-key-looking strings, n8n instance metadata.
#   2. A PRIVATE denylist of the real values (client names, real IDs, emails).
#      That file lives OUTSIDE the repo, because committing it would leak the
#      exact values it exists to catch. Default location:
#        <repo>/../../n8n-originales/_private/denylist.txt
#      Override with SCAN_DENYLIST=/path/to/file. One fixed string per line,
#      matched case-insensitively. Lines starting with # are ignored.
#   3. gitleaks, if installed (brew install gitleaks).
#
# It never prints the offending text, only file:line, so a failed run does not
# spread the secret into terminal logs or CI output.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

DENYLIST="${SCAN_DENYLIST:-$ROOT/../../n8n-originales/_private/denylist.txt}"
FINDINGS="$(mktemp)"
trap 'rm -f "$FINDINGS"' EXIT
PLACEHOLDER='YOUR_|REPLACE_|example\.(com|org|net)'

# findings go to a file because most rules run inside pipelines (subshells)
fail() { printf 'FAIL  %-18s %s\n' "$1" "$2"; echo x >> "$FINDINGS"; }

# Text files only (images are listed separately for manual review)
list_files() {
  find . -type f \
    -not -path './.git/*' -not -path './scripts/scan.sh' -not -name '.DS_Store' \
    -not -path '*/node_modules/*' -not -name 'package-lock.json' \
    -not -name '*.png' -not -name '*.jpg' -not -name '*.jpeg' -not -name '*.gif' \
    -not -name '*.webp' -not -name '*.pdf' -print0
}

emit() { # emit RULE < lines of file:line
  local rule="$1" line
  while IFS= read -r line; do
    [ -n "$line" ] && fail "$rule" "$line"
  done
}

# rule NAME ERE : every matching line that is not a documented placeholder
rule() {
  list_files | xargs -0 grep -nEIH -- "$2" 2>/dev/null \
    | grep -viE "$PLACEHOLDER" | cut -d: -f1,2 | emit "$1"
}

# --- 1. generic patterns ------------------------------------------------------
rule telegram-token   '[0-9]{8,10}:[A-Za-z0-9_-]{30,}'
rule key-prefix       '(sk-[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
rule hex-secret       '(^|[^A-Za-z0-9])[a-fA-F0-9]{32,}([^A-Za-z0-9]|$)'
rule sheet-url        'spreadsheets/d/[A-Za-z0-9_-]{20,}'
rule chat-id          '(^|[^0-9.A-Za-z_-])-?[0-9]{8,14}([^0-9-]|$)'
rule secret-assign    '(api[_-]?key|app[_-]?key|secret|token|password|authorization|bearer)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9_.-]{16,}'
rule n8n-metadata     '"(webhookId|instanceId|versionId|cachedResultUrl)"'
rule credential-id    '"id": "[A-Za-z0-9]{16}"'

# long mixed alphanumeric tokens (Sheet IDs, hashes), ignoring plain words
list_files | xargs -0 grep -noEIH -- '[A-Za-z0-9_-]{40,}' 2>/dev/null | while IFS= read -r line; do
  tok="${line##*:}"
  case "$tok" in *[0-9]*) ;; *) continue ;; esac
  case "$tok" in *[A-Za-z]*) ;; *) continue ;; esac
  case "$tok" in YOUR_*|REPLACE_*) continue ;; esac
  echo "${line%:*}"
done | emit long-id

# emails, except documented placeholders and public sender addresses
list_files | xargs -0 grep -noEIH -- '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+' 2>/dev/null | while IFS= read -r line; do
  tok="${line##*:}"
  case "$tok" in
    *@example.com|*@example.org|*@example.net|*@your-project.iam.gserviceaccount.com) continue ;;
    *.example) continue ;;   # reserved TLD (RFC 2606), can never be a real address
    alert@indeed.com|jobalerts-noreply@linkedin.com|dmca@telegram.org) continue ;;
  esac
  echo "${line%:*}"
done | emit email

# draft markers: a README with an unfilled placeholder must never be published
list_files | xargs -0 grep -nIH -- '<<FILL' 2>/dev/null | cut -d: -f1,2 | emit unfilled-draft

# --- 2. private denylist --------------------------------------------------------
if [ -f "$DENYLIST" ]; then
  TMP="$(mktemp)"
  grep -vE '^[[:space:]]*(#|$)' "$DENYLIST" > "$TMP"
  if [ ! -s "$TMP" ]; then
    fail denylist "denylist file is empty: $DENYLIST"
  else
    list_files | xargs -0 grep -nIiHF -f "$TMP" 2>/dev/null | cut -d: -f1,2 | emit denylist
    find . -not -path './.git/*' -type f | grep -iF -f "$TMP" | emit denylist-filename
  fi
  rm -f "$TMP"
elif [ "${SCAN_ALLOW_NO_DENYLIST:-0}" = "1" ]; then
  echo "WARN  denylist not found, continuing because SCAN_ALLOW_NO_DENYLIST=1"
else
  fail denylist "not found: $DENYLIST (set SCAN_DENYLIST, or SCAN_ALLOW_NO_DENYLIST=1 to skip)"
fi

# --- 3. gitleaks (optional) ---------------------------------------------------------
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks dir . --redact >/dev/null 2>&1 || gitleaks detect --no-git --source . --redact >/dev/null 2>&1; then
    echo "ok    gitleaks"
  else
    fail gitleaks "gitleaks reported findings (run: gitleaks dir . --redact -v)"
  fi
else
  echo "NOTE  gitleaks not installed (brew install gitleaks). Run it before going public."
fi

# --- README images that point to a file that does not exist yet ---------------------
# A warning on every commit; a hard failure with SCAN_STRICT=1 (use that right before going public).
find . -name '*.md' -not -path '*/node_modules/*' -not -path './.git/*' -print0 | while IFS= read -r -d '' f; do
  grep -oE '!\[[^]]*\]\([^)]+\)' "$f" | sed -E 's/.*\(([^)]+)\)/\1/' | while IFS= read -r ref; do
    case "$ref" in http*) continue ;; esac
    if [ ! -f "$(dirname "$f")/$ref" ]; then
      if [ "${SCAN_STRICT:-0}" = "1" ]; then fail missing-image "$f -> $ref"; else echo "WARN  missing image: $f -> $ref (add it before going public; SCAN_STRICT=1 enforces this)"; fi
    fi
  done
done

# --- images need human eyes ---------------------------------------------------------
IMGS="$(find . -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.gif' -o -name '*.webp' \) -not -path './.git/*')"
if [ -n "$IMGS" ]; then
  echo "NOTE  images to review by eye (names, emails, IDs, URLs in the picture):"
  echo "$IMGS" | sed 's/^/        /'
fi

if [ ! -s "$FINDINGS" ]; then
  echo "CLEAN: no findings."
  exit 0
fi
echo "BLOCKED: fix the findings above before committing or publishing."
exit 1
