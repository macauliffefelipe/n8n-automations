#!/usr/bin/env bash
# Installs a git pre-commit hook that runs scripts/scan.sh and blocks the
# commit if anything is found. Works with GitHub Desktop too.
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/.git/hooks/pre-commit"
cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
exec "$(git rev-parse --show-toplevel)/scripts/scan.sh"
EOF
chmod +x "$HOOK"
echo "Installed pre-commit hook: $HOOK"
