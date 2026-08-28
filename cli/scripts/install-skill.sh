#!/bin/bash
#
# Install Anomalia CLI skill for ALL AI coding assistants
#
# Supported tools:
#   Claude Code, Cursor, GitHub Copilot, Windsurf, Cline,
#   Roo Code, Aider, OpenAI Codex, Mimo Code, Kimi Code,
#   Antigravity CLI, and any tool that reads AGENTS.md or llms.txt
#
# Usage:
#   curl -sSL https://anomalia.so/install-skill.sh | bash              # Interactive
#   curl -sSL https://anomalia.so/install-skill.sh | bash -s -- --global   # Global
#   curl -sSL https://anomalia.so/install-skill.sh | bash -s -- --project  # Current project
#

set -euo pipefail

# ── Colors ─────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }

# ── Skill content ──────────────────────────────────────────────────────

read_skill_content() {
  # Try to download from GitHub, fallback to embedded
  local url="https://raw.githubusercontent.com/andreabuttarelli/anomalia-cli/main/skills/anomalia-cli.md"
  local content
  content=$(curl -sSL "$url" 2>/dev/null) || true

  if [[ -z "$content" ]] || ! echo "$content" | grep -q "Anomalia Skill"; then
    # Embedded fallback (MCP + CLI)
    read -r -d '' content << 'SKILL_EOF' || true
# Anomalia Skill (MCP + CLI)

Prefer Anomalia MCP tools when connected; otherwise use the `anomalia` CLI.
OAuth only — session at ~/.config/anomalia/session.json. No static API tokens.

## MCP (preferred)

Stdio: bun run /path/to/anomalia-cli/mcp/stdio.ts
HTTP: https://mcp.anomalia.so/mcp (Bearer required remotely)
Start with list_brands / whoami. Use specific tools; chat for open-ended work.

## CLI quick reference

```bash
anomalia login
anomalia brands
anomalia dashboard <slug>
anomalia content <slug> --status pending_user
anomalia approve <slug> --all
anomalia post <slug> <id> edit --caption "..."
anomalia plan <slug> propose
anomalia weekly-plan <slug> plan --week 0
anomalia weekly-plan <slug> produce --week 0
anomalia studio <slug> add-note --text "..."
anomalia ai <slug> --message "..." --pipe
```

## Tips

- Prefer MCP tools over shell when the server is connected
- Use --pipe for machine-readable AI output
- Post IDs: short prefixes from list tables (never guess if ambiguous)
SKILL_EOF
  fi

  echo "$content"
}

install_cursor_skill() {
  local dest_dir="$1"
  local label="$2"
  local base="https://raw.githubusercontent.com/andreabuttarelli/anomalia-cli/main/skills/anomalia"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local local_skill=""

  # Prefer local package when installer runs from this repo
  if [[ -f "$script_dir/../skills/anomalia/SKILL.md" ]]; then
    local_skill="$script_dir/../skills/anomalia"
  elif [[ -f "./skills/anomalia/SKILL.md" ]]; then
    local_skill="./skills/anomalia"
  fi

  mkdir -p "$dest_dir/references"

  if [[ -n "$local_skill" ]]; then
    cp "$local_skill/SKILL.md" "$dest_dir/SKILL.md"
    if [[ -d "$local_skill/references" ]]; then
      cp -R "$local_skill/references/." "$dest_dir/references/"
    fi
    success "$label → $dest_dir/SKILL.md"
    return
  fi

  if curl -sSL "$base/SKILL.md" -o "$dest_dir/SKILL.md" 2>/dev/null && grep -q "name: anomalia" "$dest_dir/SKILL.md" 2>/dev/null; then
    for f in mcp.md tools.md cli.md; do
      curl -sSL "$base/references/$f" -o "$dest_dir/references/$f" 2>/dev/null || true
    done
    success "$label → $dest_dir/SKILL.md"
  else
    {
      echo '---'
      echo 'name: anomalia'
      echo 'description: Operate Anomalia via MCP tools or the anomalia CLI.'
      echo '---'
      echo ''
      echo "$SKILL_CONTENT"
    } > "$dest_dir/SKILL.md"
    success "$label (fallback) → $dest_dir/SKILL.md"
  fi
}

# ── Parse args ─────────────────────────────────────────────────────────

MODE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --global)   MODE="global"; shift ;;
    --project)  MODE="project"; shift ;;
    -h|--help)
      echo "Usage: curl -sSL https://anomalia.so/install-skill.sh | bash"
      echo ""
      echo "Options:"
      echo "  --global    Install globally (~/.claude/skills/ + ~/.cursor/skills/)"
      echo "  --project   Install in current project (all tools)"
      echo ""
      echo "Publishable skill (skills.sh / npx skills):"
      echo "  npx skills add andreabuttarelli/anomalia-cli --skill anomalia"
      echo ""
      echo "Supported tools:"
      echo "  Claude Code, Cursor, GitHub Copilot, Windsurf, Cline,"
      echo "  Roo Code, Aider, OpenAI Codex, Mimo Code, Kimi Code,"
      echo "  Antigravity CLI, and any tool that reads AGENTS.md"
      exit 0
      ;;
    *)  shift ;;
  esac
done

# ── Install function ───────────────────────────────────────────────────

install_file() {
  local target="$1"
  local label="$2"
  local dir
  dir=$(dirname "$target")

  mkdir -p "$dir"

  # If file exists and already has our content, skip
  if [[ -f "$target" ]] && grep -qE "Anomalia (CLI|Skill)" "$target" 2>/dev/null; then
    info "$label già configurato"
    return
  fi

  # If file exists, append (don't overwrite user content)
  if [[ -f "$target" ]]; then
    echo "" >> "$target"
    echo "$SKILL_CONTENT" >> "$target"
    success "$label aggiornato → $target"
  else
    echo "$SKILL_CONTENT" > "$target"
    success "$label creato → $target"
  fi
}

# ── Main ───────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Anomalia CLI — AI Skill Installer${NC}"
echo ""

# Ask mode if not specified
if [[ -z "$MODE" ]]; then
  echo "  Dove vuoi installare la skill?"
  echo ""
  echo "  1) Progetto corrente (tutti i tool)"
  echo "  2) Globale (~/.claude/skills/)"
  echo ""
  read -p "  Scelta [1/2]: " choice
  case "$choice" in
    2) MODE="global" ;;
    *) MODE="project" ;;
  esac
  echo ""
fi

# Load skill content
info "Caricamento skill..."
SKILL_CONTENT=$(read_skill_content)

if [[ -z "$SKILL_CONTENT" ]]; then
  echo -e "${RED}✗${NC} Impossibile caricare la skill"
  exit 1
fi

info "Modalità: $MODE"
echo ""

# ── Install ────────────────────────────────────────────────────────────

if [[ "$MODE" == "global" ]]; then
  # Global: Claude Code + Cursor Agent Skills
  install_file "$HOME/.claude/skills/anomalia-cli.md" "Claude Code (globale)"
  install_cursor_skill "$HOME/.cursor/skills/anomalia" "Cursor Agent Skill (globale)"
else
  # Project: all tools

  # Claude Code (uses CLAUDE.md which is auto-read)
  install_file "CLAUDE.md" "Claude Code (CLAUDE.md)"
  install_file ".claude/skills/anomalia-cli.md" "Claude Code skill file"

  # Cursor (legacy rules + Agent Skills)
  install_file ".cursorrules" "Cursor (.cursorrules)"
  install_cursor_skill ".cursor/skills/anomalia" "Cursor Agent Skill"

  # GitHub Copilot
  install_file ".github/copilot-instructions.md" "GitHub Copilot"

  # Windsurf (Codeium)
  install_file ".windsurfrules" "Windsurf"

  # Cline (VS Code extension)
  install_file ".clinerules" "Cline"

  # Roo Code
  install_file ".roomodes" "Roo Code"

  # Aider
  if [[ -f ".aider.conf.yml" ]]; then
    if ! grep -qE "Anomalia (CLI|Skill)" ".aider.conf.yml" 2>/dev/null; then
      echo "" >> ".aider.conf.yml"
      echo "# Anomalia Skill" >> ".aider.conf.yml"
      echo "$SKILL_CONTENT" >> ".aider.conf.yml"
      success "Aider aggiornato → .aider.conf.yml"
    else
      info "Aider già configurato"
    fi
  else
    # Aider uses YAML, create a proper file
    cat > ".aider.conf.yml" << AIDER_EOF
# Anomalia Skill instructions
# See: https://anomalia.so
AIDER_EOF
    echo "$SKILL_CONTENT" >> ".aider.conf.yml"
    success "Aider creato → .aider.conf.yml"
  fi

  # AGENTS.md (OpenAI Codex, Mimo Code, Kimi Code, Antigravity, generic)
  install_file "AGENTS.md" "AGENTS.md (Codex/Mimo/Kimi/Antigravity)"

  # llms.txt (universal standard)
  if [[ ! -f "llms.txt" ]]; then
    curl -sSL "https://raw.githubusercontent.com/andreabuttarelli/anomalia-cli/main/llms.txt" -o "llms.txt" 2>/dev/null && \
      success "llms.txt creato" || true
  else
    info "llms.txt già esistente"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────

echo ""
success "Skill installata!"
echo ""

if [[ "$MODE" == "project" ]]; then
  echo "  File installati:"
  [[ -f ".claude/skills/anomalia-cli.md" ]] && echo "    • .claude/skills/anomalia-cli.md  (Claude Code)"
  [[ -f ".cursor/skills/anomalia/SKILL.md" ]] && echo "    • .cursor/skills/anomalia/SKILL.md  (Cursor Agent Skill)"
  [[ -f ".cursorrules" ]] && echo "    • .cursorrules                (Cursor)"
  [[ -f ".github/copilot-instructions.md" ]] && echo "    • .github/copilot-instructions.md  (Copilot)"
  [[ -f ".windsurfrules" ]] && echo "    • .windsurfrules              (Windsurf)"
  [[ -f ".clinerules" ]] && echo "    • .clinerules                 (Cline)"
  [[ -f ".roomodes" ]] && echo "    • .roomodes                   (Roo Code)"
  [[ -f ".aider.conf.yml" ]] && echo "    • .aider.conf.yml             (Aider)"
  [[ -f "AGENTS.md" ]] && echo "    • AGENTS.md                   (Codex/Mimo/Kimi)"
  [[ -f "llms.txt" ]] && echo "    • llms.txt                    (universal)"
fi

echo ""
echo "  Ora puoi dire alla tua AI:"
echo -e "  ${BOLD}\"Usa Anomalia MCP (o la CLI) per elencare i brand\"${NC}"
echo ""
echo "  Cursor Agent Skill: skills/anomalia/SKILL.md"
echo "  Directory install:  npx skills add andreabuttarelli/anomalia-cli --skill anomalia"
echo "  Docs MCP: https://github.com/andreabuttarelli/anomalia-cli/blob/main/docs/mcp.md"
echo ""
