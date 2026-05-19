---
name: game-development
description: ECS, game loops, physics, rendering, multiplayer networking. Use when working on game-development tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Game Development

## Auto-Detect

Trigger this skill when:
- Task mentions: game, ECS, entity component system, game loop, physics, rendering, multiplayer
- Files: `*.gdscript`, `*.unity`, `*.tres`, `*.tscn`, game engine configs
- Patterns: sprite, collision, input handling, state machine, netcode
- Dependencies: `phaser`, `pixi.js`, `three`, `cannon-es`, `rapier`, `bitecs`

---

## Decision Tree: Architecture

```
What type of game?
├── 2D browser game?
│   ├── Simple (puzzle, platformer) → Phaser 3 or vanilla Canvas
│   ├── Many entities (bullet hell, RTS) → bitECS + Pixi.js renderer
│   └── Pixel art with physics → Phaser + Matter.js
├── 3D browser game?
│   ├── Simple scene / visualization → Three.js
│   ├── Physics-heavy → Three.js + Rapier (WASM)
│   └── Full engine features → Babylon.js or PlayCanvas
├── Native game?
│   ├── 2D indie → Godot 4 (GDScript) or Unity (C#)
│   ├── 3D with Rust → Bevy (ECS-native)
│   └── 3D AAA → Unreal (C++) or Unity (C#)
└── Multiplayer?
    ├── Turn-based → WebSocket + state sync (simple)
    ├── Real-time < 16 players → Client prediction + server authority
    ├── Real-time competitive → Rollback netcode (GGPO-style)
    └── MMO 100+ players → Dedicated server + spatial partitioning + interest management
```

## Decision Tree: Physics

```
├── Simple AABB / circle collision? → Custom (fastest, no dependency)
├── 2D platformer physics? → Custom with swept collision
├── 2D complex shapes + joints? → Matter.js or Planck.js
├── 3D rigid bodies? → Rapier (WASM, deterministic) or Cannon-es
├── Need deterministic physics (netcode)? → Rapier (fixed-point option)
└── Soft body / cloth / fluid? → Custom compute shaders or specialized lib
```

---

## ECS Architecture (bitECS)

```typescript
import { createWorld, defineComponent, defineQuery, addEntity, addComponent, Types } from 'bitecs';

// Components: pure data, no behavior
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const Health = defineComponent({ current: Types.ui16, max: Types.ui16 });
const Sprite = defineComponent({ textureId: Types.ui8, frame: Types.ui8 });
const Enemy = defineComponent();  // Tag component
const Player = defineComponent(); // Tag component

// Queries: select entities by component composition
const movementQuery = defineQuery([Position, Velocity]);
const renderQuery = defineQuery([Position, Sprite]);
const enemyQuery = defineQuery([Position, Health, Enemy]);

// Systems: functions that operate on queried entities
function movementSystem(world: World, dt: number): void {
  const entities = movementQuery(world);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    Position.x[eid] += Velocity.x[eid] * dt;
    Position.y[eid] += Velocity.y[eid] * dt;
  }
}

function collisionSystem(world: World): void {
  const enemies = enemyQuery(world);
  const players = defineQuery([Position, Player])(world);
  for (const enemy of enemies) {
    for (const player of players) {
      const dx = Position.x[enemy] - Position.x[player];
      const dy = Position.y[enemy] - Position.y[player];
      if (dx * dx + dy * dy < 32 * 32) { // Squared distance (avoid sqrt)
        Health.current[player] -= 10;
      }
    }
  }
}

// Entity factory
function spawnEnemy(world: World, x: number, y: number): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, Health, eid);
  addComponent(world, Enemy, eid);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Health.current[eid] = 100;
  Health.max[eid] = 100;
  return eid;
}
```

---

## Game Loop (Fixed Timestep)

```typescript
class GameLoop {
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 60; // 60 Hz physics
  private lastTime = 0;
  private running = false;

  constructor(
    private readonly update: (dt: number) => void,   // Fixed step (physics, logic)
    private readonly render: (alpha: number) => void  // Variable step (rendering)
  ) {}

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  private loop(currentTime: number): void {
    if (!this.running) return;

    const frameTime = Math.min((currentTime - this.lastTime) / 1000, 0.25); // Cap spiral of death
    this.lastTime = currentTime;
    this.accumulator += frameTime;

    // Fixed update: may run 0-N times per frame
    while (this.accumulator >= this.FIXED_DT) {
      this.update(this.FIXED_DT);
      this.accumulator -= this.FIXED_DT;
    }

    // Render with interpolation alpha for smooth visuals
    const alpha = this.accumulator / this.FIXED_DT;
    this.render(alpha);

    requestAnimationFrame(this.loop.bind(this));
  }
}

// Usage: separate concerns cleanly
const loop = new GameLoop(
  (dt) => {
    inputSystem(world);
    movementSystem(world, dt);
    collisionSystem(world);
    aiSystem(world, dt);
  },
  (alpha) => {
    renderSystem(world, alpha); // Interpolate positions
    uiSystem(world);
  }
);
```

---

## Multiplayer Netcode (Rollback)

```typescript
// Client-side prediction + server reconciliation
class NetworkedGameState {
  private inputHistory: InputFrame[] = [];
  private stateHistory: GameState[] = [];
  private confirmedFrame = 0;
  private localFrame = 0;

  // Client: predict locally, send input to server
  processLocalInput(input: InputData): void {
    const frame: InputFrame = {
      frame: this.localFrame++,
      input,
      timestamp: performance.now(),
    };

    // Save for potential rollback
    this.inputHistory.push(frame);
    this.stateHistory.push(this.cloneState());

    // Apply prediction
    this.applyInput(frame);
    this.simulateFrame();

    // Send to server
    this.socket.send({ type: 'input', frame });
  }

  // Server confirms: rollback if prediction was wrong
  onServerState(serverState: GameState, confirmedFrame: number): void {
    // Discard old history
    this.inputHistory = this.inputHistory.filter(f => f.frame > confirmedFrame);
    this.stateHistory = this.stateHistory.filter((_, i) => i > confirmedFrame - this.confirmedFrame);
    this.confirmedFrame = confirmedFrame;

    // Check if prediction matches
    if (!this.statesMatch(this.stateHistory[0], serverState)) {
      // ROLLBACK: restore server state, re-apply unconfirmed inputs
      this.restoreState(serverState);
      for (const input of this.inputHistory) {
        this.applyInput(input);
        this.simulateFrame();
      }
    }
  }
}

// Server: authoritative tick loop
class GameServer {
  private readonly TICK_RATE = 20; // 20 Hz server tick
  private inputQueues = new Map<string, InputFrame[]>();

  tick(): void {
    // Process all buffered inputs deterministically
    for (const [playerId, queue] of this.inputQueues) {
      const input = queue.shift();
      if (input) this.applyPlayerInput(playerId, input);
    }

    this.simulatePhysics();

    // Broadcast authoritative state
    const snapshot = this.createSnapshot();
    this.broadcast({ type: 'state', state: snapshot, frame: this.currentFrame });
  }
}

// Entity interpolation for remote players
function interpolateRemote(buffer: StateSnapshot[], renderTime: number): Position {
  const targetTime = renderTime - 100; // 100ms interpolation delay
  const [before, after] = findBracketingSnapshots(buffer, targetTime);
  if (!before || !after) return buffer[buffer.length - 1].position;

  const t = (targetTime - before.timestamp) / (after.timestamp - before.timestamp);
  return {
    x: before.position.x + (after.position.x - before.position.x) * t,
    y: before.position.y + (after.position.y - before.position.y) * t,
  };
}
```

---

## Asset Pipeline

```typescript
// Progressive asset loading with priority queues
class AssetManager {
  private cache = new Map<string, any>();
  private loading = new Map<string, Promise<any>>();

  async loadManifest(manifest: AssetEntry[], onProgress?: (pct: number) => void): Promise<void> {
    // Sort by priority (critical assets first)
    const sorted = [...manifest].sort((a, b) => a.priority - b.priority);
    let loaded = 0;

    // Load critical assets first (blocking), then stream the rest
    const critical = sorted.filter(a => a.priority === 0);
    const deferred = sorted.filter(a => a.priority > 0);

    await Promise.all(critical.map(a => this.load(a)));
    loaded = critical.length;
    onProgress?.(loaded / sorted.length);

    // Stream deferred assets (non-blocking)
    for (const asset of deferred) {
      await this.load(asset);
      loaded++;
      onProgress?.(loaded / sorted.length);
    }
  }

  async load(asset: AssetEntry): Promise<any> {
    if (this.cache.has(asset.key)) return this.cache.get(asset.key);
    if (this.loading.has(asset.key)) return this.loading.get(asset.key);

    const promise = this.loadByType(asset);
    this.loading.set(asset.key, promise);
    const result = await promise;
    this.cache.set(asset.key, result);
    this.loading.delete(asset.key);
    return result;
  }

  // Object pooling for frequently spawned entities
  private pools = new Map<string, any[]>();

  acquire<T>(type: string, factory: () => T): T {
    const pool = this.pools.get(type);
    if (pool && pool.length > 0) return pool.pop() as T;
    return factory();
  }

  release(type: string, obj: any): void {
    const pool = this.pools.get(type) ?? [];
    pool.push(obj);
    this.pools.set(type, pool);
  }
}
```

---

## Performance Optimization

```
Key techniques:
├── Object pooling → Avoid GC spikes (bullets, particles, effects)
├── Spatial partitioning → Grid or quadtree for collision broadphase
├── Frustum culling → Don't render off-screen entities
├── LOD (Level of Detail) → Reduce geometry for distant objects
├── Batch rendering → Minimize draw calls (sprite batching, instancing)
├── Fixed-point math → Deterministic physics for netcode
├── SIMD / typed arrays → SoA layout in ECS for cache efficiency
└── Web Workers → Offload physics/AI to separate thread
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Variable timestep physics | Non-deterministic, tunneling bugs | Fixed timestep with interpolation |
| God object GameManager | Unmaintainable, hard to extend | ECS or component-based architecture |
| No object pooling | GC spikes cause frame drops | Pool bullets, particles, effects |
| Tight coupling to renderer | Cannot run headless (server, tests) | Separate logic from presentation |
| Sending full state every tick | Bandwidth explosion | Delta compression + interest management |
| No client prediction | Laggy feel for players | Predict locally, reconcile with server |
| Polling input every frame | Missed inputs, input lag | Event-driven input with buffering |
| Loading all assets upfront | Long initial load time | Priority-based streaming, lazy load |

---

## Verification Checklist

- [ ] Game loop uses fixed timestep for physics (deterministic)
- [ ] Frame time capped to prevent spiral of death (max 250ms)
- [ ] Object pools used for frequently spawned/destroyed entities
- [ ] Collision detection uses broadphase (spatial hash or quadtree)
- [ ] Input buffered and processed at fixed rate (not per-frame)
- [ ] Multiplayer: server is authoritative, client predicts
- [ ] Multiplayer: entity interpolation for remote players (100ms buffer)
- [ ] Assets loaded progressively with priority (critical first)
- [ ] No allocations in hot loop (update/render path)
- [ ] Profiled with browser DevTools / engine profiler — no frame drops
