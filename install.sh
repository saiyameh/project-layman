#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# Project Layman — Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/saiyameh/project-layman/master/install.sh | bash
# --------------------------------------------------

REPO_URL="https://github.com/saiyameh/project-layman.git"
INSTALL_DIR="$HOME/.layman-src"
BOLD="\033[1m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
CYAN="\033[0;36m"
DIM="\033[2m"
RESET="\033[0m"

banner() {
  echo ""
  echo -e "${YELLOW}${BOLD}"
  cat << 'BANNER'
  _        _  __   __ __  __     _    _   _ 
 | |      / \ \ \ / /|  \/  |   / \  | \ | |
 | |     / _ \ \ V / | |\/| |  / _ \ |  \| |
 | |___ / ___ \ | |  | |  | | / ___ \| |\  |
 |_____/_/   \_\|_|  |_|  |_|/_/   \_\_| \_|
BANNER
  echo -e "${RESET}"
  echo -e "${BOLD}          PROJECT LAYMAN UGH.${RESET}"
  echo ""
}

info()    { echo -e "  ${CYAN}[i]${RESET} $1"; }
success() { echo -e "  ${GREEN}[OK]${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}[!]${RESET} $1"; }
fail()    { echo -e "  ${RED}[ERR]${RESET} $1"; exit 1; }

check_command() {
  if ! command -v "$1" &>/dev/null; then
    return 1
  fi
  return 0
}

get_node_major_version() {
  node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

# --------------------------------------------------
# Start
# --------------------------------------------------
banner

echo -e "${BOLD}Checking prerequisites...${RESET}"
echo ""

# Check git
if check_command git; then
  success "git $(git --version | awk '{print $3}')"
else
  fail "git is not installed. Install it first: https://git-scm.com"
fi

# Check Node.js
if check_command node; then
  NODE_VERSION=$(get_node_major_version)
  if [ "$NODE_VERSION" -lt 18 ]; then
    fail "Node.js v18+ required (found v$(node --version | sed 's/^v//')). Update: https://nodejs.org"
  fi
  success "Node.js $(node --version)"
else
  fail "Node.js is not installed. Install v18+: https://nodejs.org"
fi

# Check npm
if check_command npm; then
  success "npm $(npm --version)"
else
  fail "npm is not installed. It should come with Node.js."
fi

echo ""

# --------------------------------------------------
# Clone or update
# --------------------------------------------------
if [ -d "$INSTALL_DIR" ]; then
  info "Existing installation found at $INSTALL_DIR"
  info "Pulling latest changes..."
  cd "$INSTALL_DIR"
  git pull --quiet origin main 2>/dev/null || git pull --quiet 2>/dev/null || true
  success "Updated to latest version"
else
  info "Cloning project-layman..."
  git clone --quiet --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    # If git clone fails (repo doesn't exist yet), try local copy
    if [ -d "$(dirname "$0")" ] && [ -f "$(dirname "$0")/package.json" ]; then
      SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
      cp -r "$SCRIPT_DIR" "$INSTALL_DIR"
      success "Copied from local source"
    else
      fail "Could not clone repository. Check the URL and your internet connection."
    fi
  }
  success "Cloned to $INSTALL_DIR"
fi

# --------------------------------------------------
# Install dependencies
# --------------------------------------------------
echo ""
info "Installing dependencies..."
cd "$INSTALL_DIR"
npm install --silent 2>/dev/null
success "Dependencies installed"

# --------------------------------------------------
# Build
# --------------------------------------------------
info "Building project..."
npm run build --silent 2>/dev/null
success "Build complete"

# --------------------------------------------------
# Link globally
# --------------------------------------------------
info "Linking 'layman' command globally..."
npm link --silent 2>/dev/null || {
  warn "Global link failed (may need sudo). Trying with sudo..."
  sudo npm link --silent 2>/dev/null || {
    warn "Could not link globally. You can still run: npm run dev (from $INSTALL_DIR)"
  }
}

# Verify installation
if check_command layman; then
  success "'layman' command is now available globally"
else
  warn "'layman' not found in PATH. You may need to restart your terminal."
  info "Or run directly: cd $INSTALL_DIR && npm run dev"
fi

# --------------------------------------------------
# Done
# --------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}  UGH. LAYMAN INSTALLED. GOOD.${RESET}"
echo ""
echo -e "${DIM}  Source:  $INSTALL_DIR${RESET}"
echo -e "${DIM}  Run:     layman${RESET}"
echo -e "${DIM}  Reset:   layman --reset${RESET}"
echo -e "${DIM}  Help:    layman --help${RESET}"
echo ""

# --------------------------------------------------
# Offer to run immediately
# --------------------------------------------------
read -rp "  Run layman now? [Y/n] " RUN_NOW
RUN_NOW=${RUN_NOW:-Y}

if [[ "$RUN_NOW" =~ ^[Yy]$ ]]; then
  echo ""
  if check_command layman; then
    exec layman
  else
    exec npm run dev --prefix "$INSTALL_DIR"
  fi
fi
