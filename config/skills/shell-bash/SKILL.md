---
name: shell-bash
description: Bash, shell scripts, Makefile. Use when working on shell-bash tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Shell / Bash
# Loaded on-demand when working with .sh, .bash, Makefile, shell scripts

## Auto-Detect

Trigger this skill when:
- File extensions: `.sh`, `.bash`, `Makefile`, `justfile`, `.zsh`
- Shebangs: `#!/usr/bin/env bash`, `#!/bin/sh`
- Tools: shellcheck, shfmt, just, make
- Patterns: `set -euo pipefail`, CI/CD scripts, automation

---

## Decision Tree: Script vs Tool

```
What are you automating?
+-- Simple task runner (build, test, deploy)?
|   +-- Just needs commands? -> justfile (modern, cross-platform)
|   +-- Need dependency graph? -> Makefile
|   +-- Complex logic? -> Bash script
+-- CLI tool for users?
|   +-- Simple wrapper? -> Bash with getopts
|   +-- Complex args/subcommands? -> Use a real language (Go, Python)
+-- CI/CD pipeline step?
|   +-- Keep it minimal, fail fast, log clearly
+-- One-off automation?
    +-- Bash script with safety headers
```

## Decision Tree: Portability

```
Where will this run?
+-- Only Linux (known distro)? -> Bash 5+ features OK
+-- Linux + macOS? -> Bash 3.2+ (macOS ships old bash) or POSIX sh
+-- Containers (Alpine)? -> POSIX sh (no bash in Alpine by default)
+-- Cross-platform (Windows too)? -> Use just/make or a real language
```

---

## Script Safety & Structure

```bash
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

# Logging
log()   { printf '[%s] [%s] %s\n' "$(date -Iseconds)" "$1" "${*:2}" >&2; }
info()  { log INFO "$@"; }
warn()  { log WARN "$@"; }
error() { log ERROR "$@"; }
die()   { error "$@"; exit 1; }

# Cleanup trap — always clean up temp files
cleanup() {
    local exit_code=$?
    rm -rf "${TMPDIR:-}"
    exit "$exit_code"
}
trap cleanup EXIT

# Temp directory (auto-cleaned)
TMPDIR="$(mktemp -d)"

# Dependency checks
require() {
    for cmd in "$@"; do
        command -v "$cmd" &>/dev/null || die "Required command not found: $cmd"
    done
}
require git docker curl jq
```

---

## Argument Parsing

```bash
# Modern argument parsing with long options
usage() {
    cat >&2 <<EOF
Usage: $SCRIPT_NAME [OPTIONS] <input>

Options:
  -v, --verbose     Enable verbose output
  -o, --output DIR  Output directory (default: ./out)
  -n, --count NUM   Number of iterations (default: 1)
  -h, --help        Show this help

Examples:
  $SCRIPT_NAME --verbose -o /tmp/results input.txt
  $SCRIPT_NAME -n 5 data.csv
EOF
    exit 1
}

# Defaults
verbose=false
output="./out"
count=1

# Parse
while [[ $# -gt 0 ]]; do
    case "$1" in
        -v|--verbose) verbose=true; shift ;;
        -o|--output)  output="${2:?--output requires a value}"; shift 2 ;;
        -n|--count)   count="${2:?--count requires a value}"; shift 2 ;;
        -h|--help)    usage ;;
        --)           shift; break ;;
        -*)           die "Unknown option: $1" ;;
        *)            break ;;
    esac
done

[[ $# -lt 1 ]] && { error "Missing required argument: <input>"; usage; }
input="$1"
```

---

## Error Handling Patterns

```bash
# Retry with exponential backoff
retry() {
    local max_attempts="${1:?}"; shift
    local delay=1
    local attempt=1

    until "$@"; do
        if ((attempt >= max_attempts)); then
            error "Command failed after $max_attempts attempts: $*"
            return 1
        fi
        warn "Attempt $attempt failed, retrying in ${delay}s..."
        sleep "$delay"
        ((attempt++))
        ((delay *= 2))
    done
}

# Usage: retry 5 curl -sf https://api.example.com/health

# Safe file operations — never delete with empty variables
safe_rm() {
    local target="${1:?safe_rm requires a path}"
    [[ "$target" == "/" ]] && die "Refusing to delete /"
    [[ -e "$target" ]] && rm -rf "$target"
}

# Atomic file write (write to temp, then move)
atomic_write() {
    local target="$1"
    local tmp="${target}.tmp.$$"
    cat > "$tmp"
    mv -f "$tmp" "$target"
}
echo "new content" | atomic_write /etc/myapp/config.yml

# Error context — show which line failed
trap 'error "Failed at line $LINENO: $BASH_COMMAND"' ERR
```

---

## Common Patterns

```bash
# Process substitution — compare outputs
diff <(sort file1.txt) <(sort file2.txt)

# Read JSON with jq
api_url=$(jq -r '.api.url' config.json)
user_count=$(curl -sf "$api_url/users" | jq '.total')

# Parallel execution with controlled concurrency
parallel_run() {
    local max_jobs="${1:?}"; shift
    local job_count=0

    for item in "$@"; do
        process_item "$item" &
        ((++job_count))
        if ((job_count >= max_jobs)); then
            wait -n  # Wait for any one job to finish
            ((--job_count))
        fi
    done
    wait  # Wait for remaining
}

# Array operations
declare -a files=()
while IFS= read -r -d '' file; do
    files+=("$file")
done < <(find . -name "*.log" -print0)  # Null-delimited for safety

# Associative arrays (bash 4+)
declare -A config
config[host]="localhost"
config[port]="5432"
config[db]="myapp"

# String manipulation without external tools
filename="/path/to/archive.tar.gz"
basename="${filename##*/}"       # archive.tar.gz
extension="${basename#*.}"       # tar.gz
stem="${basename%%.*}"           # archive
dir="${filename%/*}"             # /path/to
```

---

## Justfile (Modern Task Runner)

```just
# justfile — better than Makefile for task running
set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load

# Variables
version := `git describe --tags --always`
app_name := "myapp"

# Default recipe (runs when you type `just`)
default: check

# Build the application
build:
    go build -ldflags "-X main.version={{version}}" -o bin/{{app_name}} ./cmd/{{app_name}}

# Run all checks
check: lint test

# Run tests with coverage
test *args='./...':
    go test -race -coverprofile=coverage.out {{args}}

# Lint
lint:
    golangci-lint run

# Development server with hot reload
dev:
    air

# Docker build
docker-build:
    docker build -t {{app_name}}:{{version}} .

# Deploy (requires confirmation)
[confirm("Deploy to production? (y/N)")]
deploy: check docker-build
    docker push registry.example.com/{{app_name}}:{{version}}
    kubectl set image deployment/{{app_name}} app={{app_name}}:{{version}}

# Clean build artifacts
clean:
    rm -rf bin/ dist/ coverage.out

# Recipe with arguments
migrate direction='up':
    goose -dir migrations postgres "$DATABASE_URL" {{direction}}
```

---

## Makefile Patterns

```makefile
.PHONY: all build test lint clean help
.DEFAULT_GOAL := help

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
MAKEFLAGS += --warn-undefined-variables --no-builtin-rules

# Variables
APP_NAME := myapp
VERSION  := $(shell git describe --tags --always 2>/dev/null || echo "dev")
BUILD_DIR := bin

all: lint test build ## Run all checks and build

build: ## Build the application
	@mkdir -p $(BUILD_DIR)
	go build -ldflags "-X main.version=$(VERSION)" -o $(BUILD_DIR)/$(APP_NAME) ./cmd/$(APP_NAME)

test: ## Run tests
	go test -race -cover ./...

lint: ## Run linter
	golangci-lint run

clean: ## Remove build artifacts
	rm -rf $(BUILD_DIR) coverage.out

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| No `set -euo pipefail` | Script continues after errors | Always use safety header |
| Unquoted variables `$var` | Word splitting, glob expansion | Always quote: `"$var"` |
| Parsing `ls` output | Breaks on spaces, special chars | Use globs: `for f in *.txt` or `find -print0` |
| `eval "$user_input"` | Command injection vulnerability | Never eval untrusted input |
| `cat file \| grep` | Useless use of cat | `grep pattern file` directly |
| No shellcheck | Subtle bugs go unnoticed | Run shellcheck in CI, treat as errors |
| Hardcoded paths | Breaks on other systems | Use variables, `$SCRIPT_DIR`, `command -v` |
| `rm -rf $DIR/` with empty var | Deletes `/` | Use `"${DIR:?}"` — errors if empty |

---

## Verification Checklist

Before considering shell work done:
- [ ] `shellcheck` passes with no warnings
- [ ] `shfmt` applied for consistent formatting
- [ ] `set -euo pipefail` at the top of every script
- [ ] All variables quoted: `"$var"`, `"${array[@]}"`
- [ ] Temp files cleaned up via `trap cleanup EXIT`
- [ ] Dependencies checked with `command -v`
- [ ] `--help` / usage message implemented
- [ ] Works with spaces in filenames and paths
- [ ] No `eval`, no unquoted expansions, no `ls` parsing
- [ ] Tested on target platform (bash version compatibility)
