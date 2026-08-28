#!/bin/bash
#
# Anomalia CLI Installer
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash              # Install
#   curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash -s -- --update  # Update
#
# Options:
#   --version <ver>   Install a specific version (default: latest)
#   --dir <path>      Install directory (default: /usr/local/bin)
#   --no-sudo         Skip sudo prompt (install to ~/.local/bin)
#   --update          Update existing installation
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────

REPO="anomaliaso/anomalia"  # GitHub org/repo
BINARY_NAME="anomalia"
DEFAULT_DIR="/usr/local/bin"
FALLBACK_DIR="$HOME/.local/bin"
VERSION="latest"

# ── Colors ─────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ────────────────────────────────────────────────────────────

info()    { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1" >&2; }
fatal()   { error "$1"; exit 1; }

# ── Detect platform ───────────────────────────────────────────────────

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Darwin*)  os="macos" ;;
    Linux*)   os="linux" ;;
    *)        fatal "Unsupported OS: $(uname -s). Only macOS and Linux are supported." ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)             fatal "Unsupported architecture: $(uname -m)" ;;
  esac

  echo "${os}-${arch}"
}

# ── Parse args ─────────────────────────────────────────────────────────

INSTALL_DIR=""
NO_SUDO=false
UPDATE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --version)  VERSION="$2"; shift 2 ;;
    --dir)      INSTALL_DIR="$2"; shift 2 ;;
    --no-sudo)  NO_SUDO=true; shift ;;
    --update)   UPDATE=true; shift ;;
    -h|--help)
      echo "Usage: curl -sSL https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/scripts/install.sh | bash"
      echo ""
      echo "Options:"
      echo "  --version <ver>   Install a specific version"
      echo "  --dir <path>      Install directory (default: /usr/local/bin)"
      echo "  --no-sudo         Install to ~/.local/bin (no sudo needed)"
      echo "  --update          Update existing installation"
      exit 0
      ;;
    *)  warn "Unknown option: $1"; shift ;;
  esac
done

# ── Main ───────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Anomalia CLI Installer${NC}"
echo ""

# Detect platform
PLATFORM="$(detect_platform)"
info "Platform: ${PLATFORM}"

# Update mode — find existing installation
if [[ "$UPDATE" == true ]]; then
  EXISTING="$(which anomalia 2>/dev/null || true)"
  if [[ -n "$EXISTING" ]]; then
    INSTALL_DIR="$(dirname "$EXISTING")"
    CURRENT_VERSION="$($EXISTING --version 2>/dev/null || echo 'unknown')"
    info "Found existing installation: $EXISTING (v${CURRENT_VERSION})"
    info "Updating in $INSTALL_DIR..."
  else
    warn "anomalia not found in PATH. Installing fresh."
    UPDATE=false
  fi
fi

# Determine install dir
if [[ -z "$INSTALL_DIR" ]]; then
  if [[ "$NO_SUDO" == true ]]; then
    INSTALL_DIR="$FALLBACK_DIR"
  else
    INSTALL_DIR="$DEFAULT_DIR"
  fi
fi

# Check if directory is writable
if [[ ! -d "$INSTALL_DIR" ]]; then
  info "Creating $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR" 2>/dev/null || {
    warn "Cannot create $INSTALL_DIR. Falling back to $FALLBACK_DIR"
    INSTALL_DIR="$FALLBACK_DIR"
    mkdir -p "$INSTALL_DIR"
  }
fi

# Check write permission
if [[ ! -w "$INSTALL_DIR" ]]; then
  warn "Need sudo to write to $INSTALL_DIR"
  SUDO="sudo"
else
  SUDO=""
fi

# Determine download URL
if [[ "$VERSION" == "latest" ]]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/anomalia-${PLATFORM}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/anomalia-${PLATFORM}"
fi

info "Downloading Anomalia CLI..."
info "URL: ${DOWNLOAD_URL}"

# Download
TEMP_FILE="$(mktemp)"
if command -v curl &> /dev/null; then
  curl -sSL -o "$TEMP_FILE" "$DOWNLOAD_URL" || fatal "Download failed"
elif command -v wget &> /dev/null; then
  wget -qO "$TEMP_FILE" "$DOWNLOAD_URL" || fatal "Download failed"
else
  fatal "Neither curl nor wget found. Please install one."
fi

# Verify download
FILE_SIZE="$(wc -c < "$TEMP_FILE" | tr -d ' ')"
if [[ "$FILE_SIZE" -lt 1000 ]]; then
  error "Downloaded file is too small ($FILE_SIZE bytes). Release may not exist for $PLATFORM."
  cat "$TEMP_FILE"
  rm -f "$TEMP_FILE"
  fatal "Download verification failed"
fi

# Make executable
chmod +x "$TEMP_FILE"

# Install
info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
$SUDO mv "$TEMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}" || fatal "Installation failed"

success "Anomalia CLI installed to ${INSTALL_DIR}/${BINARY_NAME}"

# Install AI skill (ask user)
echo ""
read -p "  Installare la skill per AI coding assistants? [Y/n]: " install_skill
if [[ "$install_skill" != "n" && "$install_skill" != "N" ]]; then
  echo ""
  echo "  1) Progetto corrente (.claude/skills/, .cursorrules, etc.)"
  echo "  2) Globale (~/.claude/skills/)"
  read -p "  Scelta [1/2]: " skill_choice
  echo ""

  SKILL_URL="https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/skills/anomalia-cli.md"

  if [[ "$skill_choice" == "2" ]]; then
    # Global install
    CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
    mkdir -p "$CLAUDE_SKILLS_DIR"
    curl -sSL "$SKILL_URL" -o "$CLAUDE_SKILLS_DIR/anomalia-cli.md" 2>/dev/null && \
      success "Skill installata globalmente → $CLAUDE_SKILLS_DIR/anomalia-cli.md" || \
      warn "Could not install skill (non-critical)"
  else
    # Project install
    mkdir -p ".claude/skills"
    curl -sSL "$SKILL_URL" -o ".claude/skills/anomalia-cli.md" 2>/dev/null && \
      success "Skill installata nel progetto → .claude/skills/anomalia-cli.md" || \
      warn "Could not install skill (non-critical)"

    # Also install for Cursor if .cursor exists
    if [[ -d ".cursor" ]] || command -v cursor &> /dev/null; then
      curl -sSL "$SKILL_URL" -o ".cursorrules" 2>/dev/null && \
        success "Cursor rules installato → .cursorrules" || true
    fi

    # Also install llms.txt
    curl -sSL "https://raw.githubusercontent.com/anomaliaso/anomalia/main/cli/llms.txt" -o "llms.txt" 2>/dev/null && \
      success "llms.txt installato" || true
  fi
fi

# Check if in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  warn "${INSTALL_DIR} is not in your PATH"
  echo ""
  echo "  Add it to your shell profile:"
  echo ""
  if [[ "$SHELL" == */zsh ]]; then
    echo "    echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc"
    echo "    source ~/.zshrc"
  elif [[ "$SHELL" == */bash ]]; then
    echo "    echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.bashrc"
    echo "    source ~/.bashrc"
  else
    echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
  fi
  echo ""
fi

# Verify installation
echo ""
if command -v anomalia &> /dev/null; then
  NEW_VERSION="$(anomalia --version 2>/dev/null || echo 'unknown')"
  if [[ "$UPDATE" == true ]]; then
    success "Anomalia CLI updated! (v${CURRENT_VERSION} → v${NEW_VERSION})"
  else
    success "Anomalia CLI installed! (v${NEW_VERSION})"
  fi
  echo ""
  echo "  Run 'anomalia --help' to get started"
  echo "  Run 'anomalia update' to update to the latest version"
else
  info "Installation complete! You may need to restart your terminal."
  echo ""
  echo "  Run '${INSTALL_DIR}/anomalia --help' to get started"
fi

echo ""
