#!/usr/bin/env bash
set -euo pipefail

# Usage: curl -fsSL https://raw.githubusercontent.com/saiyameh/project-layman/master/install.sh | bash
REPO_URL="https://github.com/saiyameh/project-layman.git"
INSTALL_DIR="${LAYMAN_INSTALL_DIR:-$HOME/.layman-src}"
BOLD='\033[1m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { printf '  %b[i]%b %s\n' "$CYAN" "$RESET" "$1"; }
success() { printf '  %b[OK]%b %s\n' "$GREEN" "$RESET" "$1"; }
warn()    { printf '  %b[!]%b %s\n' "$YELLOW" "$RESET" "$1"; }
fail()    { printf '  %b[ERR]%b %s\n' "$RED" "$RESET" "$1"; exit 1; }

printf '\n%b' "$YELLOW"
cat <<'BANNER'
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠛⠲⠦⠤⣄⣀⠀⢀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣀⠀⠀⠀⠀⠀⠘⠿⠟⠀⢤⠀⣠⣤⣄⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⡆⠀⠀⠀⠀⢰⡖⠀⠀⠀⠀⠙⠿⠿⠓⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⠃⠀⠀⠀⠀⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⢀⣠⣤⣤⣤⣄⡉⠁⣠⡄⢀⣀⣼⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⣰⣿⣿⠟⣿⣿⡿⠁⣴⣿⠁⡸⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⢰⡿⠋⠀⢰⠿⠋⡀⢈⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⣿⡇⠀⠀⠠⠴⣾⣿⣿⣯⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠉⠁⠀⠀⢀⣀⣼⣿⡿⠿⠿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⠛⣿⠿⣄⠀⢠⣾⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢀⣿⠀⠁⠀⠁⠀⠀⠉⢿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⢀⣤⣤⣤⣤⣾⡿⠃⠀⠀⠀⠀⠀⠀⠘⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
BANNER
printf '%b%b          PROJECT LAYMAN UGH.%b\n\n' "$RESET" "$BOLD" "$RESET"

[[ "$INSTALL_DIR" == /* ]] || fail 'LAYMAN_INSTALL_DIR must be an absolute folder path.'
for command in git node npm; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is missing. Install Node.js 18 or later, npm, and Git."
done
NODE_VERSION=$(node --version)
if [[ ! "$NODE_VERSION" =~ ^v([0-9]+)\. ]] || (( BASH_REMATCH[1] < 18 )); then
  fail "Node.js 18 or later is required. Found: $NODE_VERSION"
fi
success "Node.js $NODE_VERSION"

if [[ -e "$INSTALL_DIR" ]]; then
  [[ -d "$INSTALL_DIR" ]] || fail "The install path is not a folder: $INSTALL_DIR"
  cd "$INSTALL_DIR"
  ROOT=$(git rev-parse --show-toplevel) || fail 'The install folder is not a Git repository. Preserve it and choose another folder.'
  [[ "$ROOT" == "$(pwd -P)" ]] || fail 'The install folder is not a repository root. Preserve it and choose another folder.'
  ORIGIN=$(git remote get-url origin) || fail 'The install repository has no origin. Restore its source URL.'
  [[ "$ORIGIN" == "$REPO_URL" ]] || fail 'The install folder belongs to another source. Preserve it and choose another folder.'
  STATUS=$(git status --porcelain) || fail 'Cannot read the install worktree. Preserve it and inspect Git state.'
  [[ -z "$STATUS" ]] || fail 'The install repository has local changes. Preserve them before updating.'
  BRANCH=$(git symbolic-ref --quiet --short HEAD) || fail 'The install repository has a detached HEAD. Check out its tracked branch.'
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}') || fail 'The install branch has no tracked upstream. Restore it before updating.'
  [[ "$UPSTREAM" == "origin/$BRANCH" ]] || fail 'The install branch tracks another source branch. Restore its upstream before updating.'
  info 'Update the installed source.'
  git pull --ff-only || fail 'Update failed. Preserve local work and fix Git access or branch divergence.'
  success 'Source updated.'
else
  info "Clone Layman to $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" || fail 'Clone failed. Check Git access and the install folder.'
fi

cd "$INSTALL_DIR"
info 'Install the locked dependencies.'
npm ci --include=dev || fail 'Dependency installation failed. Fix the reported error and run the installer again.'
info 'Build Layman.'
npm run build || fail 'Build failed. Fix the reported error before linking Layman.'
success 'Build complete.'

info 'Link the layman command.'
if npm link; then
  if command -v layman >/dev/null 2>&1; then
    success 'Layman is ready. Run: layman'
  else
    warn 'The link was created, but layman is not in PATH. Add the npm global bin folder to PATH.'
    printf '  Run directly: node %q\n' "$INSTALL_DIR/dist/index.js"
  fi
else
  warn 'Global link failed. Check npm permissions. The built app remains available.'
  printf '  Run directly: node %q\n' "$INSTALL_DIR/dist/index.js"
fi
