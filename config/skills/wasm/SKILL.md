---
name: wasm
description: WebAssembly, WASI, Rust-to-WASM, wasm-bindgen, component model. Use when working on wasm tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: WebAssembly
# Loaded on-demand when working with WASM, WASI, or compiling to WebAssembly

## Auto-Detect

Trigger this skill when:
- File extensions: `.wasm`, `.wat`, `.witx`, `.wit`
- Config files: `Cargo.toml` with `wasm-bindgen`/`wasm-pack`, `wasm-opt`, `emscripten`
- `package.json` contains: `@aspect-build/rules_js`, `wasm-pack`, `assemblyscript`
- Code patterns: `WebAssembly.instantiate`, `wasm-bindgen`, `#[wasm_bindgen]`
- Task mentions: WASM, WebAssembly, WASI, wasm-pack, Emscripten, component model

---

## Decision Tree: When to Use WASM

```
Is the task compute-intensive?
├── No (DOM manipulation, fetch, string ops) → Stay in JavaScript
│   └── JS engines are highly optimized for these — WASM adds overhead
├── Yes — what kind of computation?
│   ├── Image/video/audio processing → WASM (SIMD, predictable perf)
│   ├── Cryptography / hashing → WASM (constant-time, no GC pauses)
│   ├── Physics simulation / game logic → WASM (tight loops, SIMD)
│   ├── Compression (zstd, brotli) → WASM (existing C/Rust libs)
│   ├── PDF generation / parsing → WASM (port existing native libs)
│   ├── ML inference (small models) → WASM + SIMD (or WebGPU)
│   └── Data transformation (large datasets) → WASM if > 10ms in JS
└── Do you need to reuse existing native code?
    ├── Rust library → wasm-pack + wasm-bindgen
    ├── C/C++ library → Emscripten
    ├── Go library → TinyGo (smaller output than standard Go)
    └── New code, perf-critical → Rust (best WASM tooling + size)
```

## Decision Tree: Browser vs Server WASM

```
Where does the WASM module run?
├── Browser
│   ├── Need DOM access? → wasm-bindgen + web-sys (Rust) or Emscripten
│   ├── Web Worker for heavy compute? → SharedArrayBuffer + Atomics
│   ├── Streaming compilation? → WebAssembly.instantiateStreaming
│   └── Size budget? → Target < 100KB gzipped for initial load
├── Server / Edge
│   ├── Cloudflare Workers → wasm32-unknown-unknown target
│   ├── Fermyon Spin → WASI Component Model
│   ├── Fastly Compute → WASI + wit-bindgen
│   ├── wasmtime / wasmer (standalone) → WASI Preview 2
│   └── Node.js → WebAssembly.instantiate (same as browser API)
└── Plugin system (extensibility)
    ├── Need sandboxing? → WASM Component Model (capability-based)
    ├── Extism framework → Multi-language plugin SDK
    └── Custom host? → wasmtime/wasmer embedding API
```

---

## Rust → WASM Pipeline

### Project Setup

```toml
# Cargo.toml
[package]
name = "my-wasm-lib"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
getrandom = { version = "0.2", features = ["js"] }  # RNG in WASM

[dependencies.web-sys]
version = "0.3"
features = ["console", "Window", "Document", "HtmlElement", "Performance"]

[profile.release]
opt-level = "z"       # Optimize for size
lto = true            # Link-time optimization
codegen-units = 1     # Single codegen unit for better optimization
strip = true          # Strip debug symbols
panic = "abort"       # No unwinding = smaller binary
```

### wasm-bindgen Patterns

```rust
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

// Export a function to JavaScript
#[wasm_bindgen]
pub fn fibonacci(n: u32) -> u64 {
    match n {
        0 => 0,
        1 => 1,
        _ => {
            let (mut a, mut b) = (0u64, 1u64);
            for _ in 2..=n {
                let temp = b;
                b = a + b;
                a = temp;
            }
            b
        }
    }
}

// Structured data exchange via serde
#[derive(Serialize, Deserialize)]
pub struct ImageResult {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[wasm_bindgen]
pub fn process_image(input: &[u8], width: u32, height: u32) -> Result<JsValue, JsError> {
    let result = ImageResult {
        width,
        height,
        data: apply_filter(input, width, height),
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

// Import JavaScript functions
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;
}

// Export a struct with methods
#[wasm_bindgen]
pub struct Parser {
    buffer: Vec<u8>,
    position: usize,
}

#[wasm_bindgen]
impl Parser {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { buffer: Vec::new(), position: 0 }
    }

    pub fn feed(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    pub fn parse(&mut self) -> Result<JsValue, JsError> {
        // Parse logic here
        Ok(JsValue::NULL)
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
        self.position = 0;
    }
}
```

### Build & Optimize

```bash
# Build with wasm-pack (recommended)
wasm-pack build --target web --release
wasm-pack build --target bundler --release  # for webpack/vite
wasm-pack build --target nodejs --release   # for Node.js

# Manual optimization pipeline
cargo build --target wasm32-unknown-unknown --release
wasm-opt -Oz -o output.wasm target/wasm32-unknown-unknown/release/my_lib.wasm
# -Oz = optimize aggressively for size
# -O3 = optimize aggressively for speed

# Size analysis
wasm-opt --print-sizes output.wasm
twiggy top output.wasm  # Find largest functions
```

---

## JavaScript Interop

### Loading WASM (Browser)

```typescript
// Modern: streaming compilation (fastest)
import init, { fibonacci, Parser } from './pkg/my_wasm_lib.js';

async function main() {
  // Initialize WASM module (downloads + compiles)
  await init();

  // Use exported functions directly
  const result = fibonacci(40);
  console.log(result); // 102334155

  // Use exported classes
  const parser = new Parser();
  parser.feed(new Uint8Array([1, 2, 3]));
  const parsed = parser.parse();
  parser.free(); // Manual memory management for WASM objects!
}

main();
```

### Shared Memory (High-Performance)

```typescript
// For large data: pass ArrayBuffer views, avoid copying
import init, { process_image_in_place } from './pkg/image_processor.js';

async function processFrame(imageData: ImageData) {
  const { memory } = await init();

  // Allocate in WASM memory
  const ptr = allocate(imageData.data.length);
  const wasmMemory = new Uint8Array(memory.buffer, ptr, imageData.data.length);

  // Copy data into WASM memory (one copy, not per-pixel)
  wasmMemory.set(imageData.data);

  // Process in-place (zero-copy on WASM side)
  process_image_in_place(ptr, imageData.width, imageData.height);

  // Read results back
  imageData.data.set(wasmMemory);
  deallocate(ptr, imageData.data.length);
}
```

### Web Worker Integration

```typescript
// worker.ts — offload WASM to background thread
import init, { heavyComputation } from './pkg/my_lib.js';

let initialized = false;

self.onmessage = async (event) => {
  if (!initialized) {
    await init();
    initialized = true;
  }

  const { taskId, data } = event.data;
  try {
    const result = heavyComputation(new Uint8Array(data));
    self.postMessage({ taskId, result }, [result.buffer]); // Transfer ownership
  } catch (error) {
    self.postMessage({ taskId, error: error.message });
  }
};

// main.ts — use the worker
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

function runInWorker(data: ArrayBuffer): Promise<ArrayBuffer> {
  const taskId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.data.taskId !== taskId) return;
      worker.removeEventListener('message', handler);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ taskId, data }, [data]); // Transfer ownership
  });
}
```

---

## WASI Preview 2 & Component Model

### WIT Interface Definition

```wit
// world.wit — define component interface
package my-org:image-processor@1.0.0;

interface types {
    record image {
        width: u32,
        height: u32,
        pixels: list<u8>,
    }

    enum filter {
        grayscale,
        blur,
        sharpen,
        sepia,
    }

    variant process-error {
        invalid-dimensions,
        unsupported-format(string),
    }
}

world image-processor {
    use types.{image, filter, process-error};

    export apply-filter: func(img: image, f: filter) -> result<image, process-error>;
    export resize: func(img: image, width: u32, height: u32) -> result<image, process-error>;
}
```

### Implementing a WASI Component (Rust)

```rust
// src/lib.rs
wit_bindgen::generate!({
    world: "image-processor",
    path: "wit",
});

struct MyProcessor;

impl Guest for MyProcessor {
    fn apply_filter(img: Image, f: Filter) -> Result<Image, ProcessError> {
        let mut pixels = img.pixels.clone();
        match f {
            Filter::Grayscale => {
                for chunk in pixels.chunks_exact_mut(4) {
                    let gray = (chunk[0] as u16 * 77
                        + chunk[1] as u16 * 150
                        + chunk[2] as u16 * 29) / 256;
                    chunk[0] = gray as u8;
                    chunk[1] = gray as u8;
                    chunk[2] = gray as u8;
                }
            }
            _ => todo!(),
        }
        Ok(Image { width: img.width, height: img.height, pixels })
    }

    fn resize(img: Image, width: u32, height: u32) -> Result<Image, ProcessError> {
        if width == 0 || height == 0 {
            return Err(ProcessError::InvalidDimensions);
        }
        // Bilinear interpolation resize
        Ok(bilinear_resize(&img, width, height))
    }
}

export!(MyProcessor);
```

### Running WASI Components

```bash
# Build for WASI
cargo build --target wasm32-wasip2 --release

# Run with wasmtime
wasmtime run --wasi preview2 target/wasm32-wasip2/release/my_component.wasm

# Compose components
wasm-tools compose app.wasm -d image-processor.wasm -o composed.wasm
```

---

## SIMD & Threads (Performance)

```rust
// Enable SIMD in Cargo.toml
// .cargo/config.toml
// [target.wasm32-unknown-unknown]
// rustflags = ["-C", "target-feature=+simd128"]

use std::arch::wasm32::*;

#[wasm_bindgen]
pub fn sum_f32_simd(data: &[f32]) -> f32 {
    let chunks = data.chunks_exact(4);
    let remainder = chunks.remainder();

    let mut acc = f32x4_splat(0.0);
    for chunk in chunks {
        let v = f32x4(chunk[0], chunk[1], chunk[2], chunk[3]);
        acc = f32x4_add(acc, v);
    }

    let mut total = f32x4_extract_lane::<0>(acc)
        + f32x4_extract_lane::<1>(acc)
        + f32x4_extract_lane::<2>(acc)
        + f32x4_extract_lane::<3>(acc);

    for &val in remainder {
        total += val;
    }
    total
}
```

### Threading with SharedArrayBuffer

```typescript
// Requires: Cross-Origin-Opener-Policy: same-origin
//           Cross-Origin-Embedder-Policy: require-corp

// Initialize WASM with shared memory
const memory = new WebAssembly.Memory({
  initial: 256,
  maximum: 4096,
  shared: true, // SharedArrayBuffer backing
});

// Spawn workers that share the same memory
const workers = Array.from({ length: navigator.hardwareConcurrency }, () => {
  const worker = new Worker('./compute-worker.js');
  worker.postMessage({ memory, wasmModule });
  return worker;
});
```

---

## Size Optimization

```bash
# Optimization pipeline (aggressive)
# 1. Compile with size optimizations (Cargo.toml profile.release)
# 2. Run wasm-opt
wasm-opt -Oz --strip-debug --strip-producers -o optimized.wasm input.wasm

# 3. Compress for transfer
brotli -9 optimized.wasm  # .wasm.br — best compression for WASM
gzip -9 optimized.wasm    # .wasm.gz — wider support

# Size budget guidelines:
# < 50KB gzipped  — excellent (instant load)
# < 150KB gzipped — good (acceptable for most apps)
# < 500KB gzipped — acceptable (lazy-load, show progress)
# > 500KB gzipped — too large (split module, lazy-load parts)
```

### Reducing Binary Size

```rust
// Avoid these in size-critical WASM:
// - std::fmt (formatting machinery is large) — use itoa/ryu for numbers
// - panic messages — use panic = "abort" + #[cfg(not(target_arch = "wasm32"))]
// - HashMap (pulls in random) — use BTreeMap or a simpler hash

// Use #[cfg] to exclude debug code
#[cfg(not(target_arch = "wasm32"))]
fn debug_log(msg: &str) {
    eprintln!("{}", msg);
}

#[cfg(target_arch = "wasm32")]
fn debug_log(_msg: &str) {} // no-op in WASM
```

---

## Testing WASM Modules

```rust
// Unit tests run natively (fast)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fibonacci() {
        assert_eq!(fibonacci(0), 0);
        assert_eq!(fibonacci(1), 1);
        assert_eq!(fibonacci(10), 55);
        assert_eq!(fibonacci(40), 102334155);
    }
}

// Integration tests in browser via wasm-bindgen-test
// tests/web.rs
use wasm_bindgen_test::*;
wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn test_dom_interaction() {
    let window = web_sys::window().unwrap();
    let document = window.document().unwrap();
    let element = document.create_element("div").unwrap();
    element.set_text_content(Some("Hello WASM"));
    assert_eq!(element.text_content().unwrap(), "Hello WASM");
}
```

```bash
# Run browser tests
wasm-pack test --headless --chrome
wasm-pack test --headless --firefox
wasm-pack test --node  # Node.js tests
```

---

## C/C++ → WASM (Emscripten)

```bash
# Compile C to WASM
emcc -O3 -s WASM=1 -s EXPORTED_FUNCTIONS='["_process","_malloc","_free"]' \
     -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
     -s ALLOW_MEMORY_GROWTH=1 \
     -o output.js input.c

# Use from JavaScript
const Module = await createModule();
const process = Module.cwrap('process', 'number', ['number', 'number']);
const ptr = Module._malloc(data.length);
Module.HEAPU8.set(data, ptr);
const result = process(ptr, data.length);
Module._free(ptr);
```

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Cross JS/WASM boundary per pixel/element | Batch operations, pass arrays |
| Copy large buffers on every call | Use shared memory views, process in-place |
| Use WASM for simple string manipulation | JS string ops are faster (engine-optimized) |
| Ship unoptimized .wasm (debug build) | Always `wasm-opt -Oz` + compression |
| Forget to `.free()` WASM objects in JS | Track ownership, free in finally/cleanup |
| Use `std::collections::HashMap` in tiny WASM | Use `BTreeMap` or arrays (avoids getrandom) |
| Synchronous WASM compilation for large modules | Use `instantiateStreaming` (async) |
| Ignore CORS headers for SharedArrayBuffer | Set COOP/COEP headers for threading |
| Panic with string messages in release WASM | Use `panic = "abort"`, strip panic strings |
| Load entire WASM module for one function | Split into smaller modules, lazy-load |

---

## Verification Checklist

Before considering WASM work done:
- [ ] Binary size within budget (< 150KB gzipped for eager load)
- [ ] `wasm-opt` applied with appropriate optimization level
- [ ] No unnecessary JS/WASM boundary crossings in hot paths
- [ ] Memory properly freed (no leaks from WASM objects in JS)
- [ ] Streaming compilation used (`instantiateStreaming`)
- [ ] Fallback for browsers without WASM support (if needed)
- [ ] SIMD feature-detected before use (not all browsers support)
- [ ] Unit tests pass natively + integration tests in browser
- [ ] Error handling crosses boundary cleanly (Result → JsError)
- [ ] COOP/COEP headers set if using SharedArrayBuffer/threads
- [ ] `twiggy` or size analysis run to identify bloat
- [ ] Loading state shown while WASM initializes

---

## MCP Integration

| Tool | Use For |
|------|---------|
| `context7` | Look up wasm-bindgen API, WASI interfaces, wit syntax |
| `bash` | Run `wasm-pack build`, `wasm-opt`, `twiggy`, size checks |
| `sequential-thinking` | Design JS/WASM boundary and memory layout |
| `grep/glob` | Find existing WASM usage patterns in codebase |
