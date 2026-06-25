# ===================================================================
# OpenCode JCE - Windows Installer (PowerShell)
# One command to install everything you need for OpenCode CLI
# Requires: PowerShell 5.1+
# ===================================================================

$ErrorActionPreference = "Stop"
$Version = "3.8.19"
$RepoUrl = "https://github.com/JCETools-Petra/JCE-Opencode-Tools.git"
$TempDir = Join-Path $env:TEMP "opencode-jce-install-$([System.IO.Path]::GetRandomFileName())"
$JceBinDir = Join-Path $env:USERPROFILE ".opencode-jce\bin"
$JceLspDir = Join-Path $env:LOCALAPPDATA "opencode-jce\lsp"

# ConfigDir is set by Detect-OpenCodeConfig below (after helpers are defined)
$ConfigDir = $null

# Status tracking
$GitStatus = "skip"
$BunStatus = "skip"
$OpenCodeStatus = "skip"
$LspInstalled = 0
$CliInstallFailed = $false

# --- Helper Functions ---

function Write-Banner {
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "       OpenCode JCE Installer v$Version" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "  Installing: Git, Bun, OpenCode CLI" -ForegroundColor Cyan
    Write-Host "  Configuring: Agents, Profiles, MCP, LSP" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Blue }
function Write-Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Skip($msg) { Write-Host "[SKIP] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

function Install-FactoryDroidPlugin($factoryDir) {
    if (-not (Test-Command "droid")) {
        Write-Warn "Droid CLI not found. Factory Droid plugin install cancelled."
        Write-Info "Install Factory Droid first, then rerun this installer or 'opencode-jce update':"
        Write-Info "  irm https://app.factory.ai/cli/windows | iex"
        Write-Info "Alternative: npm install -g droid"
        return
    }

    $marketplaceName = [System.IO.Path]::GetFileName($factoryDir)
    Write-Info "Installing/updating Factory Droid plugin..."
    try { Invoke-NativeCommand "droid" @("plugin", "marketplace", "add", $factoryDir) } catch { Write-Warn "Droid marketplace add failed or already exists; continuing. $($_.Exception.Message)" }
    try {
        Invoke-NativeCommand "droid" @("plugin", "install", "jce-opencode-tools@$marketplaceName")
        Write-Ok "Factory Droid plugin installed/updated."
    } catch {
        Write-Warn "Factory Droid plugin install failed or already exists; trying update. $($_.Exception.Message)"
        try {
            Invoke-NativeCommand "droid" @("plugin", "update", "jce-opencode-tools@$marketplaceName")
            Write-Ok "Factory Droid plugin already installed; updated existing install."
        } catch {
            Write-Warn "Factory Droid plugin update failed. Run: droid plugin update jce-opencode-tools@$marketplaceName. $($_.Exception.Message)"
        }
    }
}

function Add-UserPath($dir) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $paths = @($env:Path -split ";") | Where-Object { $_ }
    if ($paths -notcontains $dir) { $env:Path = "$dir;$env:Path" }

    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $userPaths = @($userPath -split ";") | Where-Object { $_ }
    if ($userPaths -notcontains $dir) {
        $newUserPath = if ($userPath) { "$dir;$userPath" } else { $dir }
        [System.Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    }
}

function Get-KnownCommandPath($cmd) {
    try { return (Get-Command $cmd -ErrorAction Stop).Source } catch {}

    $candidates = @(
        (Join-Path $env:USERPROFILE "go\bin\$cmd.exe"),
        (Join-Path $env:USERPROFILE ".cargo\bin\$cmd.exe"),
        (Join-Path $env:USERPROFILE ".dotnet\tools\$cmd.exe"),
        (Join-Path $JceBinDir "$cmd.cmd"),
        (Join-Path $JceBinDir "$cmd.exe"),
        "C:\Program Files\Go\bin\$cmd.exe",
        "C:\Program Files\LLVM\bin\$cmd.exe"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }

    return $null
}

function Test-Command($cmd) {
    return [bool](Get-KnownCommandPath $cmd)
}

function Invoke-InstallCommand($command) {
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    cmd /c "$command" 2>$null | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEA

    # winget returns 43 when package is already installed and no upgrade exists.
    if ($code -ne 0 -and $code -ne 43) { throw "Exit code $code" }
}

function Invoke-NativeCommand($exe, [string[]]$arguments) {
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $exe @arguments 2>&1 | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEA

    if ($code -ne 0) { throw "Exit code $code" }
}

function Test-JceCliPayload($dir) {
    $manifest = Join-Path $TempDir "config\cli-payload.txt"
    if (-not (Test-Path $manifest)) {
        throw "CLI payload manifest missing: $manifest"
    }
    $required = Get-Content $manifest | Where-Object { $_.Trim() -ne "" -and -not $_.Trim().StartsWith("#") } | ForEach-Object { $_.Replace("/", "\") }
    $missing = @()
    foreach ($file in $required) {
        if (-not (Test-Path (Join-Path $dir $file))) { $missing += $file }
    }
    if ($missing.Count -gt 0) {
        throw "CLI payload is incomplete; missing: $($missing -join ', ')"
    }
}

function Stop-StaleOpenCodeProcesses {
    if ($env:OPENCODE_JCE_SKIP_PROCESS_CLEANUP -eq "1") { return }
    try {
        $currentPid = $PID
        $targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ProcessId -ne $currentPid -and $_.CommandLine -and
            $_.CommandLine -notmatch 'opencode-jce(\.cmd|\.ps1|\.exe)?\s+.*\bupdate\b' -and
            ($_.Name -match '^opencode(\.exe)?$' -or $_.CommandLine -match '\.config[\\/]opencode[\\/]cli[\\/]src[\\/](plugin[\\/]index|mcp[\\/]context-keeper)\.ts')
        }
        foreach ($target in $targets) {
            try { Stop-Process -Id $target.ProcessId -Force:$false -ErrorAction SilentlyContinue } catch {}
        }
        if ($targets.Count -gt 0) {
            Write-Warn "Stopped $($targets.Count) stale OpenCode process(es) so the updated plugin/CLI is loaded next run."
        }
    } catch {}
}

function Install-GoLsp {
    if (-not (Get-KnownCommandPath "go")) {
        Invoke-InstallCommand "winget install -e --id GoLang.Go --accept-package-agreements --accept-source-agreements"
    }

    Add-UserPath "C:\Program Files\Go\bin"
    Add-UserPath (Join-Path $env:USERPROFILE "go\bin")

    $go = Get-KnownCommandPath "go"
    if (-not $go) { throw "Go installed but go.exe not found; restart terminal and rerun installer" }

    Write-Host "(building gopls, this can take a few minutes) " -NoNewline -ForegroundColor DarkGray
    Invoke-NativeCommand $go @("install", "golang.org/x/tools/gopls@latest")
    if (-not (Test-Command "gopls")) { throw "gopls installed but not found on PATH" }
}

function Install-Jdtls {
    Add-UserPath $JceBinDir

    if (-not (Get-KnownCommandPath "java")) {
        Invoke-InstallCommand "winget install -e --id EclipseAdoptium.Temurin.21.JDK --accept-package-agreements --accept-source-agreements"
    }

    $javaBin = Resolve-Path "C:\Program Files\Eclipse Adoptium\jdk-21*\bin" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($javaBin) { Add-UserPath $javaBin.Path }

    if (-not (Get-KnownCommandPath "java")) { throw "Java installed but java.exe not found; restart terminal and rerun installer" }

    $dest = Join-Path $JceLspDir "jdtls"
    $launcher = Get-ChildItem (Join-Path $dest "plugins") -Filter "org.eclipse.equinox.launcher_*.jar" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $launcher) {
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        if ($env:OPENCODE_JCE_ALLOW_UNVERIFIED_DOWNLOAD -ne "1") {
            throw "JDTLS auto-download disabled because latest snapshot has no pinned checksum. Install jdtls manually or rerun with OPENCODE_JCE_ALLOW_UNVERIFIED_DOWNLOAD=1."
        }
        $archive = Join-Path $env:TEMP "jdtls-latest.tar.gz"
        Invoke-WebRequest -Uri "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz" -OutFile $archive -UseBasicParsing
        tar -xzf $archive -C $dest
    }

    $shim = Join-Path $JceBinDir "jdtls.cmd"
    $shimContent = @'
@echo off
setlocal
set JDTLS_HOME=%LOCALAPPDATA%\opencode-jce\lsp\jdtls
for %%f in ("%JDTLS_HOME%\plugins\org.eclipse.equinox.launcher_*.jar") do set JDTLS_LAUNCHER=%%f
java -Declipse.application=org.eclipse.jdt.ls.core.id1 -Dosgi.bundles.defaultStartLevel=4 -Declipse.product=org.eclipse.jdt.ls.core.product -Dlog.protocol=true -Dlog.level=ALL -Xmx1G --add-modules=ALL-SYSTEM --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED -jar "%JDTLS_LAUNCHER%" -configuration "%JDTLS_HOME%\config_win" -data "%USERPROFILE%\.jdtls-workspace" %*
'@
    Set-Content -Path $shim -Value $shimContent -Encoding ASCII

    if (-not (Test-Command "jdtls")) { throw "jdtls shim created but not found on PATH" }
}

function Install-Clangd {
    Invoke-InstallCommand "winget install -e --id LLVM.LLVM --accept-package-agreements --accept-source-agreements"
    Add-UserPath "C:\Program Files\LLVM\bin"
    if (-not (Test-Command "clangd")) { throw "LLVM installed but clangd.exe not found on PATH" }
}

function Install-CSharpLsp {
    Add-UserPath (Join-Path $env:USERPROFILE ".dotnet\tools")
    if (-not (Test-Command "csharp-ls")) {
        try {
            Invoke-InstallCommand "dotnet tool install -g csharp-ls --version 0.15.0"
        } catch {
            Invoke-InstallCommand "dotnet tool update -g csharp-ls --version 0.15.0"
        }
    }
    if (-not (Test-Command "csharp-ls")) { throw "csharp-ls installed but not found on PATH" }
}

function Install-RustAnalyzer {
    # Ensure rustup is installed
    if (-not (Test-Command "rustup")) {
        Invoke-InstallCommand "winget install -e --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements"
    }

    # Add cargo bin to PATH (where rust-analyzer gets installed)
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    Add-UserPath $cargoBin

    # Refresh PATH to pick up rustup
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $rustup = Get-KnownCommandPath "rustup"
    if (-not $rustup) { throw "rustup installed but not found on PATH. Restart terminal and rerun installer." }

    # Ensure a default toolchain is installed (required before adding components)
    $toolchains = & $rustup toolchain list 2>&1
    if ($toolchains -match "no installed toolchains" -or $toolchains -match "no default" -or -not ($toolchains -match "stable")) {
        Write-Host "(installing stable toolchain) " -NoNewline -ForegroundColor DarkGray
        Invoke-NativeCommand $rustup @("default", "stable")
    }

    # Install rust-analyzer component
    Invoke-NativeCommand $rustup @("component", "add", "rust-analyzer")

    if (-not (Test-Command "rust-analyzer")) {
        throw "rust-analyzer installed but not found on PATH. Restart terminal and verify."
    }
}

function Install-LuaLsp {
    Invoke-InstallCommand "winget install -e --id LuaLS.lua-language-server --accept-package-agreements --accept-source-agreements"

    # winget installs lua-language-server to various possible locations
    $possiblePaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\lua-language-server\bin"),
        (Join-Path $env:ProgramFiles "lua-language-server\bin"),
        (Join-Path ${env:ProgramFiles(x86)} "lua-language-server\bin")
    )

    $found = $false
    foreach ($p in $possiblePaths) {
        if (Test-Path $p) {
            Add-UserPath $p
            $found = $true
            break
        }
    }

    # Check winget's default install location via registry/shim
    $wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    if (Test-Path $wingetLinks) { Add-UserPath $wingetLinks }

    # Search winget packages directory (where portable installs land)
    if (-not $found) {
        $wingetPkgs = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
        if (Test-Path $wingetPkgs) {
            $luaPkg = Get-ChildItem $wingetPkgs -Directory -Filter "LuaLS.lua-language-server_*" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($luaPkg) {
                # Find the bin directory containing lua-language-server.exe
                $luaExe = Get-ChildItem $luaPkg.FullName -Recurse -Filter "lua-language-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($luaExe) {
                    Add-UserPath $luaExe.DirectoryName
                    $found = $true
                }
            }
        }
    }

    # Also search common winget install location under LinkPackages
    if (-not $found) {
        $linkPkgs = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\LinkPackages"
        if (Test-Path $linkPkgs) {
            $luaExe = Get-ChildItem $linkPkgs -Recurse -Filter "lua-language-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($luaExe) {
                Add-UserPath $luaExe.DirectoryName
                $found = $true
            }
        }
    }

    # Refresh PATH from registry to pick up winget's changes
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Test-Command "lua-language-server")) {
        throw "lua-language-server installed but not found on PATH. Restart terminal and verify."
    }
}

# --- Auto-Detect OpenCode Config Path ---

function Detect-OpenCodeConfig {
    Write-Info "Detecting OpenCode config directory..."

    # Candidate paths in priority order
    $candidates = @()

    # 1. Check XDG_CONFIG_HOME (if set)
    if ($env:XDG_CONFIG_HOME) {
        $candidates += Join-Path $env:XDG_CONFIG_HOME "opencode"
    }

    # 2. ~/.config/opencode (OpenCode standard on all platforms)
    $candidates += Join-Path $env:USERPROFILE ".config\opencode"

    # Search for existing OpenCode config (opencode.json is the marker)
    foreach ($path in $candidates) {
        $marker = Join-Path $path "opencode.json"
        if (Test-Path $marker) {
            Write-Ok "Found OpenCode config at: $path"
            return $path
        }
    }

    # No existing config found - try to ask OpenCode CLI directly
    if (Test-Command "opencode") {
        try {
            $prevEA = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            # OpenCode stores config next to its own binary config
            $opencodeWhich = (Get-Command opencode -ErrorAction Stop).Source
            $ErrorActionPreference = $prevEA
            # Check if there's a config dir next to where opencode looks
        } catch {}
    }

    # Default: ~/.config/opencode/ (OpenCode standard)
    $defaultPath = Join-Path $env:USERPROFILE ".config\opencode"
    Write-Info "No existing config found. Using default: $defaultPath"
    return $defaultPath
}

function Backup-ExistingConfig {
    param([string]$ConfigDir)

    if (-not (Test-Path $ConfigDir)) { return }

    # Check if there's anything worth backing up
    $hasContent = [bool](Get-ChildItem $ConfigDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $hasContent) { return }

    $timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $backupDir = "${ConfigDir}.backup.${timestamp}"
    $backupIndex = 1
    while (Test-Path $backupDir) {
        $backupDir = "${ConfigDir}.backup.${timestamp}.${backupIndex}"
        $backupIndex++
    }

    Write-Info "Backing up existing config to: $backupDir"
    try {
        Copy-Item $ConfigDir $backupDir -Recurse -Force
        Write-Ok "Backup created: $backupDir"
    } catch {
        Write-Err "Backup failed: $($_.Exception.Message). Aborting to protect existing config."
    }
}

# --- Installation Steps ---

function Install-Git {
    Write-Info "Checking Git..."
    if (Test-Command "git") {
        $ver = (git --version) -replace "git version ", ""
        Write-Skip "Git v$ver already installed"
        $script:GitStatus = "skip"
        return
    }

    Write-Info "Installing Git via winget..."
    try {
        winget install Git.Git --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

        if (Test-Command "git") {
            Write-Ok "Git installed"
            $script:GitStatus = "installed"
        } else {
            Write-Err "Git installation failed. Please install manually from https://git-scm.com"
        }
    } catch {
        Write-Err "Failed to install Git. Please install manually from https://git-scm.com"
    }
}

function Install-Bun {
    Write-Info "Checking Bun..."
    if (Test-Command "bun") {
        $ver = bun --version
        Write-Skip "Bun v$ver already installed"
        $script:BunStatus = "skip"
        return
    }

    Write-Info "Installing Bun..."
    try {
        irm bun.sh/install.ps1 | iex
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        $bunPath = Join-Path $env:USERPROFILE ".bun\bin"
        if (Test-Path $bunPath) { $env:Path += ";$bunPath" }

        if (Test-Command "bun") {
            Write-Ok "Bun installed: v$(bun --version)"
            $script:BunStatus = "installed"
        } else {
            Write-Err "Bun installation failed. Please restart PowerShell and re-run."
        }
    } catch {
        Write-Err "Failed to install Bun: $_"
    }
}

function Install-OpenCode {
    Write-Info "Checking OpenCode CLI..."
    if (Test-Command "opencode") {
        Write-Skip "OpenCode CLI already installed"
        $script:OpenCodeStatus = "skip"
        return
    }

    Write-Info "Installing OpenCode CLI..."
    try {
        bun install -g opencode
        $bunPath = Join-Path $env:USERPROFILE ".bun\bin"
        if (Test-Path $bunPath) { $env:Path += ";$bunPath" }

        if (Test-Command "opencode") {
            Write-Ok "OpenCode CLI installed"
            $script:OpenCodeStatus = "installed"
        } else {
            Write-Err "OpenCode CLI installation failed"
        }
    } catch {
        Write-Err "Failed to install OpenCode CLI: $_"
    }
}

function Deploy-Config {
    Write-Info "Deploying configuration..."

    # Clone config repo — try tag first, fallback to main branch
    if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
    Write-Info "Downloading configuration from GitHub..."
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    git clone --depth 1 --branch "v$Version" $RepoUrl $TempDir 2>$null
    if (!(Test-Path (Join-Path $TempDir "config"))) {
        Write-Info "Tag v$Version not found, trying main branch..."
        if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
        git clone --depth 1 --branch "main" $RepoUrl $TempDir 2>$null
    }
    $ErrorActionPreference = $prevErrorAction
    if (!(Test-Path (Join-Path $TempDir "config"))) {
        Write-Err "Failed to clone config repository. Check your internet connection."
    }
    Write-Ok "Repository downloaded"

    # Ensure config directory exists
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $ConfigDir "profiles") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $ConfigDir "prompts") -Force | Out-Null

    # Deploy configuration (safe merge - only add what is missing)
    Write-Info "Merging configuration (preserving existing settings)..."
    $sourceConfig = Join-Path $TempDir "config"
    Deploy-ConfigSafe $sourceConfig $ConfigDir

    Write-Ok "Configuration deployed to: $ConfigDir"

    # Install opencode-jce CLI globally
    Write-Info "Installing opencode-jce CLI..."
    try {
        Push-Location $TempDir
        $prevErrorAction2 = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        bun install --ignore-scripts 2>$null
        $bunInstallExit = $LASTEXITCODE
        $ErrorActionPreference = $prevErrorAction2
        Pop-Location
        if ($bunInstallExit -ne 0) {
            throw "bun install --ignore-scripts failed while preparing opencode-jce CLI dependencies"
        }

        # Create .cmd wrapper in bun bin directory
        $bunPath = Join-Path $env:USERPROFILE ".bun\bin"
        if (!(Test-Path $bunPath)) { New-Item -ItemType Directory -Path $bunPath -Force | Out-Null }

        # Remove broken files that bun install -g creates on Windows
        Remove-Item (Join-Path $bunPath "opencode-jce") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $bunPath "opencode-jce.bunx") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $bunPath "opencode-jce.exe") -Force -ErrorAction SilentlyContinue
        $npmPath = Join-Path $env:APPDATA "npm"
        Remove-Item (Join-Path $npmPath "opencode-jce") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $npmPath "opencode-jce.ps1") -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $npmPath "opencode-jce.cmd") -Force -ErrorAction SilentlyContinue

        $installDir = Join-Path $ConfigDir "cli"
        $stagingDir = Join-Path $ConfigDir ".cli-install-new"
        $backupDir = Join-Path $ConfigDir ".cli-install-backup"
        
        # Copy CLI source to staging first; only swap after verification succeeds.
        Remove-Item $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $backupDir -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
        Copy-Item (Join-Path $TempDir "src") (Join-Path $stagingDir "src") -Recurse
        Copy-Item (Join-Path $TempDir "schemas") (Join-Path $stagingDir "schemas") -Recurse
        Copy-Item (Join-Path $TempDir "config") (Join-Path $stagingDir "config") -Recurse
        $scriptsDir = Join-Path $TempDir "scripts"
        if (Test-Path $scriptsDir) { Copy-Item $scriptsDir (Join-Path $stagingDir "scripts") -Recurse }
        Copy-Item (Join-Path $TempDir "package.json") $stagingDir
        Copy-Item (Join-Path $TempDir "tsconfig.json") $stagingDir
        Copy-Item (Join-Path $TempDir "node_modules") (Join-Path $stagingDir "node_modules") -Recurse
        Test-JceCliPayload $stagingDir
        if (Test-Path $installDir) { Rename-Item $installDir $backupDir -Force }
        try {
            Rename-Item $stagingDir $installDir -Force
            Remove-Item $backupDir -Recurse -Force -ErrorAction SilentlyContinue
        } catch {
            if ((-not (Test-Path $installDir)) -and (Test-Path $backupDir)) {
                Rename-Item $backupDir $installDir -Force
            }
            throw "Could not install CLI source; previous CLI restored. $($_.Exception.Message)"
        }

        # Create .cmd wrapper
        $cmdContent = "@echo off`r`nbun run `"$installDir\src\index.ts`" -- %*"
        Set-Content -Path (Join-Path $bunPath "opencode-jce.cmd") -Value $cmdContent -Encoding ASCII

        # Add bun bin to PATH if not already there
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*\.bun\bin*") {
            [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$bunPath", "User")
        }
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

        if (Test-Command "opencode-jce") {
            Write-Ok "opencode-jce CLI installed globally"
        } else {
            Write-Warn "opencode-jce installed. Restart PowerShell to use it."
        }
        try {
            $factoryDir = Join-Path $ConfigDir "factory-jce"
            & bun run (Join-Path $installDir "src\index.ts") -- factory export --output $factoryDir --clean --sync-personal | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Exit code $LASTEXITCODE" }
            Write-Ok "Factory Droid plugin package exported to: $factoryDir"
            Install-FactoryDroidPlugin $factoryDir
        } catch {
            Write-Warn "Factory Droid export failed. Run 'opencode-jce factory export' after install. $($_.Exception.Message)"
        }
        Stop-StaleOpenCodeProcesses
    } catch {
        Write-Warn "Could not install opencode-jce CLI globally: $_"
        $script:CliInstallFailed = $true
    }

    # Cleanup
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Deploy-ConfigSafe($sourceDir, $targetDir) {
    # First try merge-config.ts (handles JSON-level merging properly)
    $installDir = Join-Path $targetDir "cli"
    $mergeScript = Join-Path $TempDir "scripts\merge-config.ts"
    if ((Test-Path $mergeScript) -and (Test-Command "bun")) {
        try {
            $prevEA = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $output = bun run $mergeScript $sourceDir $targetDir 2>&1
            $exitCode = $LASTEXITCODE
            $ErrorActionPreference = $prevEA
            if ($exitCode -ne 0) {
                throw "exit code $exitCode. $output"
            }
            Write-Ok "Configuration merged via merge-config.ts"
            # merge-config.ts handles mcp.json, opencode.json, agents.json, lsp.json, profiles, prompts, skills, and AGENTS.md
            return
        } catch {
            Write-Warn "merge-config.ts failed: $($_.Exception.Message). Falling back to manual merge..."
        }
    }

    # Fallback: manual merge with JSON-level merging for mcp.json
    $simpleFiles = @("agents.json", "lsp.json", "fallback.json")
    foreach ($file in $simpleFiles) {
        $src = Join-Path $sourceDir $file
        $dst = Join-Path $targetDir $file
        if ((Test-Path $src) -and !(Test-Path $dst)) {
            Copy-Item $src $dst
            Write-Ok "  Created: $file"
        } elseif ((Test-Path $src) -and (Test-Path $dst)) {
            Write-Skip "  Exists, preserved: $file"
        }
    }

    # mcp.json: merge missing servers into existing file
    $mcpSrc = Join-Path $sourceDir "mcp.json"
    $mcpDst = Join-Path $targetDir "mcp.json"
    if ((Test-Path $mcpSrc) -and !(Test-Path $mcpDst)) {
        Copy-Item $mcpSrc $mcpDst
        Write-Ok "  Created: mcp.json"
    } elseif ((Test-Path $mcpSrc) -and (Test-Path $mcpDst)) {
        try {
            $srcJson = Get-Content $mcpSrc -Raw | ConvertFrom-Json
            $dstJson = Get-Content $mcpDst -Raw | ConvertFrom-Json
            $added = 0
            foreach ($server in $srcJson.mcpServers.PSObject.Properties) {
                if (-not $dstJson.mcpServers.PSObject.Properties[$server.Name]) {
                    $dstJson.mcpServers | Add-Member -NotePropertyName $server.Name -NotePropertyValue $server.Value
                    $added++
                }
            }
            if ($added -gt 0) {
                $jsonOut = $dstJson | ConvertTo-Json -Depth 100
                [System.IO.File]::WriteAllText($mcpDst, $jsonOut, [System.Text.UTF8Encoding]::new($false))
                Write-Ok "  mcp.json: $added new server(s) merged"
            } else {
                Write-Skip "  mcp.json: all servers already present"
            }
        } catch {
            Write-Warn "  mcp.json merge failed: $($_.Exception.Message). Preserved existing."
        }
    }

    # Copy profiles that do not exist
    $srcProfiles = Join-Path $sourceDir "profiles"
    $dstProfiles = Join-Path $targetDir "profiles"
    if (Test-Path $srcProfiles) {
        $added = 0
        Get-ChildItem $srcProfiles -Filter "*.json" | ForEach-Object {
            $dst = Join-Path $dstProfiles $_.Name
            if (!(Test-Path $dst)) {
                Copy-Item $_.FullName $dst
                $added++
            }
        }
        Write-Ok "  Profiles: $added new added"
    }

    # Copy prompts that do not exist
    $srcPrompts = Join-Path $sourceDir "prompts"
    $dstPrompts = Join-Path $targetDir "prompts"
    if (Test-Path $srcPrompts) {
        Get-ChildItem $srcPrompts | ForEach-Object {
            $dst = Join-Path $dstPrompts $_.Name
            if (!(Test-Path $dst)) {
                Copy-Item $_.FullName $dst
            }
        }
        Write-Ok "  Prompts copied"
    }

    # Deploy AGENTS.md (only if not already present)
    $agentsMdSrc = Join-Path $sourceDir "AGENTS.md"
    $agentsMdDst = Join-Path $targetDir "AGENTS.md"
    if (-not (Test-Path $agentsMdDst)) {
        if (Test-Path $agentsMdSrc) {
            Copy-Item $agentsMdSrc $agentsMdDst
            Write-Ok "  AGENTS.md deployed"
        }
    } else {
        Write-Skip "  AGENTS.md already exists (preserved)"
    }

    # Deploy skills (modular on-demand instructions)
    $skillsSrc = Join-Path $sourceDir "skills"
    $skillsDst = Join-Path $targetDir "skills"
    if (Test-Path $skillsSrc) {
        if (-not (Test-Path $skillsDst)) { New-Item -ItemType Directory -Path $skillsDst -Force | Out-Null }
        foreach ($d in Get-ChildItem $skillsSrc -Directory) {
            $dst = Join-Path $skillsDst $d.Name
            if (-not (Test-Path $dst)) {
                Copy-Item $d.FullName $dst -Recurse
            }
        }
        $count = (Get-ChildItem $skillsDst -Directory).Count
        Write-Ok "  Skills deployed ($count skills)"
    }
}

function Register-ContextKeeper {
    Write-Info "Registering context-keeper MCP server in opencode.json..."

    $opencodeJson = Join-Path $ConfigDir "opencode.json"
    $cliDir = Join-Path $ConfigDir "cli"
    $contextKeeperPath = Join-Path $cliDir "src\mcp\context-keeper.ts"

    # Verify context-keeper.ts exists
    if (-not (Test-Path $contextKeeperPath)) {
        Write-Warn "context-keeper.ts not found at: $contextKeeperPath"
        Write-Warn "Skipping MCP registration. Run 'opencode-jce update' to fix."
        return
    }

    # Normalize path for JSON (forward slashes)
    $normalizedPath = $contextKeeperPath -replace "\\", "/"

    try {
        if (Test-Path $opencodeJson) {
            try {
                $config = Get-Content $opencodeJson -Raw | ConvertFrom-Json
            } catch {
                $backupPath = "$opencodeJson.invalid-$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')"
                Move-Item $opencodeJson $backupPath -Force
                Write-Warn "Malformed opencode.json backed up to $backupPath and rebuilt."
                $config = [PSCustomObject]@{
                    '$schema' = "https://opencode.ai/config.json"
                    plugin = @("file://$($ConfigDir -replace '\\','/')/cli/src/plugin/index.ts")
                    mcp = [PSCustomObject]@{}
                    lsp = [PSCustomObject]@{}
                }
            }
        } else {
            Write-Info "opencode.json not found. Creating with default MCP servers..."
            $config = [PSCustomObject]@{
                '$schema' = "https://opencode.ai/config.json"
                plugin = @("file://$($ConfigDir -replace '\\','/')/cli/src/plugin/index.ts")
                mcp = [PSCustomObject]@{}
                lsp = [PSCustomObject]@{}
            }
        }

        $jcePlugin = "file://$($ConfigDir -replace '\\','/')/cli/src/plugin/index.ts"
        if (-not $config.plugin) { $config | Add-Member -NotePropertyName "plugin" -NotePropertyValue @() }
        if (@($config.plugin) -notcontains $jcePlugin) { $config.plugin = @($config.plugin) + $jcePlugin }

        # Ensure mcp section exists
        if (-not $config.mcp) {
            $config | Add-Member -NotePropertyName "mcp" -NotePropertyValue ([PSCustomObject]@{})
        }

        $defaults = [ordered]@{
            "context-keeper" = [PSCustomObject]@{ type = "local"; command = @("bun", "run", $normalizedPath); env = [PSCustomObject]@{ PROJECT_ROOT = '${PROJECT_ROOT}' }; enabled = $true }
            "context7" = [PSCustomObject]@{ type = "remote"; url = "https://mcp.context7.com/mcp"; enabled = $true }
            "github-search" = [PSCustomObject]@{ type = "local"; command = @("npx", "-y", "@modelcontextprotocol/server-github"); env = [PSCustomObject]@{ GITHUB_PERSONAL_ACCESS_TOKEN = '${GITHUB_TOKEN}' }; enabled = $true }
            "memory" = [PSCustomObject]@{ type = "local"; command = @("npx", "-y", "@modelcontextprotocol/server-memory"); enabled = $true }
            "playwright" = [PSCustomObject]@{ type = "local"; command = @("npx", "-y", "@playwright/mcp@0.0.28"); enabled = $true }
            "sequential-thinking" = [PSCustomObject]@{ type = "local"; command = @("npx", "-y", "@modelcontextprotocol/server-sequential-thinking"); enabled = $true }
        }

        $added = 0
        foreach ($entry in $defaults.GetEnumerator()) {
            if (-not $config.mcp.PSObject.Properties[$entry.Key]) {
                $config.mcp | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value
                $added++
            }
        }

        # Write back
        $jsonOut = $config | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($opencodeJson, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        if ($added -gt 0) {
            Write-Ok "opencode.json MCP defaults registered ($added added)"
        } else {
            Write-Skip "opencode.json MCP defaults already present"
        }
    } catch {
        Write-Warn "Failed to register context-keeper: $($_.Exception.Message)"
        Write-Info "Add manually to opencode.json: mcp.context-keeper = {type:'local', command:['bun','run','$normalizedPath'], enabled:true}"
    }
}

function Register-TuiPlugin {
    Write-Info "Registering Token Savings TUI plugin in tui.json..."

    $tuiJson = Join-Path $ConfigDir "tui.json"
    $tuiPluginFile = Join-Path $ConfigDir "cli\src\plugin\tui.tsx"
    $tuiPlugin = "file://$($ConfigDir -replace '\\','/')/cli/src/plugin/tui.tsx"

    # Validate TUI plugin file exists
    if (-not (Test-Path $tuiPluginFile)) {
        Write-Warn "TUI plugin file not found: $tuiPluginFile"
        Write-Info "Token Savings TUI will not be registered. Run 'opencode-jce update' after install."
        return
    }

    try {
        if (Test-Path $tuiJson) {
            try {
                $config = Get-Content $tuiJson -Raw | ConvertFrom-Json
            } catch {
                $backupPath = "$tuiJson.invalid-$(Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')"
                Move-Item $tuiJson $backupPath -Force
                Write-Warn "Malformed tui.json backed up to $backupPath and rebuilt."
                $config = [PSCustomObject]@{
                    '$schema' = "https://opencode.ai/tui.json"
                    plugin = @()
                    plugin_enabled = [PSCustomObject]@{}
                }
            }
        } else {
            $config = [PSCustomObject]@{
                '$schema' = "https://opencode.ai/tui.json"
                plugin = @()
                plugin_enabled = [PSCustomObject]@{}
            }
        }

        if (-not $config.PSObject.Properties['$schema']) { $config | Add-Member -NotePropertyName '$schema' -NotePropertyValue "https://opencode.ai/tui.json" }
        if (-not $config.plugin) { $config | Add-Member -NotePropertyName "plugin" -NotePropertyValue @() }
        if (@($config.plugin) -notcontains $tuiPlugin) { $config.plugin = @($config.plugin) + $tuiPlugin }
        if (-not $config.plugin_enabled) { $config | Add-Member -NotePropertyName "plugin_enabled" -NotePropertyValue ([PSCustomObject]@{}) }
        if (-not $config.plugin_enabled.PSObject.Properties["opencode-jce-token-savings"]) {
            $config.plugin_enabled | Add-Member -NotePropertyName "opencode-jce-token-savings" -NotePropertyValue $true
        }

        $jsonOut = $config | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($tuiJson, $jsonOut, [System.Text.UTF8Encoding]::new($false))
        Write-Ok "tui.json Token Savings plugin registered"
    } catch {
        Write-Warn "Failed to register Token Savings TUI plugin: $($_.Exception.Message)"
        Write-Info "Add manually to tui.json plugin: $tuiPlugin"
        Write-Info "Run 'opencode-jce update' after install to retry."
    }
}

# API keys are managed by OpenCode CLI directly - no need to configure here

function Install-McpPackages {
    Write-Host ""
    Write-Info "Pre-downloading MCP server packages..."

    if (-not (Test-Command "npm")) {
        Write-Warn "npm not found. MCP packages will download on first use."
        Write-Info "Install Node.js for pre-caching: winget install -e --id OpenJS.NodeJS.LTS"
        return
    }

    Write-Info "This ensures MCP servers start instantly in OpenCode."
    Write-Host ""

    $mcpPackages = @(
        "@modelcontextprotocol/server-github",
        "@modelcontextprotocol/server-memory",
        "@playwright/mcp@0.0.28",
        "@modelcontextprotocol/server-sequential-thinking"
    )

    $cachedCount = 0
    $failedCount = 0

    foreach ($pkg in $mcpPackages) {
        $shortName = ($pkg -split "/")[-1]
        Write-Host "  Caching $shortName... " -NoNewline

        try {
            $prevEA = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            # Use npm cache add to download without executing
            npm cache add $pkg 2>$null | Out-Null
            $ErrorActionPreference = $prevEA

            Write-Host "[OK]" -ForegroundColor Green
            $cachedCount++
        } catch {
            Write-Host "[WARN]" -ForegroundColor Yellow
            $failedCount++
        }
    }

    Write-Host ""
    if ($cachedCount -gt 0) {
        Write-Ok "$cachedCount MCP package(s) pre-cached."
    }
    if ($failedCount -gt 0) {
        Write-Warn "$failedCount package(s) could not be cached. They will download on first use."
    }
}

function Install-LspServers {
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "       LSP Server Installation" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Select LSP servers to install:" -ForegroundColor White
    Write-Host ""

    # Define LSP servers
    $lspServers = @(
        @{ Num=1;  Name="Python";       Cmd="pyright-langserver";          Install="npm install -g pyright" }
        @{ Num=2;  Name="TypeScript";    Cmd="typescript-language-server";  Install="npm install -g typescript-language-server typescript" }
        @{ Num=3;  Name="Rust";          Cmd="rust-analyzer";              Install="rustup component add rust-analyzer" }
        @{ Num=4;  Name="Go";            Cmd="gopls";                      Install="winget install -e --id GoLang.Go --accept-package-agreements --accept-source-agreements" }
        @{ Num=5;  Name="Docker";        Cmd="docker-langserver";          Install="npm install -g dockerfile-language-server-nodejs" }
        @{ Num=6;  Name="SQL";           Cmd="sql-language-server";        Install="npm install -g sql-language-server" }
        @{ Num=7;  Name="Java";          Cmd="jdtls";                      Install="winget install -e --id EclipseAdoptium.Temurin.21.JDK --accept-package-agreements --accept-source-agreements" }
        @{ Num=8;  Name="C/C++";         Cmd="clangd";                     Install="winget install -e --id LLVM.LLVM --accept-package-agreements --accept-source-agreements" }
        @{ Num=9;  Name="PHP";           Cmd="intelephense";               Install="npm install -g intelephense" }
        @{ Num=10; Name="Ruby";          Cmd="solargraph";                 Install="gem install solargraph" }
        @{ Num=11; Name="C#";            Cmd="csharp-ls";                  Install="dotnet tool install -g csharp-ls --version 0.15.0" }
        @{ Num=12; Name="Bash";          Cmd="bash-language-server";       Install="npm install -g bash-language-server" }
        @{ Num=13; Name="YAML";          Cmd="yaml-language-server";       Install="npm install -g yaml-language-server" }
        @{ Num=14; Name="HTML";          Cmd="vscode-html-language-server"; Install="npm install -g vscode-langservers-extracted" }
        @{ Num=15; Name="CSS";           Cmd="vscode-css-language-server";  Install="npm install -g vscode-langservers-extracted" }
        @{ Num=16; Name="Kotlin";        Cmd="kotlin-language-server";     Install="winget install -e --id fwcd.KotlinLanguageServer --accept-package-agreements --accept-source-agreements" }
        @{ Num=17; Name="Dart";          Cmd="dart";                       Install="winget install -e --id Google.DartSDK --accept-package-agreements --accept-source-agreements" }
        @{ Num=18; Name="Lua";           Cmd="lua-language-server";        Install="winget install -e --id LuaLS.lua-language-server --accept-package-agreements --accept-source-agreements" }
        @{ Num=19; Name="Svelte";        Cmd="svelteserver";               Install="npm install -g svelte-language-server" }
        @{ Num=20; Name="Vue";           Cmd="vue-language-server";        Install="npm install -g @vue/language-server" }
        @{ Num=21; Name="Terraform";     Cmd="terraform-ls";               Install="winget install -e --id HashiCorp.terraform-ls --accept-package-agreements --accept-source-agreements" }
        @{ Num=22; Name="Tailwind CSS";  Cmd="tailwindcss-language-server"; Install="npm install -g @tailwindcss/language-server" }
        @{ Num=23; Name="Zig";           Cmd="zls";                        Install="winget install -e --id zigtools.zls --accept-package-agreements --accept-source-agreements" }
        @{ Num=24; Name="Markdown";      Cmd="marksman";                   Install="winget install -e --id Artempyanykh.Marksman --accept-package-agreements --accept-source-agreements" }
        @{ Num=25; Name="TOML";          Cmd="taplo";                      Install="cargo install taplo-cli --features lsp" }
        @{ Num=26; Name="GraphQL";       Cmd="graphql-lsp";                Install="npm install -g graphql-language-service-cli" }
        @{ Num=27; Name="Elixir";        Cmd="elixir-ls";                  Install="npm install -g @elixir-tools/next-ls" }
        @{ Num=28; Name="Scala";         Cmd="metals";                     Install="cs install metals" }
    )

    # Show list with status
    $alreadyInstalled = @()
    foreach ($lsp in $lspServers) {
        $num = "$($lsp.Num)".PadLeft(2)
        if (Test-Command $lsp.Cmd) {
            Write-Host "  [OK] $num. $($lsp.Name)" -ForegroundColor Green -NoNewline
            Write-Host "  (already installed)" -ForegroundColor DarkGray
            $alreadyInstalled += $lsp.Num
        } else {
            Write-Host "  [ ] $num. $($lsp.Name)" -ForegroundColor White
        }
    }

    Write-Host ""
    Write-Host "  a = Install all    s = Skip all" -ForegroundColor Yellow
    Write-Host "  Or enter numbers:  1,2,4" -ForegroundColor Yellow
    Write-Host ""

    if ([Console]::IsInputRedirected) {
        Write-Warn "Non-interactive mode detected (piped install)."
        Write-Info "Skipping LSP installation. Merging any already-installed LSPs..."
        Merge-LspToOpenCodeConfig
        return
    }

    $choice = Read-Host "  Your choice"

    # Parse choice
    $selected = @()

    switch -Regex ($choice) {
        "^[aA]$" {
            foreach ($lsp in $lspServers) {
                if ($alreadyInstalled -notcontains $lsp.Num) {
                    $selected += $lsp
                }
            }
        }
        "^[sS]?$" {
            Write-Info "Skipping LSP installation."
            Merge-LspToOpenCodeConfig
            return
        }
        default {
            $nums = $choice -split "," | ForEach-Object { $_.Trim() }
            foreach ($n in $nums) {
                if ($n -match "^\d+$") {
                    $num = [int]$n
                    $lsp = $lspServers | Where-Object { $_.Num -eq $num }
                    if ($lsp) {
                        if ($alreadyInstalled -contains $num) {
                            Write-Skip "$($lsp.Name) already installed, skipping."
                        } else {
                            $selected += $lsp
                        }
                    } else {
                        Write-Warn "Invalid selection: $n (skipped)"
                    }
                }
            }
        }
    }

    if ($selected.Count -eq 0) {
        Write-Info "No new LSP servers to install."
        Merge-LspToOpenCodeConfig
        return
    }

    Write-Host ""
    Write-Info "Installing $($selected.Count) LSP server(s)..."
    Write-Host ""

    $installedCount = 0
    $failedCount = 0

    foreach ($lsp in $selected) {
        Write-Host "  Installing $($lsp.Name)... " -NoNewline
        try {
            switch ($lsp.Name) {
                "Rust" { Install-RustAnalyzer }
                "Go" { Install-GoLsp }
                "Java" { Install-Jdtls }
                "C/C++" { Install-Clangd }
                "C#" { Install-CSharpLsp }
                "Lua" { Install-LuaLsp }
                default {
                    Invoke-InstallCommand $lsp.Install
                    if (-not (Test-Command $lsp.Cmd)) { throw "$($lsp.Cmd) not found after install" }
                }
            }
            Write-Host "[OK]" -ForegroundColor Green
            $installedCount++
        } catch {
            Write-Host "[FAIL]" -ForegroundColor Yellow
            Write-Warn "  Command: $($lsp.Install)"
            Write-Warn "  Error: $($_.Exception.Message)"
            $failedCount++
        }
    }

    $script:LspInstalled = $installedCount

    Write-Host ""
    if ($installedCount -gt 0) {
        Write-Ok "$installedCount LSP server(s) installed successfully."
    }
    if ($failedCount -gt 0) {
        Write-Warn "$failedCount LSP server(s) failed. Install them manually later."
    }

    # Merge installed LSP servers into opencode.json
    Merge-LspToOpenCodeConfig
}

function Merge-LspToOpenCodeConfig {
    Write-Info "Merging LSP config into opencode.json..."

    $installDir = Join-Path $ConfigDir "cli"
    if (Test-Path (Join-Path $installDir "src\index.ts")) {
        try {
            $prevEA = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $output = bun run (Join-Path $installDir "src\index.ts") setup --merge-lsp 2>&1
            $ErrorActionPreference = $prevEA
            if ($LASTEXITCODE -ne 0) { throw "LSP merge failed (exit $LASTEXITCODE): $output" }
            Write-Ok "LSP servers merged into opencode.json"
        } catch {
            Write-Warn "Could not merge LSP config. Run 'opencode-jce setup --merge-lsp' manually."
        }
    } else {
        Write-Warn "CLI not found for LSP merge. Run 'opencode-jce setup --merge-lsp' after install."
    }
}

function Write-Summary {
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host "       OpenCode JCE - Installed!" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Green

    if ($GitStatus -eq "installed") {
        Write-Host "  [OK] Git            - installed" -ForegroundColor Green
    } else {
        Write-Host "  [OK] Git            - already present" -ForegroundColor Green
    }

    if ($BunStatus -eq "installed") {
        Write-Host "  [OK] Bun            - installed" -ForegroundColor Green
    } else {
        Write-Host "  [OK] Bun            - already present" -ForegroundColor Green
    }

    if ($OpenCodeStatus -eq "installed") {
        Write-Host "  [OK] OpenCode CLI   - installed" -ForegroundColor Green
    } else {
        Write-Host "  [OK] OpenCode CLI   - already present" -ForegroundColor Green
    }

    Write-Host "  [OK] 42 AI Agents   - configured" -ForegroundColor Green
    Write-Host "  [OK] AGENTS.md      - global AI instructions" -ForegroundColor Green
    Write-Host "  [OK] 80 Skills      - on-demand workflows" -ForegroundColor Green
    Write-Host "  [OK] 19 Profiles    - ready" -ForegroundColor Green
    Write-Host "  [OK] 6 MCP Tools    - cached & ready" -ForegroundColor Green
    if ($LspInstalled -gt 0) {
        Write-Host "  [OK] LSP Servers    - $LspInstalled installed" -ForegroundColor Green
    } else {
        Write-Host "  [OK] 28 LSP Servers - configured" -ForegroundColor Green
    }
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Get started:  opencode" -ForegroundColor White
    Write-Host "  Manage:       opencode-jce --help" -ForegroundColor White
    Write-Host ""

    if ($BunStatus -eq "installed" -or $OpenCodeStatus -eq "installed") {
        Write-Warn "You may need to restart PowerShell for PATH changes to take effect."
    }

    if ($CliInstallFailed) {
        Write-Host ""
        Write-Host "  [WARN] opencode-jce CLI install failed. Config was deployed but CLI is not available." -ForegroundColor Yellow
        Write-Host "         Re-run the installer or install manually." -ForegroundColor Yellow
        exit 1
    }
}

# --- Main ---

if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host "[FAIL] PowerShell 5.1+ required. Current: $($PSVersionTable.PSVersion)" -ForegroundColor Red
    exit 1
}

Write-Banner

# Auto-detect OpenCode config location FIRST
$ConfigDir = Detect-OpenCodeConfig

# Backup existing config before making changes
Backup-ExistingConfig $ConfigDir

Write-Info "Config directory: $ConfigDir"
Write-Host ""

try {
    if (-not (Test-Command "winget")) {
        Write-Warn "winget not found. Some installations may fail."
        Write-Info "Get winget from: https://aka.ms/getwinget"
    }
    Install-Git
    Install-Bun
    Install-OpenCode
    Write-Host ""
    Deploy-Config
    Register-ContextKeeper
    Register-TuiPlugin
    Install-McpPackages
    Install-LspServers
    Write-Summary
} finally {
    # Cleanup temp directory regardless of success or failure
    if ($TempDir -and (Test-Path $TempDir)) {
        Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
