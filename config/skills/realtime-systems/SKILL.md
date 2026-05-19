---
name: realtime-systems
description: WebSocket, SSE, CRDT, presence, pub/sub, real-time sync. Use when working on realtime-systems tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Real-Time Systems

## Auto-Detect

Trigger this skill when:
- Task mentions: WebSocket, SSE, real-time, CRDT, presence, pub/sub, live updates, sync
- Files: `ws/`, `socket/`, `realtime/`, `*.gateway.ts`
- Patterns: bidirectional communication, live collaboration, presence indicators
- `package.json` contains: `ws`, `socket.io`, `@supabase/realtime`, `yjs`, `automerge`, `liveblocks`

---

## Decision Tree: SSE vs WebSocket

```
What's your communication pattern?
├── Server pushes to client only (one-way)?
│   ├── Text/JSON events, moderate frequency? → SSE
│   │   ├── Pro: Auto-reconnect, HTTP/2 multiplexing, simple
│   │   ├── Pro: Works through corporate proxies, no special infra
│   │   └── Con: No binary, no client-to-server on same connection
│   └── Binary data or >100 msg/sec? → WebSocket
├── Bidirectional (client sends AND receives)?
│   ├── Need fallback for restrictive networks? → Socket.IO
│   ├── Low-latency gaming/collaboration? → Raw WebSocket
│   └── gRPC ecosystem? → gRPC bidirectional streaming
├── Collaborative editing (multi-user same document)?
│   ├── Text/rich text? → CRDT (Yjs) or OT (ShareDB)
│   ├── Structured data (JSON, trees)? → CRDT (Automerge)
│   └── Need server authority (conflict resolution)? → OT
└── Just need presence (who's online/typing)?
    └── Heartbeat + Redis pub/sub (lightweight)
```

## Decision Tree: Scaling WebSockets

```
How many concurrent connections?
├── < 10K connections?
│   └── Single server with Redis pub/sub for multi-instance
├── 10K - 100K connections?
│   └── Multiple servers + Redis/NATS for cross-instance messaging
│   └── Sticky sessions (connection affinity) at load balancer
├── 100K - 1M connections?
│   └── Dedicated WebSocket tier (separate from API servers)
│   └── NATS or Kafka for fan-out, connection sharding
└── > 1M connections?
    └── Purpose-built infra (Cloudflare Durable Objects, custom C++ servers)
    └── Geographic distribution, edge WebSocket termination
```

---

## WebSocket Server (Production-Ready)

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';

interface Client {
  ws: WebSocket;
  userId: string;
  rooms: Set<string>;
  isAlive: boolean;
}

class RealtimeServer {
  private clients = new Map<string, Client>();
  private pub: Redis;
  private sub: Redis;

  constructor(private wss: WebSocketServer) {
    this.pub = new Redis(process.env.REDIS_URL!);
    this.sub = new Redis(process.env.REDIS_URL!);
    this.setupCrossInstance();
    this.setupHeartbeat();
    this.wss.on('connection', this.handleConnection.bind(this));
  }

  private async handleConnection(ws: WebSocket, req: Request): Promise<void> {
    const token = new URL(req.url!, 'http://localhost').searchParams.get('token');
    const user = await this.authenticate(token);
    if (!user) { ws.close(4001, 'Unauthorized'); return; }

    const client: Client = { ws, userId: user.id, rooms: new Set(), isAlive: true };
    this.clients.set(user.id, client);

    ws.on('message', (data) => this.handleMessage(client, data));
    ws.on('pong', () => { client.isAlive = true; });
    ws.on('close', () => this.handleDisconnect(client));

    this.send(ws, { type: 'connected', userId: user.id });
  }

  private async handleMessage(client: Client, raw: Buffer): Promise<void> {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case 'subscribe':
        client.rooms.add(msg.room);
        await this.pub.sadd(`room:${msg.room}:members`, client.userId);
        break;
      case 'unsubscribe':
        client.rooms.delete(msg.room);
        await this.pub.srem(`room:${msg.room}:members`, client.userId);
        break;
      case 'publish':
        await this.pub.publish(`room:${msg.room}`, JSON.stringify({
          senderId: client.userId, payload: msg.payload, ts: Date.now(),
        }));
        break;
    }
  }

  // Cross-instance delivery via Redis pub/sub
  private setupCrossInstance(): void {
    this.sub.psubscribe('room:*');
    this.sub.on('pmessage', (_pattern, channel, data) => {
      const room = channel.replace('room:', '');
      const message = JSON.parse(data);
      for (const client of this.clients.values()) {
        if (client.rooms.has(room) && client.userId !== message.senderId) {
          this.send(client.ws, { type: 'message', room, ...message });
        }
      }
    });
  }

  // Detect dead connections
  private setupHeartbeat(): void {
    setInterval(() => {
      for (const [userId, client] of this.clients) {
        if (!client.isAlive) { client.ws.terminate(); this.clients.delete(userId); continue; }
        client.isAlive = false;
        client.ws.ping();
      }
    }, 30_000);
  }

  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
}
```

---

## Server-Sent Events (SSE)

```typescript
import { Router } from 'express';

const router = Router();

router.get('/events', authenticate, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

  // Keep-alive prevents proxy timeouts
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15_000);

  // Subscribe to user-specific events
  const unsubscribe = eventBus.subscribe(req.user.id, (event) => {
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  });

  req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
});

// Client: EventSource auto-reconnects with Last-Event-ID header
// const es = new EventSource('/events');
// es.addEventListener('order_update', (e) => handleUpdate(JSON.parse(e.data)));
```

---

## CRDT Implementation (Yjs)

```typescript
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

class CollaborativeDocument {
  private doc: Y.Doc;
  private provider: WebsocketProvider;
  private undoManager: Y.UndoManager;

  constructor(roomId: string, user: { name: string; color: string }) {
    this.doc = new Y.Doc();
    this.provider = new WebsocketProvider('wss://sync.example.com', roomId, this.doc);

    // Awareness protocol — presence, cursors, selections
    this.provider.awareness.setLocalStateField('user', user);

    // Per-user undo/redo
    this.undoManager = new Y.UndoManager(this.doc.getText('content'), {
      trackedOrigins: new Set(['local']),
      captureTimeout: 500,
    });
  }

  // Shared types — automatically synced across all peers
  getText(): Y.Text { return this.doc.getText('content'); }
  getMap(): Y.Map<unknown> { return this.doc.getMap('metadata'); }

  // Apply local edit
  insertText(index: number, text: string): void {
    this.doc.transact(() => {
      this.getText().insert(index, text);
    }, 'local');
  }

  // Get all connected users
  getPresence(): { userId: number; user: { name: string; color: string } }[] {
    const states = this.provider.awareness.getStates();
    return Array.from(states.entries())
      .filter(([, state]) => state.user)
      .map(([clientId, state]) => ({ userId: clientId, user: state.user }));
  }

  undo(): void { this.undoManager.undo(); }
  redo(): void { this.undoManager.redo(); }
}
```

---

## Presence System

```typescript
class PresenceService {
  private readonly TTL = 60;
  private readonly HEARTBEAT = 30;

  constructor(private redis: Redis) {}

  async join(userId: string, roomId: string, metadata: object): Promise<void> {
    const key = `presence:${roomId}:${userId}`;
    await this.redis.setex(key, this.TTL, JSON.stringify({ ...metadata, joinedAt: Date.now() }));
    await this.redis.sadd(`room:${roomId}:members`, userId);
    await this.redis.publish(`presence:${roomId}`, JSON.stringify({ type: 'join', userId, metadata }));
  }

  async heartbeat(userId: string, roomId: string): Promise<void> {
    await this.redis.expire(`presence:${roomId}:${userId}`, this.TTL);
  }

  async leave(userId: string, roomId: string): Promise<void> {
    await this.redis.del(`presence:${roomId}:${userId}`);
    await this.redis.srem(`room:${roomId}:members`, userId);
    await this.redis.publish(`presence:${roomId}`, JSON.stringify({ type: 'leave', userId }));
  }

  async getMembers(roomId: string): Promise<PresenceInfo[]> {
    const members = await this.redis.smembers(`room:${roomId}:members`);
    const pipeline = this.redis.pipeline();
    members.forEach((id) => pipeline.get(`presence:${roomId}:${id}`));
    const results = await pipeline.exec();
    return results
      .filter(([err, val]) => !err && val)
      .map(([, val]) => JSON.parse(val as string));
  }
}
```

---

## Pub/Sub with Backpressure

```typescript
class ChannelSubscription {
  private buffer: unknown[] = [];
  private readonly MAX_BUFFER = 1000;

  constructor(
    private ws: WebSocket,
    private channel: string,
    private dropPolicy: 'oldest' | 'newest' | 'none' = 'oldest'
  ) {}

  enqueue(message: unknown): void {
    if (this.ws.bufferedAmount > 64 * 1024) {
      // Client is slow — apply backpressure
      switch (this.dropPolicy) {
        case 'oldest':
          if (this.buffer.length >= this.MAX_BUFFER) this.buffer.shift();
          this.buffer.push(message);
          break;
        case 'newest':
          // Drop incoming message
          break;
        case 'none':
          this.buffer.push(message);
          break;
      }
      return;
    }

    // Drain buffer first, then send current
    while (this.buffer.length > 0 && this.ws.bufferedAmount < 32 * 1024) {
      this.ws.send(JSON.stringify(this.buffer.shift()));
    }
    this.ws.send(JSON.stringify(message));
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| WebSocket for simple notifications | Overkill, complex infra for one-way push | SSE for server-push (auto-reconnect, simpler) |
| No reconnection with state sync | Client misses events during disconnect | Sequence IDs + catch-up query on reconnect |
| Sending full state on every change | Bandwidth waste, slow on large documents | Send deltas/patches, use CRDTs for merging |
| No heartbeat/ping | Dead connections consume server resources | Ping/pong every 30s, terminate unresponsive |
| Single WebSocket server instance | Cannot scale horizontally | Redis/NATS pub/sub for cross-instance fan-out |
| Presence without TTL | Ghost users shown as online forever | TTL-based presence with heartbeat renewal |
| No backpressure handling | Slow clients overwhelmed, OOM | Buffer with drop policy or flow control |
| Auth only at connection time | Token expires, connection stays open | Periodic re-auth or short connection lifetime |

---

## Verification Checklist

- [ ] Transport chosen based on communication pattern (SSE vs WebSocket)
- [ ] Authentication validated on connection (not just first message)
- [ ] Heartbeat/ping configured (30s interval, terminate after 2 missed)
- [ ] Reconnection strategy with state reconciliation (sequence IDs)
- [ ] Horizontal scaling via Redis/NATS pub/sub (not single-server)
- [ ] Backpressure handling for slow clients (buffer + drop policy)
- [ ] Presence uses TTL with heartbeat (no ghost users)
- [ ] Message ordering guaranteed within a channel (sequence numbers)
- [ ] Load tested for target concurrent connections
- [ ] Graceful shutdown drains connections before termination
