---
name: tauri
description: Tauri 2, desktop/mobile apps, Rust backend, web frontend, IPC. Use when working on tauri tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Tauri
# Loaded on-demand when working with Tauri desktop/mobile applications

## Auto-Detect

Trigger this skill when:
- Config files: `tauri.conf.json`, `Cargo.toml` with `tauri`, `src-tauri/`
- `package.json` contains: `@tauri-apps/api`, `@tauri-apps/cli`, `@tauri-apps/plugin-*`
- Code patterns: `invoke()`, `#[tauri::command]`, `tauri::Builder`, `emit()`, `listen()`
- Directory patterns: `src-tauri/src/`, `src-tauri/capabilities/`, `src-tauri/plugins/`
- Task mentions: Tauri, desktop app, native app, IPC, system tray, auto-update

---

## Decision Tree: Tauri vs Electron vs Flutter Desktop

```
What kind of desktop/mobile app?
├── Web team, needs native features (fs, shell, notifications)?
│   ├── Bundle size matters (< 10MB)? → Tauri
│   ├── Need full Node.js runtime in app? → Electron
│   └── Existing web app to wrap? → Tauri (reuse frontend)
├── Performance-critical (video editing, CAD, games)?
│   ├── Heavy GPU usage? → Native (C++/Rust) or Flutter
│   ├── CPU-bound processing? → Tauri (Rust backend handles compute)
│   └── Real-time audio/video? → Native or Electron (mature ecosystem)
├── Cross-platform mobile + desktop from one codebase?
│   ├── Native look-and-feel required? → Flutter
│   ├── Web UI acceptable on mobile? → Tauri 2 (iOS + Android + Desktop)
│   └── Existing React/Vue/Svelte app? → Tauri 2
├── Security-sensitive (banking, healthcare, enterprise)?
│   ├── Need sandboxing + capability model? → Tauri (allowlist + CSP)
│   ├── Need code signing + secure updates? → Tauri (built-in updater)
│   └── Minimize attack surface? → Tauri (no Node.js, no Chromium bundled)
└── Plugin ecosystem matters?
    ├── Mature npm ecosystem needed? → Electron
    ├── Rust crate ecosystem sufficient? → Tauri
    └── Need both? → Tauri (Rust plugins + npm for frontend)
```

## Decision Tree: IPC Strategy

```
How should frontend communicate with Rust backend?
├── Simple request/response (fetch data, run computation)?
│   └── Commands: invoke('command_name', { args }) → Result
├── Backend needs to notify frontend (progress, events)?
│   └── Events: emit/listen pattern (one-to-many)
├── Streaming data (logs, real-time updates)?
│   └── Event channels with backpressure
├── Large binary data (images, files)?
│   └── Commands with Vec<u8> + response streaming
├── Bidirectional real-time (chat, collaboration)?
│   └── Event system + commands combined
└── State shared across windows?
    └── Tauri managed state (Arc<Mutex<T>>) + events for sync
```

---

## Tauri 2 Project Structure

```
my-app/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json          # App config, windows, security
│   ├── capabilities/            # Permission definitions
│   │   ├── default.json         # Default capability set
│   │   └── admin.json           # Extended permissions
│   ├── icons/                   # App icons (all sizes)
│   ├── src/
│   │   ├── main.rs              # Entry point
│   │   ├── lib.rs               # Command definitions
│   │   ├── commands/            # Organized command modules
│   │   │   ├── mod.rs
│   │   │   ├── files.rs
│   │   │   └── settings.rs
│   │   ├── state.rs             # App state management
│   │   └── error.rs             # Error types
│   └── plugins/                 # Custom plugins
├── src/                         # Frontend (React/Vue/Svelte/Solid)
│   ├── App.tsx
│   └── lib/
│       └── tauri.ts             # Typed invoke wrappers
├── package.json
└── vite.config.ts
```

---

## Command System

### Defining Commands (Rust)

```rust
// src-tauri/src/lib.rs
use tauri::Manager;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

// Tauri requires errors to be serializable
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(self.to_string().as_str())
    }
}

// Simple command — sync
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! From Rust.", name)
}

// Async command with error handling
#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FileEntry>, AppError> {
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&path).await?;

    while let Some(entry) = dir.next_entry().await? {
        let metadata = entry.metadata().await?;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            size: metadata.len(),
            is_dir: metadata.is_dir(),
        });
    }

    Ok(entries)
}

// Command with app state access
#[tauri::command]
async fn get_settings(
    state: tauri::State<'_, AppState>,
) -> Result<Settings, AppError> {
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

// Command with window access (multi-window)
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), AppError> {
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("settings".into()),
    )
    .title("Settings")
    .inner_size(600.0, 400.0)
    .build()
    .map_err(|e| AppError::PermissionDenied(e.to_string()))?;

    Ok(())
}
```

### Registering Commands & State

```rust
// src-tauri/src/main.rs
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub settings: Arc<Mutex<Settings>>,
    pub db: Arc<Database>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::init())
        .manage(AppState {
            settings: Arc::new(Mutex::new(Settings::load().unwrap_or_default())),
            db: Arc::new(Database::connect().expect("DB connection failed")),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            list_directory,
            get_settings,
            open_settings_window,
        ])
        .setup(|app| {
            // Run setup logic (tray, global shortcuts, etc.)
            #[cfg(desktop)]
            setup_system_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Invoking Commands (Frontend)

```typescript
// src/lib/tauri.ts — typed wrappers for invoke
import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  language: string;
  autoUpdate: boolean;
}

// Type-safe invoke wrappers
export const commands = {
  greet: (name: string) =>
    invoke<string>('greet', { name }),

  listDirectory: (path: string) =>
    invoke<FileEntry[]>('list_directory', { path }),

  getSettings: () =>
    invoke<Settings>('get_settings'),

  openSettingsWindow: () =>
    invoke<void>('open_settings_window'),
} as const;

// Usage in React component
function FileExplorer({ path }: { path: string }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commands.listDirectory(path)
      .then(setFiles)
      .catch((err) => setError(String(err)));
  }, [path]);

  if (error) return <p className="text-red-500">{error}</p>;
  return (
    <ul>
      {files.map(file => (
        <li key={file.path}>{file.is_dir ? '📁' : '📄'} {file.name}</li>
      ))}
    </ul>
  );
}
```

---

## Event System

### Backend → Frontend Events

```rust
use tauri::Emitter;

// Emit to all windows
#[tauri::command]
async fn start_processing(app: tauri::AppHandle, file_path: String) -> Result<(), AppError> {
    let app_clone = app.clone();

    tokio::spawn(async move {
        for progress in 0..=100 {
            app_clone.emit("processing-progress", ProgressPayload {
                file: file_path.clone(),
                percent: progress,
            }).unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        app_clone.emit("processing-complete", &file_path).unwrap();
    });

    Ok(())
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    file: String,
    percent: u32,
}
```

### Frontend Event Listeners

```typescript
import { listen, once } from '@tauri-apps/api/event';

// Listen for progress updates
function ProcessingStatus() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const unlisten = listen<{ file: string; percent: number }>(
      'processing-progress',
      (event) => setProgress(event.payload.percent)
    );

    // Cleanup listener on unmount
    return () => { unlisten.then(fn => fn()); };
  }, []);

  return <progress value={progress} max={100} />;
}

// Listen once (auto-removes after first event)
const result = await once<string>('processing-complete');
console.log('Done:', result.payload);
```

---

## Security Model (Capabilities)

### Capability Configuration

```json
// src-tauri/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-set-title",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "dialog:allow-open",
    "dialog:allow-save",
    "notification:default",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPDATA/**" },
        { "path": "$DOCUMENT/**" }
      ],
      "deny": [
        { "path": "$APPDATA/secrets/**" }
      ]
    }
  ]
}
```

### CSP Configuration

```json
// tauri.conf.json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: https://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'",
      "dangerousDisableAssetCspModification": false
    },
    "windows": [
      {
        "title": "My App",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

---

## Plugin System

### Using Official Plugins

```rust
// Cargo.toml
[dependencies]
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
tauri-plugin-notification = "2"
tauri-plugin-updater = "2"
tauri-plugin-http = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-store = "2"        # Persistent key-value store
tauri-plugin-sql = "2"          # SQLite/MySQL/PostgreSQL
tauri-plugin-log = "2"          # Structured logging
```

```typescript
// Frontend usage of plugins
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { Store } from '@tauri-apps/plugin-store';

// File dialog
async function openFile() {
  const path = await open({
    multiple: false,
    filters: [{ name: 'Documents', extensions: ['md', 'txt', 'json'] }],
  });
  if (path) {
    const content = await readTextFile(path);
    return content;
  }
}

// Persistent store (like localStorage but for desktop)
const store = await Store.load('settings.json');
await store.set('theme', 'dark');
const theme = await store.get<string>('theme');
await store.save(); // Persist to disk
```

### Custom Plugin (Rust)

```rust
// src-tauri/plugins/my-plugin/src/lib.rs
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[tauri::command]
async fn my_plugin_command(input: String) -> Result<String, String> {
    Ok(format!("Plugin processed: {}", input))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("my-plugin")
        .invoke_handler(tauri::generate_handler![my_plugin_command])
        .setup(|app, _api| {
            // Plugin initialization logic
            println!("My plugin initialized");
            Ok(())
        })
        .build()
}

// Register in main.rs:
// .plugin(my_plugin::init())
```

---

## Build & Distribution

### Auto-Updater

```rust
// Check for updates on startup
use tauri_plugin_updater::UpdaterExt;

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match handle.updater().check().await {
            Ok(Some(update)) => {
                // Notify user, download, and install
                update.download_and_install(|progress, total| {
                    // Emit progress to frontend
                }, || {
                    // Download finished
                }).await.unwrap();
            }
            Ok(None) => {} // No update available
            Err(e) => eprintln!("Update check failed: {}", e),
        }
    });
    Ok(())
}
```

```json
// tauri.conf.json — updater config
{
  "plugins": {
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY_HERE",
      "endpoints": ["https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### Build Commands

```bash
# Development
cargo tauri dev                    # Hot-reload frontend + Rust rebuild
cargo tauri dev --release          # Dev with release optimizations

# Production builds
cargo tauri build                  # Build for current platform
cargo tauri build --target universal-apple-darwin  # macOS universal binary

# Mobile
cargo tauri android init           # Initialize Android project
cargo tauri android dev            # Dev on Android emulator/device
cargo tauri android build          # Production APK/AAB
cargo tauri ios init               # Initialize iOS project
cargo tauri ios dev                # Dev on iOS simulator
cargo tauri ios build              # Production IPA

# Code signing (macOS)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name"
cargo tauri build

# Code signing (Windows)
export TAURI_SIGNING_PRIVATE_KEY="path/to/key"
cargo tauri build
```

---

## Performance Patterns

### Async Commands (Never Block Main Thread)

```rust
// ❌ Blocks the main thread — UI freezes
#[tauri::command]
fn heavy_sync_work(data: Vec<u8>) -> Vec<u8> {
    expensive_computation(&data) // BAD: blocks webview thread
}

// ✅ Async — runs on tokio thread pool
#[tauri::command]
async fn heavy_async_work(data: Vec<u8>) -> Result<Vec<u8>, AppError> {
    // Spawn CPU-bound work on blocking thread pool
    let result = tokio::task::spawn_blocking(move || {
        expensive_computation(&data)
    }).await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(result)
}
```

### Sidecar for Heavy Processing

```json
// tauri.conf.json — bundle external binary
{
  "bundle": {
    "externalBin": ["binaries/ffmpeg"]
  }
}
```

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn convert_video(
    app: tauri::AppHandle,
    input: String,
    output: String,
) -> Result<(), AppError> {
    let sidecar = app.shell()
        .sidecar("ffmpeg")
        .map_err(|e| AppError::Internal(e.to_string()))?
        .args(["-i", &input, "-c:v", "libx264", &output]);

    let (mut rx, _child) = sidecar.spawn()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                app.emit("ffmpeg-progress", &String::from_utf8_lossy(&line)).unwrap();
            }
            tauri_plugin_shell::process::CommandEvent::Error(err) => {
                return Err(AppError::Internal(err));
            }
            _ => {}
        }
    }

    Ok(())
}
```

### Background Tasks with State

```rust
use std::sync::Arc;
use tokio::sync::{Mutex, watch};

pub struct BackgroundTask {
    cancel_tx: watch::Sender<bool>,
    progress: Arc<Mutex<f32>>,
}

#[tauri::command]
async fn start_background_task(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<Option<BackgroundTask>>>>,
) -> Result<(), AppError> {
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let progress = Arc::new(Mutex::new(0.0f32));

    let task = BackgroundTask { cancel_tx, progress: progress.clone() };
    *state.lock().await = Some(task);

    let app_clone = app.clone();
    tokio::spawn(async move {
        for i in 0..100 {
            if *cancel_rx.borrow() { break; }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            *progress.lock().await = i as f32 / 100.0;
            app_clone.emit("task-progress", i).unwrap();
        }
        app_clone.emit("task-complete", ()).unwrap();
    });

    Ok(())
}

#[tauri::command]
async fn cancel_background_task(
    state: tauri::State<'_, Arc<Mutex<Option<BackgroundTask>>>>,
) -> Result<(), AppError> {
    if let Some(task) = state.lock().await.as_ref() {
        task.cancel_tx.send(true).map_err(|_| AppError::Internal("Cancel failed".into()))?;
    }
    Ok(())
}
```

---

## Mobile Targets (Tauri 2)

```rust
// Platform-specific code
#[tauri::command]
async fn get_platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        #[cfg(target_os = "android")]
        platform_specific: "Android-specific value".to_string(),
        #[cfg(target_os = "ios")]
        platform_specific: "iOS-specific value".to_string(),
        #[cfg(desktop)]
        platform_specific: "Desktop-specific value".to_string(),
    }
}
```

```typescript
// Frontend: detect platform for UI adaptation
import { platform } from '@tauri-apps/plugin-os';

const currentPlatform = await platform(); // 'linux' | 'macos' | 'windows' | 'android' | 'ios'

function App() {
  return (
    <div className={currentPlatform === 'macos' ? 'pt-8' : ''}>
      {/* Extra padding for macOS traffic lights */}
      <MainContent />
    </div>
  );
}
```

---

## Testing

### Unit Tests (Rust Commands)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_directory() {
        let temp_dir = tempfile::tempdir().unwrap();
        std::fs::write(temp_dir.path().join("test.txt"), "hello").unwrap();

        let result = list_directory(temp_dir.path().to_string_lossy().to_string()).await;
        assert!(result.is_ok());

        let entries = result.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "test.txt");
        assert!(!entries[0].is_dir);
    }

    #[test]
    fn test_greet() {
        assert_eq!(greet("World"), "Hello, World! From Rust.");
    }
}
```

### E2E Tests (WebDriver)

```typescript
// tests/e2e/app.test.ts
import { expect, test } from '@playwright/test';

test('app launches and displays main window', async ({ page }) => {
  // Tauri E2E uses WebDriver protocol
  await page.goto('tauri://localhost');
  await expect(page.locator('h1')).toHaveText('Welcome');
});

test('file open dialog works', async ({ page }) => {
  await page.goto('tauri://localhost');
  await page.click('[data-testid="open-file"]');
  // Mock the dialog response in test setup
  await expect(page.locator('[data-testid="file-content"]')).toBeVisible();
});
```

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Sync commands for I/O or computation | Always use `async` commands with tokio |
| `allow-all` in capabilities | Minimal permissions per window/context |
| Pass huge payloads over IPC (> 1MB) | Stream data, use temp files, or chunked transfer |
| Store secrets in `tauri.conf.json` | Use OS keychain via `tauri-plugin-stronghold` |
| Block main thread with `std::thread::sleep` | Use `tokio::time::sleep` in async context |
| Wildcard CSP (`unsafe-inline`, `unsafe-eval`) | Strict CSP with nonces or hashes |
| Single monolithic command file | Organize into modules (`commands/files.rs`, etc.) |
| Ignore platform differences in UI | Use `platform()` to adapt layout (traffic lights, etc.) |
| Ship debug builds to users | Always `cargo tauri build` (release profile) |
| Use `unwrap()` in commands | Return `Result<T, AppError>` with proper error types |
| Forget to `.free()` event listeners | Always unlisten in cleanup/unmount |
| Hardcode paths (`/home/user/...`) | Use Tauri path APIs (`$APPDATA`, `$DOCUMENT`, etc.) |

---

## Verification Checklist

Before considering Tauri work done:
- [ ] All commands are `async` (no blocking the main thread)
- [ ] Error types implement `Serialize` and use `thiserror`
- [ ] Capabilities follow least-privilege (no `allow-all`)
- [ ] CSP configured and tested (no `unsafe-eval`)
- [ ] IPC payloads are reasonably sized (< 1MB per call)
- [ ] Event listeners cleaned up on component unmount
- [ ] Platform-specific code uses `#[cfg(target_os)]` or `#[cfg(desktop)]`
- [ ] Auto-updater configured with valid public key
- [ ] App icons generated for all required sizes
- [ ] Rust unit tests pass for all commands
- [ ] Frontend typed wrappers match Rust command signatures
- [ ] Build succeeds for target platforms
- [ ] No `unwrap()` in production command handlers
- [ ] Sidecar binaries bundled correctly (if used)

---

## MCP Integration

| Tool | Use For |
|------|---------|
| `context7` | Look up Tauri 2 API, plugin docs, capability schemas |
| `bash` | Run `cargo tauri dev`, `cargo tauri build`, `cargo test` |
| `sequential-thinking` | Design IPC architecture and state management |
| `grep/glob` | Find existing commands, event patterns, capability configs |
| `playwright` | E2E testing of Tauri webview UI |
