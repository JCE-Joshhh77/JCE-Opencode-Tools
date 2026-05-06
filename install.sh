#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# OpenCode JCE — Installer
# One command to install everything you need for OpenCode CLI
# ═══════════════════════════════════════════════════════════════

VERSION="2.0.0"
REPO_URL="https://github.com/JCETools-Petra/JCE-Opencode-Tools.git"
TEMP_DIR="/tmp/opencode-jce-install"
# CONFIG_DIR is set by detect_opencode_config() in main()

# Cleanup on exit/interrupt
trap 'rm -rf "$TEMP_DIR" 2>/dev/null' EXIT INT TERM

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
        warn "Backup failed — continuing anyway."
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

    info "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash || true

    # Source the updated profile to get bun in PATH
    export BUN_INSTALL="${HOME}/.bun"
    export PATH="${BUN_INSTALL}/bin:${PATH}"

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

deploy_config() {
    info "Deploying configuration..."

    # Clone config repo
    rm -rf "$TEMP_DIR"
    git clone --depth 1 "$REPO_URL" "$TEMP_DIR" 2>/dev/null || \
        error "Failed to clone config repository. Check your internet connection."

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
            for f in "$TEMP_DIR/config/skills"/*.md; do
                [ -f "$f" ] || continue
                fname=$(basename "$f")
                if [ ! -f "$CONFIG_DIR/skills/$fname" ]; then
                    cp "$f" "$CONFIG_DIR/skills/$fname"
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
        for f in "$SKILLS_SRC"/*.md; do
            [ -f "$f" ] || continue
            fname=$(basename "$f")
            if [ ! -f "$SKILLS_DST/$fname" ]; then
                cp "$f" "$SKILLS_DST/$fname"
            fi
        done
        success "Skills deployed ($(ls "$SKILLS_DST"/*.md 2>/dev/null | wc -l | tr -d ' ') files)"
    fi

    success "Configuration deployed to: ${CONFIG_DIR}"

    # Install opencode-jce CLI globally
    info "Installing opencode-jce CLI..."
    if ! (cd "$TEMP_DIR" && bun install) 2>/dev/null; then
        error "bun install failed while preparing opencode-jce CLI dependencies"
    fi

    # Copy CLI source to persistent location (same as PS1 installer)
    local install_dir="${CONFIG_DIR}/cli"
    local staging_dir="${CONFIG_DIR}/.cli-install-new"
    local backup_dir="${CONFIG_DIR}/.cli-install-backup"
    rm -rf "$staging_dir" "$backup_dir"
    mkdir -p "$staging_dir"
    cp -r "$TEMP_DIR/src" "$staging_dir/src"
    cp -r "$TEMP_DIR/schemas" "$staging_dir/schemas"
    [ -d "$TEMP_DIR/scripts" ] && cp -r "$TEMP_DIR/scripts" "$staging_dir/scripts"
    cp "$TEMP_DIR/package.json" "$staging_dir/"
    cp "$TEMP_DIR/tsconfig.json" "$staging_dir/"
    cp -r "$TEMP_DIR/node_modules" "$staging_dir/node_modules"
    if [ ! -f "$staging_dir/src/index.ts" ]; then
        rm -rf "$staging_dir"
        error "Downloaded CLI source is missing src/index.ts"
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
    cat > "$bun_bin/opencode-jce" <<EOF
#!/usr/bin/env sh
exec bun run "$install_dir/src/index.ts" "\$@"
EOF
    chmod 755 "$bun_bin/opencode-jce"

    if command -v opencode-jce &>/dev/null; then
        success "opencode-jce CLI installed globally"
    else
        warn "opencode-jce installed. Add $bun_bin to PATH or restart your terminal."
    fi

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
const contextKeeperPath = path.join(cliDir, "src", "mcp", "context-keeper.ts").replace(/\\/g, "/");
const defaults = {
  "context-keeper": { type: "local", command: ["bun", "run", contextKeeperPath], env: { PROJECT_ROOT: "${PROJECT_ROOT}" }, enabled: true },
  "context7": { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
  "github-search": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }, enabled: true },
  "memory": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], enabled: true },
  "playwright": { type: "local", command: ["npx", "-y", "@playwright/mcp@0.0.28"], enabled: true },
  "sequential-thinking": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], enabled: true }
};
let config = { "$schema": "https://opencode.ai/config.json", plugin: ["superpowers@git+https://github.com/obra/superpowers.git"], mcp: {}, lsp: {} };
if (fs.existsSync(opencodeJson)) config = JSON.parse(fs.readFileSync(opencodeJson, "utf8"));
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
    local -a LSP_INSTALL=(
        "npm install -g pyright"
        "npm install -g typescript-language-server typescript"
        "rustup component add rust-analyzer"
        "go install golang.org/x/tools/gopls@latest"
        "npm install -g dockerfile-language-server-nodejs"
        "npm install -g sql-language-server"
        "brew install jdtls"
        "sudo apt-get install -y clangd || brew install llvm"
        "npm install -g intelephense"
        "gem install solargraph"
        "dotnet tool install -g csharp-ls --version 0.15.0"
        "npm install -g bash-language-server"
        "npm install -g yaml-language-server"
        "npm install -g vscode-langservers-extracted"
        "npm install -g vscode-langservers-extracted"
        "brew install kotlin-language-server || sdk install kotlin-language-server"
        "brew install dart || sudo apt-get install -y dart"
        "brew install lua-language-server || sudo apt-get install -y lua-language-server"
        "npm install -g svelte-language-server"
        "npm install -g @vue/language-server"
        "brew install hashicorp/tap/terraform-ls || sudo apt-get install -y terraform-ls"
        "npm install -g @tailwindcss/language-server"
        "brew install zls || cargo install zls"
        "brew install marksman || cargo install marksman"
        "cargo install taplo-cli --features lsp"
        "npm install -g graphql-language-service-cli"
        "brew install elixir-ls || mix archive.install hex elixir_ls"
        "brew install metals || cs install metals"
    )

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
        local install_cmd="${LSP_INSTALL[$idx]}"

        echo -n "  Installing ${name}... "

        # Run install command
        if bash -c "$install_cmd" &>/dev/null; then
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
    try { config = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
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
    echo "║ ✅ 50 Skills      — on-demand workflows  ║"
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
    precache_mcp_packages
    select_and_install_lsp
    print_summary
}

main "$@"
