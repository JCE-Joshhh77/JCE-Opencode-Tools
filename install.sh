#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# OpenCode JCE — Installer
# One command to install everything you need for OpenCode CLI
# ═══════════════════════════════════════════════════════════════

VERSION="3.8.27"
REPO_URL="https://github.com/JCETools-Petra/JCE-Opencode-Tools.git"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencode-jce-install.XXXXXXXXXX")"
# CONFIG_DIR is set by detect_opencode_config() in main()

# Cleanup on exit/interrupt
trap '[ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR" 2>/dev/null' EXIT INT TERM

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Status tracking
GIT_STATUS="skip"
BUN_STATUS="skip"
OPENCODE_STATUS="skip"
LSP_INSTALLED=0

# ─── Helper Functions ─────────────────────────────────────────

print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════╗"
    echo "║      OpenCode JCE Installer v${VERSION}     ║"
    echo "╠══════════════════════════════════════════╣"
    echo "║  Installing: Git, Bun, OpenCode CLI     ║"
    echo "║  Configuring: Agents, Profiles, MCP, LSP║"
    echo "╚══════════════════════════════════════════╝"
    echo -e "${NC}"
}

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; }

offer_factory_droid_install() {
    local factory_dir="$1"
    if ! command -v droid &>/dev/null; then
        warn "Droid CLI not found. Factory Droid plugin install cancelled."
        info "Install Factory Droid first, then rerun this installer or 'opencode-jce update':"
        info "  curl -fsSL https://app.factory.ai/cli | sh"
        info "Alternative: npm install -g droid"
        return
    fi

    info "Installing/updating Factory Droid plugin..."
    droid plugin marketplace add "${factory_dir}" \
        || warn "Droid marketplace add failed or already exists; continuing."
    local plugin_id="jce-opencode-tools@$(basename "$factory_dir")"
    if droid plugin install "$plugin_id"; then
        success "Factory Droid plugin installed/updated."
    else
        warn "Factory Droid plugin install failed or already exists; trying update."
        droid plugin update "$plugin_id" \
            && success "Factory Droid plugin already installed; updated existing install." \
            || warn "Factory Droid plugin update failed. Run: droid plugin update $plugin_id"
    fi
}

ensure_fish_bun_path() {
    local bun_bin="${HOME}/.bun/bin"
    local fish_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/fish"
    local fish_config="${fish_config_dir}/config.fish"
    local marker="# OpenCode JCE: Bun global bin"

    if ! command -v fish &>/dev/null && [ ! -d "$fish_config_dir" ]; then
        return
    fi

    mkdir -p "$fish_config_dir"
    touch "$fish_config"

    if grep -Fq "$marker" "$fish_config" || grep -Fq "set -gx PATH \"$bun_bin\" \$PATH" "$fish_config"; then
        return
    fi

    cat >> "$fish_config" <<EOF

$marker
if not contains "$bun_bin" \$PATH
    set -gx PATH "$bun_bin" \$PATH
end
EOF
    success "Fish PATH configured: $bun_bin"
}

detect_opencode_config() {
    info "Detecting OpenCode config directory..."

    # Candidate paths in priority order
    local candidates=()

    # 1. XDG_CONFIG_HOME (if set)
    if [ -n "${XDG_CONFIG_HOME:-}" ]; then
        candidates+=("${XDG_CONFIG_HOME}/opencode")
    fi

    # 2. ~/.config/opencode (standard on all platforms)
    candidates+=("$HOME/.config/opencode")

    # 3. macOS: ~/Library/Application Support/opencode (some tools use this)
    if [ "$(uname -s)" = "Darwin" ]; then
        candidates+=("$HOME/Library/Application Support/opencode")
    fi

    # Search for existing OpenCode config (opencode.json is the marker)
    for path in "${candidates[@]}"; do
        if [ -f "$path/opencode.json" ]; then
            success "Found OpenCode config at: $path"
            CONFIG_DIR="$path"
            return
        fi
    done

    # Default: ~/.config/opencode/ (OpenCode standard)
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
    info "No existing config found. Using default: $CONFIG_DIR"
}

backup_existing_config() {
    if [ ! -d "$CONFIG_DIR" ]; then return; fi

    # Check if there's anything worth backing up
    if ! find "$CONFIG_DIR" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then return; fi

    local timestamp
    timestamp=$(date +%Y-%m-%d_%H%M%S)
    local backup_dir="${CONFIG_DIR}.backup.${timestamp}"
    local backup_index=1
    while [ -e "$backup_dir" ]; do
        backup_dir="${CONFIG_DIR}.backup.${timestamp}.${backup_index}"
        backup_index=$((backup_index + 1))
    done

    info "Backing up existing config to: $backup_dir"
    if cp -r "$CONFIG_DIR" "$backup_dir" 2>/dev/null; then
        success "Backup created: $backup_dir"
    else
        error "Backup failed. Aborting to protect existing config."
    fi
}

detect_os() {
    case "$(uname -s)" in
        Linux*)  OS="linux";;
        Darwin*) OS="macos";;
        MINGW*|MSYS*|CYGWIN*) 
            echo -e "${YELLOW}Detected Windows via Git Bash/MSYS.${NC}"
            echo "Please use PowerShell instead:"
            echo -e "${CYAN}  irm https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.ps1 | iex${NC}"
            exit 0
            ;;
        *) error "Unsupported OS: $(uname -s)";;
    esac

    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64) ARCH="x64";;
        aarch64|arm64) ARCH="arm64";;
        *) error "Unsupported architecture: $ARCH";;
    esac

    info "Detected: ${OS} (${ARCH})"
}

detect_package_manager() {
    if [ "$OS" = "macos" ]; then
        if command -v brew &>/dev/null; then
            PKG_MGR="brew"
        else
            PKG_MGR="none"
        fi
    elif [ "$OS" = "linux" ]; then
        if command -v apt-get &>/dev/null; then
            PKG_MGR="apt"
        elif command -v dnf &>/dev/null; then
            PKG_MGR="dnf"
        elif command -v pacman &>/dev/null; then
            PKG_MGR="pacman"
        else
            PKG_MGR="none"
        fi
    fi
    info "Package manager: ${PKG_MGR}"
}

verify_jce_cli_payload() {
    local dir="$1"
    local manifest="$TEMP_DIR/config/cli-payload.txt"
    [ -f "$manifest" ] || error "CLI payload manifest missing: $manifest"
    local missing=()
    local file
    while IFS= read -r file || [ -n "$file" ]; do
        [ -n "$file" ] || continue
        case "$file" in \#*) continue ;; esac
        [ -f "$dir/$file" ] || missing+=("$file")
    done < "$manifest"
    if [ "${#missing[@]}" -gt 0 ]; then
        error "CLI payload is incomplete; missing: ${missing[*]}"
    fi
}

terminate_stale_opencode_processes() {
    [ "${OPENCODE_JCE_SKIP_PROCESS_CLEANUP:-}" = "1" ] && return 0
    command -v ps >/dev/null 2>&1 || return 0
    local current_pid="$$"
    local pids=()
    while IFS= read -r line; do
        local pid command
        pid="$(printf '%s' "$line" | awk '{print $1}')"
        command="$(printf '%s' "$line" | cut -d' ' -f3-)"
        [ -n "$pid" ] || continue
        [ "$pid" = "$current_pid" ] && continue
        printf '%s' "$command" | grep -Eq 'opencode-jce(.cmd|.ps1|.exe)? .*update|src/index\.ts .*update' && continue
        if printf '%s' "$command" | grep -Eq '(^|[ /])opencode( |$)|\.config/opencode/cli/src/(plugin/index|mcp/context-keeper)\.ts'; then
            pids+=("$pid")
        fi
    done < <(ps -axo pid=,ppid=,command= 2>/dev/null || true)
    if [ "${#pids[@]}" -gt 0 ]; then
        kill -TERM "${pids[@]}" 2>/dev/null || true
        warn "Stopped ${#pids[@]} stale OpenCode process(es) so the updated plugin/CLI is loaded next run."
    fi
}

# ─── Installation Steps ──────────────────────────────────────

install_git() {
    info "Checking Git..."
    if command -v git &>/dev/null; then
        local ver=$(git --version | awk '{print $3}')
        skip "Git v${ver} already installed"
        GIT_STATUS="skip"
        return
    fi

    info "Installing Git..."
    case "$PKG_MGR" in
        brew)   brew install git;;
        apt)    sudo apt-get update && sudo apt-get install -y git;;
        dnf)    sudo dnf install -y git;;
        pacman) sudo pacman -S --noconfirm git;;
        none)
            if [ "$OS" = "macos" ]; then
                info "Installing Xcode Command Line Tools (includes Git)..."
                xcode-select --install 2>/dev/null || true
                warn "Please complete the Xcode CLT installation popup, then re-run this script."
                exit 0
            else
                error "No package manager found. Please install Git manually."
            fi
            ;;
    esac

    if command -v git &>/dev/null; then
        success "Git installed: $(git --version | awk '{print $3}')"
        GIT_STATUS="installed"
    else
        error "Git installation failed"
    fi
}

install_bun() {
    info "Checking Bun..."
    if command -v bun &>/dev/null; then
        local ver=$(bun --version)
        skip "Bun v${ver} already installed"
        BUN_STATUS="skip"
        return
    fi

    if [ "${OPENCODE_JCE_ALLOW_UNVERIFIED_DOWNLOAD:-}" != "1" ]; then
        error "Bun auto-install is disabled because bun.sh/install has no pinned checksum. Install Bun manually from https://bun.sh/docs/installation or rerun with OPENCODE_JCE_ALLOW_UNVERIFIED_DOWNLOAD=1."
    fi

    info "Installing Bun..."
    local bun_installer="${TEMP_DIR}.bun-install.sh"
    curl -fsSL https://bun.sh/install -o "$bun_installer"
    bash "$bun_installer"

    # Source the updated profile to get bun in PATH
    export BUN_INSTALL="${HOME}/.bun"
    export PATH="${BUN_INSTALL}/bin:${PATH}"
    ensure_fish_bun_path

    if command -v bun &>/dev/null; then
        success "Bun installed: v$(bun --version)"
        BUN_STATUS="installed"
    else
        error "Bun installation failed. Please restart your terminal and re-run."
    fi
}

install_opencode() {
    info "Checking OpenCode CLI..."
    if command -v opencode &>/dev/null; then
        skip "OpenCode CLI already installed"
        OPENCODE_STATUS="skip"
        return
    fi

    info "Installing OpenCode CLI..."
    bun install -g opencode || true
    ensure_fish_bun_path

    if command -v opencode &>/dev/null; then
        success "OpenCode CLI installed"
        OPENCODE_STATUS="installed"
    else
        # Try adding bun global bin to PATH
        export PATH="${HOME}/.bun/bin:${PATH}"
        if command -v opencode &>/dev/null; then
            success "OpenCode CLI installed"
            OPENCODE_STATUS="installed"
        else
            error "OpenCode CLI installation failed"
        fi
    fi
}

download_repo_tarball() {
    local archive="${TEMP_DIR}.tar.gz"
    local extract_dir="${TEMP_DIR}.extract"

    rm -rf "$archive" "$extract_dir"
    mkdir -p "$extract_dir"
    if [ "${OPENCODE_JCE_ALLOW_UNVERIFIED_TARBALL:-}" != "1" ]; then
        return 1
    fi
    warn "Using unverified release tarball fallback because OPENCODE_JCE_ALLOW_UNVERIFIED_TARBALL=1. Prefer git clone/tag verification."
    curl -fsSL "https://github.com/JCETools-Petra/JCE-Opencode-Tools/archive/refs/tags/v${VERSION}.tar.gz" -o "$archive" || return 1
    tar -xzf "$archive" -C "$extract_dir" || return 1

    local extracted
    extracted=$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d -print -quit)
    [ -n "$extracted" ] || return 1
    case "$(basename "$extracted")" in
        JCE-Opencode-Tools-*) ;;
        *) return 1 ;;
    esac
    [ -f "$extracted/package.json" ] || return 1
    [ -f "$extracted/src/index.ts" ] || return 1
    [ -d "$extracted/config" ] || return 1
    mv "$extracted" "$TEMP_DIR" || return 1
    rm -rf "$archive" "$extract_dir"
}

deploy_config() {
    info "Deploying configuration..."

    # Clone config repo — try tag first, fallback to main branch
    rm -rf "$TEMP_DIR"
    if ! git clone --depth 1 --branch "v${VERSION}" "$REPO_URL" "$TEMP_DIR" 2>/dev/null; then
        info "Tag v${VERSION} not found, trying main branch..."
        rm -rf "$TEMP_DIR"
        if ! git clone --depth 1 --branch "main" "$REPO_URL" "$TEMP_DIR" 2>/dev/null; then
            warn "Main branch clone failed. Falling back to GitHub release archive download..."
            rm -rf "$TEMP_DIR"
            download_repo_tarball || error "Failed to download config repository. Check your internet connection."
        fi
    fi

    # Ensure config directory exists
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$CONFIG_DIR/profiles"

    # Merge configuration (preserves existing settings)
    info "Merging configuration (preserving existing settings)..."
    if ! bun run "$TEMP_DIR/scripts/merge-config.ts" "$TEMP_DIR/config" "$CONFIG_DIR" 2>/dev/null; then
        warn "merge-config.ts failed. Falling back to manual copy..."
        # Fallback: copy config files that don't exist
        for f in agents.json mcp.json lsp.json fallback.json; do
            if [ -f "$TEMP_DIR/config/$f" ] && [ ! -f "$CONFIG_DIR/$f" ]; then
                cp "$TEMP_DIR/config/$f" "$CONFIG_DIR/$f"
                success "  Created: $f"
            elif [ -f "$CONFIG_DIR/$f" ]; then
                skip "  Exists, preserved: $f"
            fi
        done
        # Copy profiles that don't exist
        if [ -d "$TEMP_DIR/config/profiles" ]; then
            mkdir -p "$CONFIG_DIR/profiles"
            for f in "$TEMP_DIR/config/profiles"/*.json; do
                [ -f "$f" ] || continue
                fname=$(basename "$f")
                if [ ! -f "$CONFIG_DIR/profiles/$fname" ]; then
                    cp "$f" "$CONFIG_DIR/profiles/$fname"
                fi
            done
            success "  Profiles copied"
        fi
        # Copy prompts that don't exist
        if [ -d "$TEMP_DIR/config/prompts" ]; then
            mkdir -p "$CONFIG_DIR/prompts"
            for f in "$TEMP_DIR/config/prompts"/*; do
                [ -f "$f" ] || continue
                fname=$(basename "$f")
                if [ ! -f "$CONFIG_DIR/prompts/$fname" ]; then
                    cp "$f" "$CONFIG_DIR/prompts/$fname"
                fi
            done
            success "  Prompts copied"
        fi
        # Copy AGENTS.md if not present (fallback)
        if [ -f "$TEMP_DIR/config/AGENTS.md" ] && [ ! -f "$CONFIG_DIR/AGENTS.md" ]; then
            cp "$TEMP_DIR/config/AGENTS.md" "$CONFIG_DIR/AGENTS.md"
            success "  AGENTS.md deployed"
        fi
        # Copy skills that don't exist (fallback)
        if [ -d "$TEMP_DIR/config/skills" ]; then
            mkdir -p "$CONFIG_DIR/skills"
            for d in "$TEMP_DIR/config/skills"/*/; do
                [ -d "$d" ] || continue
                dname=$(basename "$d")
                if [ ! -d "$CONFIG_DIR/skills/$dname" ]; then
                    cp -r "$d" "$CONFIG_DIR/skills/$dname"
                fi
            done
            success "  Skills deployed"
        fi
    fi

    # Deploy AGENTS.md (only if not already present)
    if [ ! -f "$CONFIG_DIR/AGENTS.md" ] && [ -f "$TEMP_DIR/config/AGENTS.md" ]; then
        cp "$TEMP_DIR/config/AGENTS.md" "$CONFIG_DIR/AGENTS.md"
        success "AGENTS.md deployed"
    elif [ -f "$CONFIG_DIR/AGENTS.md" ]; then
        skip "AGENTS.md already exists (preserved)"
    fi

    # Deploy skills (modular on-demand instructions)
    SKILLS_SRC="$TEMP_DIR/config/skills"
    SKILLS_DST="$CONFIG_DIR/skills"
    if [ -d "$SKILLS_SRC" ]; then
        mkdir -p "$SKILLS_DST"
        for d in "$SKILLS_SRC"/*/; do
            [ -d "$d" ] || continue
            dname=$(basename "$d")
            if [ ! -d "$SKILLS_DST/$dname" ]; then
                cp -r "$d" "$SKILLS_DST/$dname"
            fi
        done
        local skill_count
        skill_count=$(find "$SKILLS_DST" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
        success "Skills deployed ($skill_count skills)"
    fi

    success "Configuration deployed to: ${CONFIG_DIR}"

    # Install opencode-jce CLI globally
    info "Installing opencode-jce CLI..."

    # Copy CLI source only (no node_modules). Recursive copy of node_modules can fail
    # on Windows MAX_PATH and wastes I/O. Install deps in staging with bun instead.
    local install_dir="${CONFIG_DIR}/cli"
    local staging_dir="${CONFIG_DIR}/.cli-install-new"
    local backup_dir="${CONFIG_DIR}/.cli-install-backup"
    rm -rf "$staging_dir" "$backup_dir"
    mkdir -p "$staging_dir"
    cp -r "$TEMP_DIR/src" "$staging_dir/src"
    cp -r "$TEMP_DIR/schemas" "$staging_dir/schemas"
    cp -r "$TEMP_DIR/config" "$staging_dir/config"
    [ -d "$TEMP_DIR/scripts" ] && cp -r "$TEMP_DIR/scripts" "$staging_dir/scripts"
    cp "$TEMP_DIR/package.json" "$staging_dir/"
    cp "$TEMP_DIR/tsconfig.json" "$staging_dir/"
    for lock_name in bun.lock bun.lockb package-lock.json; do
        [ -f "$TEMP_DIR/$lock_name" ] && cp "$TEMP_DIR/$lock_name" "$staging_dir/"
    done
    verify_jce_cli_payload "$staging_dir"
    if ! (cd "$staging_dir" && bun install --ignore-scripts) 2>/dev/null; then
        error "bun install --ignore-scripts failed in CLI staging directory"
    fi
    if [ ! -d "$staging_dir/node_modules" ]; then
        error "CLI staging missing node_modules after bun install"
    fi
    if [ -d "$install_dir" ]; then
        mv "$install_dir" "$backup_dir"
    fi
    if mv "$staging_dir" "$install_dir"; then
        rm -rf "$backup_dir"
    else
        [ -d "$backup_dir" ] && mv "$backup_dir" "$install_dir"
        error "Could not install CLI source; previous CLI restored"
    fi
    success "CLI source copied to: $install_dir"

    # Install a stable shim that points to the persistent CLI folder.
    local bun_bin="${HOME}/.bun/bin"
    mkdir -p "$bun_bin"
    rm -f "$bun_bin/opencode-jce.cmd" "$bun_bin/opencode-jce.exe" "$bun_bin/opencode-jce.bunx"
    local npm_bin="$(npm bin -g 2>/dev/null || true)"
    if [ -n "$npm_bin" ] && [ "$npm_bin" != "$bun_bin" ]; then
        rm -f "$npm_bin/opencode-jce" "$npm_bin/opencode-jce.cmd" "$npm_bin/opencode-jce.exe" "$npm_bin/opencode-jce.bunx"
    fi
    cat > "$bun_bin/opencode-jce" <<EOF
#!/usr/bin/env sh
exec bun run "$install_dir/src/index.ts" "\$@"
EOF
    chmod 755 "$bun_bin/opencode-jce"
    export PATH="$bun_bin:$PATH"
    ensure_fish_bun_path

    if command -v opencode-jce &>/dev/null; then
        success "opencode-jce CLI installed globally"
        opencode-jce factory export --output "${CONFIG_DIR}/factory-jce" --clean --sync-personal \
            && success "Factory Droid plugin package exported to: ${CONFIG_DIR}/factory-jce" \
            && offer_factory_droid_install "${CONFIG_DIR}/factory-jce" \
            || warn "Factory Droid export failed. Run 'opencode-jce factory export' after install."
    else
        warn "opencode-jce installed. Add $bun_bin to PATH or restart your terminal."
        bun run "$install_dir/src/index.ts" factory export --output "${CONFIG_DIR}/factory-jce" --clean --sync-personal \
            && success "Factory Droid plugin package exported to: ${CONFIG_DIR}/factory-jce" \
            && offer_factory_droid_install "${CONFIG_DIR}/factory-jce" \
            || warn "Factory Droid export failed. Run 'opencode-jce factory export' after install."
    fi
    terminate_stale_opencode_processes

    # Cleanup
    rm -rf "$TEMP_DIR"
}

register_context_keeper() {
    info "Registering context-keeper MCP server in opencode.json..."

    local opencode_json="${CONFIG_DIR}/opencode.json"
    local cli_dir="${CONFIG_DIR}/cli"
    local context_keeper_path="${cli_dir}/src/mcp/context-keeper.ts"

    # Verify context-keeper.ts exists
    if [ ! -f "$context_keeper_path" ]; then
        warn "context-keeper.ts not found at: $context_keeper_path"
        warn "Skipping MCP registration. Run 'opencode-jce update' to fix."
        return
    fi

    OPENCODE_JSON="$opencode_json" CLI_DIR="$cli_dir" bun -e '
import fs from "fs";
import path from "path";
const opencodeJson = process.env.OPENCODE_JSON;
const cliDir = process.env.CLI_DIR;
const configDir = path.dirname(opencodeJson);
const contextKeeperPath = path.join(cliDir, "src", "mcp", "context-keeper.ts").replace(/\\/g, "/");
const pluginPath = `file://${path.join(cliDir, "src", "plugin", "index.ts").replace(/\\/g, "/")}`;
const defaults = {
  "context-keeper": { type: "local", command: ["bun", "run", contextKeeperPath], env: { PROJECT_ROOT: "${PROJECT_ROOT}" }, enabled: true },
  "context7": { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
  "github-search": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }, enabled: true },
  "memory": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], enabled: true },
  "playwright": { type: "local", command: ["npx", "-y", "@playwright/mcp@0.0.28"], enabled: true },
  "sequential-thinking": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], enabled: true }
};
let config = { "$schema": "https://opencode.ai/config.json", plugin: [pluginPath], mcp: {}, lsp: {} };
if (fs.existsSync(opencodeJson)) {
  try {
    config = JSON.parse(fs.readFileSync(opencodeJson, "utf8"));
  } catch {
    const backup = `${opencodeJson}.invalid-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    fs.renameSync(opencodeJson, backup);
  }
}
if (!Array.isArray(config.plugin)) config.plugin = [];
if (!config.plugin.includes(pluginPath)) config.plugin.push(pluginPath);
if (!config.mcp || typeof config.mcp !== "object") config.mcp = {};
let added = 0;
for (const [key, value] of Object.entries(defaults)) {
  if (!(key in config.mcp)) { config.mcp[key] = value; added++; }
}
fs.writeFileSync(opencodeJson, JSON.stringify(config, null, 2) + "\n");
console.log(added);
' 2>/dev/null && success "opencode.json MCP defaults registered" \
    || warn "Failed to register MCP defaults. Run 'opencode-jce doctor --fix' after install."
}

register_tui_plugin() {
    info "Registering Token Savings TUI plugin in tui.json..."

    local tui_json="${CONFIG_DIR}/tui.json"
    local cli_dir="${CONFIG_DIR}/cli"
    local tui_plugin_file="${cli_dir}/src/plugin/tui.tsx"

    # Validate TUI plugin file exists
    if [ ! -f "$tui_plugin_file" ]; then
        warn "TUI plugin file not found: $tui_plugin_file"
        warn "Token Savings TUI will not be registered. Run 'opencode-jce update' after install."
        return
    fi

    # Validate Bun is available
    if ! command -v bun &>/dev/null; then
        warn "Bun not found. Cannot register TUI plugin."
        warn "Run 'opencode-jce update' after install to retry."
        return
    fi

    local error_log="/tmp/tui-register-$$.log"
    TUI_JSON="$tui_json" CLI_DIR="$cli_dir" bun -e '
import fs from "fs";
import path from "path";
const tuiJson = process.env.TUI_JSON;
const cliDir = process.env.CLI_DIR;
const pluginPath = `file://${path.join(cliDir, "src", "plugin", "tui.tsx").replace(/\\/g, "/")}`;
let config = { "$schema": "https://opencode.ai/tui.json", plugin: [], plugin_enabled: {} };
if (fs.existsSync(tuiJson)) {
  try {
    config = JSON.parse(fs.readFileSync(tuiJson, "utf8"));
  } catch (e) {
    const backup = `${tuiJson}.invalid-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    fs.renameSync(tuiJson, backup);
    console.error(`Malformed tui.json backed up to ${backup}`);
  }
}
if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
if (!config["$schema"]) config["$schema"] = "https://opencode.ai/tui.json";
if (!Array.isArray(config.plugin)) config.plugin = [];
if (!config.plugin.includes(pluginPath)) config.plugin.push(pluginPath);
if (!config.plugin_enabled || typeof config.plugin_enabled !== "object" || Array.isArray(config.plugin_enabled)) config.plugin_enabled = {};
if (!("opencode-jce-token-savings" in config.plugin_enabled)) config.plugin_enabled["opencode-jce-token-savings"] = true;
fs.writeFileSync(tuiJson, JSON.stringify(config, null, 2) + "\n");
' 2>"$error_log"
    
    if [ $? -eq 0 ]; then
        success "tui.json Token Savings plugin registered"
        rm -f "$error_log"
    else
        warn "Failed to register Token Savings TUI plugin."
        if [ -s "$error_log" ]; then
            warn "Error details:"
            sed 's/^/  /' "$error_log" | head -10
        fi
        warn "Run 'opencode-jce update' after install to retry."
        rm -f "$error_log"
    fi
}

# API keys are managed by OpenCode CLI directly - no setup needed here

precache_mcp_packages() {
    echo ""
    info "Pre-downloading MCP server packages..."

    if ! command -v npm &>/dev/null; then
        warn "npm not found. MCP packages will download on first use."
        info "Install Node.js for pre-caching: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
        return
    fi

    info "This ensures MCP servers start instantly in OpenCode."
    echo ""

    # List of MCP packages to pre-cache (npm package names)
    local -a MCP_PACKAGES=(
        "@modelcontextprotocol/server-github"
        "@modelcontextprotocol/server-memory"
        "@playwright/mcp@0.0.28"
        "@modelcontextprotocol/server-sequential-thinking"
    )

    local cached_count=0
    local failed_count=0

    for pkg in "${MCP_PACKAGES[@]}"; do
        local short_name="${pkg##*/}"
        echo -n "  Caching ${short_name}... "

        # Use npm cache add to download without executing
        if npm cache add "$pkg" &>/dev/null; then
            echo -e "${GREEN}✅${NC}"
            cached_count=$((cached_count + 1))
        else
            echo -e "${YELLOW}⚠️${NC}"
            failed_count=$((failed_count + 1))
        fi
    done

    echo ""
    if [ "$cached_count" -gt 0 ]; then
        success "$cached_count MCP package(s) pre-cached."
    fi
    if [ "$failed_count" -gt 0 ]; then
        warn "$failed_count package(s) could not be cached. They will download on first use."
    fi
}

install_system_packages() {
    case "$PKG_MGR" in
        apt)    sudo apt-get update && sudo apt-get install -y "$@";;
        dnf)    sudo dnf install -y "$@";;
        pacman) sudo pacman -S --noconfirm "$@";;
        brew)   brew install "$@";;
        *)      return 1;;
    esac
}

ensure_cargo() {
    if command -v cargo &>/dev/null; then return 0; fi
    info "Rust/Cargo is required for this LSP. Installing Rust toolchain..."
    case "$PKG_MGR" in
        apt)    install_system_packages curl build-essential pkg-config libssl-dev;;
        dnf)    install_system_packages curl gcc gcc-c++ make openssl-devel;;
        pacman) install_system_packages curl base-devel openssl;;
        brew)   install_system_packages rust; return 0;;
        *)      return 1;;
    esac
    if [ "${OPENCODE_JCE_ALLOW_UNVERIFIED_DOWNLOAD:-}" != "1" ]; then
        error "Rustup auto-install is disabled because sh.rustup.rs has no pinned checksum. Install Rust manually from https://rustup.rs or rerun with OPENCODE_JCE_ALLOW_UNVERIFIED_DOWNLOAD=1."
    fi
    local rustup_installer="${TEMP_DIR}.rustup-init.sh"
    curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "$rustup_installer"
    sh "$rustup_installer" -y
    export PATH="${HOME}/.cargo/bin:${PATH}"
    command -v cargo &>/dev/null
}

ensure_go() {
    if command -v go &>/dev/null; then return 0; fi
    info "Go is required for gopls. Installing Go..."
    case "$PKG_MGR" in
        apt)    install_system_packages golang-go;;
        dnf)    install_system_packages golang;;
        pacman) install_system_packages go;;
        brew)   install_system_packages go;;
        *)      return 1;;
    esac
    command -v go &>/dev/null
}

ensure_ruby() {
    if command -v gem &>/dev/null; then return 0; fi
    info "RubyGems is required for Solargraph. Installing Ruby..."
    case "$PKG_MGR" in
        apt)    install_system_packages ruby ruby-dev build-essential;;
        dnf)    install_system_packages ruby ruby-devel gcc make;;
        pacman) install_system_packages ruby base-devel;;
        brew)   install_system_packages ruby;;
        *)      return 1;;
    esac
    command -v gem &>/dev/null
}

ensure_dotnet() {
    if command -v dotnet &>/dev/null; then return 0; fi
    info ".NET SDK is required for csharp-ls. Installing .NET SDK..."
    case "$PKG_MGR" in
        apt)    install_system_packages dotnet-sdk-8.0 || install_system_packages dotnet-sdk-7.0;;
        dnf)    install_system_packages dotnet-sdk-8.0 || install_system_packages dotnet-sdk-7.0;;
        pacman) install_system_packages dotnet-sdk;;
        brew)   install_system_packages dotnet-sdk;;
        *)      return 1;;
    esac
    command -v dotnet &>/dev/null
}

ensure_elixir() {
    if command -v mix &>/dev/null; then return 0; fi
    info "Elixir/Mix is required for elixir-ls. Installing Elixir..."
    case "$PKG_MGR" in
        apt)    install_system_packages elixir erlang;;
        dnf)    install_system_packages elixir erlang;;
        pacman) install_system_packages elixir erlang;;
        brew)   install_system_packages elixir;;
        *)      return 1;;
    esac
    command -v mix &>/dev/null
}

ensure_coursier() {
    if command -v cs &>/dev/null; then return 0; fi
    info "Coursier is required for Metals. Installing Coursier..."
    local jce_bin="${HOME}/.local/bin"
    mkdir -p "$jce_bin"
    local cs_arch
    case "$ARCH" in
        x64)    cs_arch="x86_64";;
        arm64)  cs_arch="aarch64";;
        *)      warn "Unsupported architecture for Coursier: $ARCH"; return 1;;
    esac
    local cs_url="https://github.com/coursier/launchers/raw/master/cs-${cs_arch}-pc-linux.gz"
    curl -fLo "$jce_bin/cs.gz" "$cs_url" || return 1
    gunzip -f "$jce_bin/cs.gz"
    chmod 755 "$jce_bin/cs"
    export PATH="$jce_bin:$PATH"
    command -v cs &>/dev/null
}

install_rust_analyzer() {
    if ! command -v rustup &>/dev/null; then
        ensure_cargo || return 1
    fi

    if command -v rustup &>/dev/null; then
        rustup component add rust-analyzer
        return
    fi

    case "$PKG_MGR" in
        apt)    sudo apt-get update && sudo apt-get install -y rust-analyzer;;
        dnf)    sudo dnf install -y rust-analyzer;;
        pacman) sudo pacman -S --noconfirm rust-analyzer;;
        brew)   brew install rust-analyzer;;
        *)      return 1;;
    esac
}

install_jdtls_linux() {
    if ! command -v java &>/dev/null; then
        case "$PKG_MGR" in
            apt)    sudo apt-get update && sudo apt-get install -y openjdk-21-jre-headless;;
            dnf)    sudo dnf install -y java-21-openjdk-headless;;
            pacman) sudo pacman -S --noconfirm jre-openjdk;;
            *)      warn "Java runtime not found; install JDK 21 before jdtls if this fails.";;
        esac
    fi

    local jce_bin="${HOME}/.local/bin"
    local lsp_dir="${HOME}/.local/share/opencode-jce/lsp/jdtls"
    local archive="${TEMP_DIR}/jdtls-latest.tar.gz"
    mkdir -p "$TEMP_DIR"
    mkdir -p "$jce_bin" "$lsp_dir"
    curl -fsSL "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz" -o "$archive"
    tar -xzf "$archive" -C "$lsp_dir"
    local launcher
    launcher=$(find "$lsp_dir/plugins" -name 'org.eclipse.equinox.launcher_*.jar' -print -quit)
    [ -n "$launcher" ] || return 1
    cat > "$jce_bin/jdtls" <<EOF
#!/usr/bin/env sh
JDTLS_HOME="$lsp_dir"
JDTLS_LAUNCHER="$launcher"
exec java \
  -Declipse.application=org.eclipse.jdt.ls.core.id1 \
  -Dosgi.bundles.defaultStartLevel=4 \
  -Declipse.product=org.eclipse.jdt.ls.core.product \
  -Dlog.protocol=true \
  -Dlog.level=ALL \
  -Xmx1G \
  --add-modules=ALL-SYSTEM \
  --add-opens java.base/java.util=ALL-UNNAMED \
  --add-opens java.base/java.lang=ALL-UNNAMED \
  -jar "\$JDTLS_LAUNCHER" \
  -configuration "\$JDTLS_HOME/config_linux" \
  -data "\$HOME/.jdtls-workspace" \
  "\$@"
EOF
    chmod 755 "$jce_bin/jdtls"
    export PATH="$jce_bin:$PATH"
    command -v jdtls &>/dev/null
}

install_csharp_ls() {
    ensure_dotnet || return 1
    dotnet tool install -g csharp-ls || dotnet tool update -g csharp-ls
    export PATH="${HOME}/.dotnet/tools:${PATH}"
    command -v csharp-ls &>/dev/null
}

install_marksman_linux() {
    local jce_bin="${HOME}/.local/bin"
    mkdir -p "$jce_bin"

    local os_arch
    case "$(uname -m)" in
        x86_64|amd64) os_arch="x64";;
        aarch64|arm64) os_arch="arm64";;
        *) os_arch="";;
    esac

    if [ -n "$os_arch" ]; then
        local url="https://github.com/artempyanykh/marksman/releases/latest/download/marksman-linux-${os_arch}"
        if curl -fsSL "$url" -o "$jce_bin/marksman"; then
            chmod 755 "$jce_bin/marksman"
            export PATH="$jce_bin:$PATH"
            command -v marksman &>/dev/null && return 0
        fi
    fi

    if command -v cargo &>/dev/null; then
        cargo install marksman
        return
    fi

    return 1
}

download_github_release_asset() {
    local repo="$1"
    local asset_pattern="$2"
    local output="$3"
    local api_url="https://api.github.com/repos/${repo}/releases/latest"
    local asset_url
    asset_url=$(curl -fsSL "$api_url" | grep -Eo '"browser_download_url": "[^"]+"' | cut -d'"' -f4 | grep -E "$asset_pattern" | head -n 1)
    [ -n "$asset_url" ] || return 1
    curl -fsSL "$asset_url" -o "$output"
}

install_kotlin_language_server_linux() {
    local jce_bin="${HOME}/.local/bin"
    local install_dir="${HOME}/.local/share/opencode-jce/lsp/kotlin-language-server"
    local archive="${TEMP_DIR}/kotlin-language-server.zip"
    mkdir -p "$TEMP_DIR" "$jce_bin"

    command -v unzip &>/dev/null || lsp_system_install_command unzip unzip unzip unzip >/dev/null || return 1
    if ! command -v unzip &>/dev/null; then
        eval "$(lsp_system_install_command unzip unzip unzip unzip)" || return 1
    fi

    download_github_release_asset "fwcd/kotlin-language-server" 'server\.zip$' "$archive"
    rm -rf "$install_dir"
    mkdir -p "$install_dir"
    unzip -q "$archive" -d "$install_dir"
    local server_bin
    server_bin=$(find "$install_dir" -type f -path '*/bin/kotlin-language-server' -print -quit)
    [ -n "$server_bin" ] || return 1
    chmod 755 "$server_bin"
    ln -sf "$server_bin" "$jce_bin/kotlin-language-server"
    export PATH="$jce_bin:$PATH"
    command -v kotlin-language-server &>/dev/null
}

install_dart_linux() {
    case "$PKG_MGR" in
        apt)
            sudo apt-get update
            sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
            sudo install -d -m 0755 /usr/share/keyrings
            curl -fsSL https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/dart.gpg
            echo "deb [signed-by=/usr/share/keyrings/dart.gpg arch=$(dpkg --print-architecture)] https://storage.googleapis.com/download.dartlang.org/linux/debian stable main" | sudo tee /etc/apt/sources.list.d/dart_stable.list >/dev/null
            sudo apt-get update && sudo apt-get install -y dart
            ;;
        *) lsp_system_install_command dart dart dart dart >/dev/null || return 1; eval "$(lsp_system_install_command dart dart dart dart)";;
    esac
}

install_gopls() {
    ensure_go || return 1
    go install golang.org/x/tools/gopls@latest
    export PATH="${HOME}/go/bin:${PATH}"
    command -v gopls &>/dev/null
}

install_solargraph() {
    ensure_ruby || return 1
    gem install solargraph
    command -v solargraph &>/dev/null
}

install_taplo() {
    ensure_cargo || return 1
    cargo install taplo-cli --features lsp
    export PATH="${HOME}/.cargo/bin:${PATH}"
    command -v taplo &>/dev/null
}

install_elixir_ls() {
    ensure_elixir || return 1
    mix local.hex --force
    mix archive.install hex elixir_ls --force
    command -v elixir-ls &>/dev/null || command -v elixir_ls &>/dev/null
}

install_metals() {
    ensure_coursier || return 1
    cs install metals
    export PATH="${HOME}/.local/share/coursier/bin:${HOME}/.local/bin:${PATH}"
    command -v metals &>/dev/null
}

install_terraform_ls_linux() {
    local jce_bin="${HOME}/.local/bin"
    local archive="${TEMP_DIR}/terraform-ls.zip"
    mkdir -p "$TEMP_DIR" "$jce_bin"

    command -v unzip &>/dev/null || lsp_system_install_command unzip unzip unzip unzip >/dev/null || return 1
    if ! command -v unzip &>/dev/null; then
        eval "$(lsp_system_install_command unzip unzip unzip unzip)" || return 1
    fi

    download_github_release_asset "hashicorp/terraform-ls" "linux_${ARCH}\.zip$" "$archive"
    unzip -qo "$archive" -d "$jce_bin"
    chmod 755 "$jce_bin/terraform-ls"
    export PATH="$jce_bin:$PATH"
    command -v terraform-ls &>/dev/null
}

install_zls_linux() {
    local jce_bin="${HOME}/.local/bin"
    local archive="${TEMP_DIR}/zls.tar.xz"
    local asset_arch
    case "$ARCH" in
        x64) asset_arch="x86_64";;
        arm64) asset_arch="aarch64";;
        *) return 1;;
    esac
    mkdir -p "$TEMP_DIR" "$jce_bin"

    download_github_release_asset "zigtools/zls" "${asset_arch}-linux.*\.tar\.xz$" "$archive"
    tar -xJf "$archive" -C "$TEMP_DIR"
    local zls_bin
    zls_bin=$(find "$TEMP_DIR" -type f -name zls -print -quit)
    [ -n "$zls_bin" ] || return 1
    install -m 0755 "$zls_bin" "$jce_bin/zls"
    export PATH="$jce_bin:$PATH"
    command -v zls &>/dev/null
}

lsp_system_install_command() {
    local apt_pkg="$1"
    local dnf_pkg="${2:-$apt_pkg}"
    local pacman_pkg="${3:-$apt_pkg}"
    local brew_pkg="${4:-$apt_pkg}"

    if [ "$OS" = "macos" ]; then
        echo "brew install ${brew_pkg}"
        return
    fi

    case "$PKG_MGR" in
        apt)    echo "sudo apt-get update && sudo apt-get install -y ${apt_pkg}";;
        dnf)    echo "sudo dnf install -y ${dnf_pkg}";;
        pacman) echo "sudo pacman -S --noconfirm ${pacman_pkg}";;
        *)      return 1;;
    esac
}

lsp_install_command() {
    case "$1" in
        0)  echo "npm install -g pyright";;
        1)  echo "npm install -g typescript-language-server typescript";;
        2)  echo "install_rust_analyzer";;
        3)  echo "install_gopls";;
        4)  echo "npm install -g dockerfile-language-server-nodejs";;
        5)  echo "npm install -g sql-language-server";;
        6)  [ "$OS" = "macos" ] && echo "brew install jdtls" || echo "install_jdtls_linux";;
        7)  lsp_system_install_command clangd clang-tools-extra clang llvm;;
        8)  echo "npm install -g intelephense";;
        9)  echo "install_solargraph";;
        10) echo "install_csharp_ls";;
        11) echo "npm install -g bash-language-server";;
        12) echo "npm install -g yaml-language-server";;
        13) echo "npm install -g vscode-langservers-extracted";;
        14) echo "npm install -g vscode-langservers-extracted";;
        15)
            if [ "$OS" = "macos" ]; then
                echo "brew install kotlin-language-server"
            else
                echo "install_kotlin_language_server_linux"
            fi
            ;;
        16) [ "$OS" = "macos" ] && echo "brew install dart" || echo "install_dart_linux";;
        17) lsp_system_install_command lua-language-server lua-language-server lua-language-server lua-language-server;;
        18) echo "npm install -g svelte-language-server";;
        19) echo "npm install -g @vue/language-server";;
        20) [ "$OS" = "macos" ] && echo "brew install hashicorp/tap/terraform-ls" || echo "install_terraform_ls_linux";;
        21) echo "npm install -g @tailwindcss/language-server";;
        22)
            if [ "$OS" = "macos" ]; then
                echo "brew install zls"
            else
                echo "install_zls_linux"
            fi
            ;;
        23) [ "$OS" = "macos" ] && echo "brew install marksman" || echo "install_marksman_linux";;
        24) echo "install_taplo";;
        25) echo "npm install -g graphql-language-service-cli";;
        26)
            if [ "$OS" = "macos" ]; then
                echo "brew install elixir-ls"
            else
                echo "install_elixir_ls"
            fi
            ;;
        27)
            if [ "$OS" = "macos" ]; then
                echo "brew install metals"
            else
                echo "install_metals"
            fi
            ;;
        *)  return 1;;
    esac
}

select_and_install_lsp() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       LSP Server Installation            ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║                                          ║${NC}"
    echo -e "${CYAN}║  Select LSP servers to install:          ║${NC}"
    echo -e "${CYAN}║                                          ║${NC}"

    # Define LSP servers
    local -a LSP_NAMES=("Python" "TypeScript" "Rust" "Go" "Docker" "SQL" "Java" "C/C++" "PHP" "Ruby" "C#" "Bash" "YAML" "HTML" "CSS" "Kotlin" "Dart" "Lua" "Svelte" "Vue" "Terraform" "Tailwind CSS" "Zig" "Markdown" "TOML" "GraphQL" "Elixir" "Scala")
    local -a LSP_CMDS=("pyright-langserver" "typescript-language-server" "rust-analyzer" "gopls" "docker-langserver" "sql-language-server" "jdtls" "clangd" "intelephense" "solargraph" "csharp-ls" "bash-language-server" "yaml-language-server" "vscode-html-language-server" "vscode-css-language-server" "kotlin-language-server" "dart" "lua-language-server" "svelteserver" "vue-language-server" "terraform-ls" "tailwindcss-language-server" "zls" "marksman" "taplo" "graphql-lsp" "elixir-ls" "metals")

    # Show list with status
    local -a ALREADY_INSTALLED=()
    for i in "${!LSP_NAMES[@]}"; do
        local num=$((i + 1))
        local name="${LSP_NAMES[$i]}"
        local cmd="${LSP_CMDS[$i]}"
        if command -v "$cmd" &>/dev/null; then
            echo -e "${CYAN}║${NC}  ${GREEN}[✓]${NC} ${num}. ${name}  ${BOLD}(already installed)${NC}"
            ALREADY_INSTALLED+=("$i")
        else
            echo -e "${CYAN}║${NC}  [ ] ${num}. ${name}"
        fi
    done

    echo -e "${CYAN}║                                          ║${NC}"
    echo -e "${CYAN}║  ${BOLD}a${NC}${CYAN} = Install all    ${BOLD}s${NC}${CYAN} = Skip all          ║${NC}"
    echo -e "${CYAN}║  Or enter numbers: ${BOLD}1,2,4${NC}${CYAN}                 ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # Detect if stdin is a terminal (interactive) or piped
    local lsp_choice=""
    if [ -t 0 ]; then
        # Interactive terminal — ask user
        read -rp "  Your choice: " lsp_choice
    else
        # Non-interactive (piped via curl | bash) — cannot read input
        warn "Non-interactive mode detected (piped install)."
        warn "LSP selection requires interactive terminal."
        echo ""
        info "To install LSP servers later, run:"
        echo -e "  ${CYAN}opencode-jce setup${NC}          # interactive setup wizard"
        echo -e "  ${CYAN}opencode-jce setup --merge-lsp${NC}  # auto-detect installed LSPs"
        echo ""
        info "Skipping LSP installation. Merging any already-installed LSPs..."
        # Still merge whatever LSPs are already installed on the system
        merge_lsp_to_opencode_config
        return
    fi

    # Parse choice
    local -a selected=()

    case "$lsp_choice" in
        [aA])
            # Select all that are not already installed
            for i in "${!LSP_NAMES[@]}"; do
                local is_installed=false
                for j in "${ALREADY_INSTALLED[@]:-}"; do
                    if [ "$i" = "$j" ]; then
                        is_installed=true
                        break
                    fi
                done
                if [ "$is_installed" = false ]; then
                    selected+=("$i")
                fi
            done
            ;;
        [sS]|"")
            info "Skipping LSP installation."
            # Still merge any LSPs already in PATH
            merge_lsp_to_opencode_config
            return
            ;;
        *)
            # Parse comma-separated numbers
            IFS=',' read -ra nums <<< "$lsp_choice"
            for num in "${nums[@]}"; do
                num=$(echo "$num" | tr -d ' ')
                if [[ "$num" =~ ^[0-9]+$ ]] && [ "$num" -ge 1 ] && [ "$num" -le "${#LSP_NAMES[@]}" ]; then
                    local idx=$((num - 1))
                    # Skip if already installed
                    local is_installed=false
                    for j in "${ALREADY_INSTALLED[@]:-}"; do
                        if [ "$idx" = "$j" ]; then
                            is_installed=true
                            break
                        fi
                    done
                    if [ "$is_installed" = false ]; then
                        selected+=("$idx")
                    else
                        skip "${LSP_NAMES[$idx]} already installed, skipping."
                    fi
                else
                    warn "Invalid selection: $num (skipped)"
                fi
            done
            ;;
    esac

    if [ ${#selected[@]} -eq 0 ]; then
        info "No new LSP servers to install."
        merge_lsp_to_opencode_config
        return
    fi

    echo ""
    info "Installing ${#selected[@]} LSP server(s)..."
    echo ""

    local installed_count=0
    local failed_count=0

    for idx in "${selected[@]}"; do
        local name="${LSP_NAMES[$idx]}"
        local install_cmd
        install_cmd=$(lsp_install_command "$idx") || install_cmd=""

        echo -n "  Installing ${name}... "

        if [ -z "$install_cmd" ]; then
            echo -e "${YELLOW}⚠️  Failed${NC}"
            warn "  No install command available for ${name} on ${OS}/${PKG_MGR}."
            failed_count=$((failed_count + 1))
            continue
        fi

        # Run install command
        if eval "$install_cmd" &>/dev/null; then
            echo -e "${GREEN}✅${NC}"
            installed_count=$((installed_count + 1))
        else
            echo -e "${YELLOW}⚠️  Failed${NC}"
            warn "  Command: $install_cmd"
            failed_count=$((failed_count + 1))
        fi
    done

    LSP_INSTALLED=$installed_count

    echo ""
    if [ "$installed_count" -gt 0 ]; then
        success "$installed_count LSP server(s) installed successfully."
    fi
    if [ "$failed_count" -gt 0 ]; then
        warn "$failed_count LSP server(s) failed to install. You can install them manually later."
    fi

    # Merge installed LSP servers into opencode.json
    merge_lsp_to_opencode_config
}

merge_lsp_to_opencode_config() {
    info "Merging LSP config into opencode.json..."

    # Try opencode-jce CLI first
    if command -v opencode-jce &>/dev/null; then
        if opencode-jce setup --merge-lsp 2>/dev/null; then
            success "LSP servers merged into opencode.json (via opencode-jce)"
            return
        fi
    fi

    # Fallback: directly write LSP entries to opencode.json
    # This ensures LSP config is always written, even without opencode-jce in PATH
    info "Using direct merge fallback..."

    local opencode_json="${CONFIG_DIR}/opencode.json"
    local lsp_json="${CONFIG_DIR}/lsp.json"

    # Need lsp.json as source of truth
    if [ ! -f "$lsp_json" ]; then
        warn "lsp.json not found in ${CONFIG_DIR}. Cannot merge LSP config."
        return
    fi

    # Detect which LSP commands are actually installed
    # Use bun to reliably parse JSON and check installed commands
    local installed_json
    installed_json=$(LSP_JSON_PATH="$lsp_json" bun -e '
import fs from "fs";
import { execFileSync } from "child_process";
const lsp = JSON.parse(fs.readFileSync(process.env.LSP_JSON_PATH, "utf8"));
const installed = [];
for (const [key, entry] of Object.entries(lsp.lsp || {})) {
    try {
        if (!/^[\\w@./+:-]+$/.test(entry.command)) continue;
        execFileSync("which", [entry.command], { stdio: "ignore" });
        installed.push(key);
    } catch {}
}
console.log(installed.join(" "));
' 2>/dev/null || true)

    if [ -z "$installed_json" ]; then
        info "Could not detect installed LSP servers. Nothing to merge."
        return
    fi

    local -a installed_lsps=($installed_json)

    if [ ${#installed_lsps[@]} -eq 0 ]; then
        info "No LSP servers found in PATH. Nothing to merge."
        return
    fi

    info "Found ${#installed_lsps[@]} LSP server(s) in PATH: ${installed_lsps[*]}"

    # Build LSP section for opencode.json using bun (reliable JSON manipulation)
    # If bun is available, use it for proper JSON merge
    if command -v bun &>/dev/null; then
        OPENCODE_JSON_PATH="$opencode_json" LSP_JSON_PATH="$lsp_json" INSTALLED_LSPS="${installed_lsps[*]}" bun -e "
import fs from 'fs';
const path = process.env.OPENCODE_JSON_PATH;
const lspPath = process.env.LSP_JSON_PATH;
const installed = process.env.INSTALLED_LSPS.split(' ').filter(Boolean);

// Load or create opencode.json
let config = {};
if (fs.existsSync(path)) {
    try {
        config = JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch {
        // Malformed existing config: back it up before rebuilding so we never
        // silently destroy plugin/mcp/agent settings (mirrors register_context_keeper).
        const backup = path + '.invalid-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        fs.renameSync(path, backup);
        console.error('Existing opencode.json was malformed; backed up to ' + backup);
    }
}

// Load lsp.json
let lspData = {};
try { lspData = JSON.parse(fs.readFileSync(lspPath, 'utf8')); } catch { process.exit(1); }

// Initialize lsp section
if (!config.lsp) config.lsp = {};

let added = 0;
for (const key of installed) {
    if (config.lsp[key]) continue; // already configured
    const entry = lspData.lsp?.[key];
    if (!entry) continue;

    // Build opencode.json LSP format
    const cmdArray = [entry.command, ...entry.args];
    const extensions = (entry.filetypes || []).map(ft => {
        const extMap = {
            python: ['.py', '.pyi'], typescript: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
            javascript: ['.js', '.jsx', '.mjs', '.cjs'], rust: ['.rs'], go: ['.go'],
            dockerfile: ['.dockerfile'], sql: ['.sql'], java: ['.java'],
            c: ['.c', '.h'], cpp: ['.cpp', '.hpp', '.cc', '.cxx'], objc: ['.m', '.mm'],
            php: ['.php'], ruby: ['.rb'], csharp: ['.cs'],
            bash: ['.sh', '.bash'], sh: ['.sh'], zsh: ['.zsh'],
            yaml: ['.yaml', '.yml'], yml: ['.yaml', '.yml'],
            html: ['.html', '.htm'], htm: ['.html', '.htm'],
            css: ['.css'], scss: ['.scss'], less: ['.less'],
            kotlin: ['.kt', '.kts'], dart: ['.dart'], lua: ['.lua'],
            svelte: ['.svelte'], vue: ['.vue'],
            terraform: ['.tf', '.tfvars'], hcl: ['.hcl'],
            zig: ['.zig'], markdown: ['.md'], toml: ['.toml'],
            graphql: ['.graphql', '.gql'], gql: ['.graphql', '.gql'],
            elixir: ['.ex', '.exs'], eelixir: ['.eex', '.heex'],
            scala: ['.scala', '.sbt'], sbt: ['.sbt'],
            typescriptreact: ['.tsx'], javascriptreact: ['.jsx'],
        };
        return extMap[ft] || [];
    }).flat();

    // Deduplicate extensions
    const uniqueExts = [...new Set(extensions)];

    config.lsp[key] = {
        command: cmdArray,
        extensions: uniqueExts
    };
    added++;
}

fs.writeFileSync(path, JSON.stringify(config, null, 2));
console.log('Added ' + added + ' LSP server(s) to opencode.json');
" 2>/dev/null && success "LSP servers merged into opencode.json (direct)" \
          || warn "Failed to merge LSP config. Run 'opencode-jce setup --merge-lsp' after restarting terminal."
    else
        warn "bun not available for JSON merge. Run 'opencode-jce setup --merge-lsp' after restarting terminal."
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════╗"
    echo "║     OpenCode JCE — Installed! 🎉        ║"
    echo "╠══════════════════════════════════════════╣"

    if [ "$GIT_STATUS" = "installed" ]; then
        echo "║ ✅ Git            — installed            ║"
    else
        echo "║ ✅ Git            — already present      ║"
    fi

    if [ "$BUN_STATUS" = "installed" ]; then
        echo "║ ✅ Bun            — installed            ║"
    else
        echo "║ ✅ Bun            — already present      ║"
    fi

    if [ "$OPENCODE_STATUS" = "installed" ]; then
        echo "║ ✅ OpenCode CLI   — installed            ║"
    else
        echo "║ ✅ OpenCode CLI   — already present      ║"
    fi

    echo "║ ✅ 42 AI Agents   — configured           ║"
    echo "║ ✅ AGENTS.md      — global AI instructions ║"
    echo "║ ✅ 81 Skills      — on-demand workflows  ║"
    echo "║ ✅ 19 Profiles    — ready                ║"
    echo "║ ✅ 6 MCP Servers  — cached & ready        ║"
    if [ "$LSP_INSTALLED" -gt 0 ]; then
        echo "║ ✅ LSP Servers    — ${LSP_INSTALLED} installed             ║"
    else
        echo "║ ✅ LSP Settings   — configured           ║"
    fi
    echo "╠══════════════════════════════════════════╣"
    echo "║                                          ║"
    echo "║  Get started:  opencode                  ║"
    echo "║                                          ║"
    echo "╚══════════════════════════════════════════╝"
    echo -e "${NC}"

    if [ "$BUN_STATUS" = "installed" ] || [ "$OPENCODE_STATUS" = "installed" ]; then
        warn "You may need to restart your terminal or run:"
        echo "  source ~/.bashrc  (or ~/.zshrc)"
    fi
}

# ─── Main ─────────────────────────────────────────────────────

main() {
    print_banner
    detect_os
    detect_package_manager
    echo ""

    # Auto-detect OpenCode config location and backup
    detect_opencode_config
    backup_existing_config
    info "Config directory: $CONFIG_DIR"
    echo ""

    install_git
    install_bun
    install_opencode
    echo ""

    deploy_config
    register_context_keeper
    register_tui_plugin
    precache_mcp_packages
    select_and_install_lsp
    print_summary
}

main "$@"
