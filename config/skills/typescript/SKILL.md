---
name: typescript
description: TypeScript, JavaScript, Node.js, Bun. Use when working on typescript tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: TypeScript Advanced
# Loaded on-demand when working with .ts, .js, .tsx, .jsx files

## Auto-Detect

Trigger this skill when:
- File extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`
- Config files: `tsconfig.json`, `tsconfig.*.json`
- `package.json` contains: `typescript`, `@types/*`
- Import syntax: `import type`, generic annotations, interface declarations

---

## Decision Tree: Type vs Interface

```
Defining a shape?
├── Object shape (props, API response, config)?
│   ├── Will it be extended/merged? → interface (declaration merging)
│   ├── Used with class implements? → interface
│   └── Simple object type? → Either works (be consistent in project)
├── Union type? → type (interfaces can't do unions)
├── Mapped/conditional type? → type (interfaces can't do this)
├── Function signature? → type (cleaner syntax)
├── Tuple? → type
└── Primitive alias? → type

Rule: Pick one convention per project. If unsure, use `type` — it's more versatile.
```

## Decision Tree: Error Handling

```
Function can fail?
├── Expected failure (validation, not found)? → Return Result<T, E> type
├── Unexpected failure (network, disk)? → Throw typed error, catch at boundary
├── Async operation? → Result type OR try/catch with typed errors
├── Multiple failure modes? → Discriminated union error type
└── Library boundary? → Wrap in try/catch, convert to your error types
```

## Decision Tree: Runtime

```
Which runtime?
├── Server-side web app / API?
│   ├── Need npm ecosystem compatibility? → Node.js 22+
│   ├── Want fastest startup + built-in tools? → Bun 1.3
│   └── Edge/serverless? → Bun or Node with edge adapters
├── CLI tool?
│   ├── Fast startup critical? → Bun (no compile step needed)
│   └── Wide distribution? → Node + tsx or compiled with esbuild
├── Library?
│   └── Target both Node + Bun → use standard APIs, test on both
└── Monorepo tooling?
    └── Bun workspaces (faster installs, native TS execution)
```

---

## TypeScript 5.7 Features

```typescript
// Const type parameters — preserve literal types through generics
function routes<const T extends readonly string[]>(paths: T): T {
  return paths;
}
const r = routes(["/home", "/about"]); // readonly ["/home", "/about"], not string[]

// satisfies — validate type without widening
const config = {
  port: 3000,
  host: "localhost",
  debug: true,
} satisfies Record<string, string | number | boolean>;
// config.port is `number` (not `string | number | boolean`)

// Using declarations (TS 5.2+ with Symbol.dispose)
async function processFile(path: string) {
  using file = await openFile(path); // auto-disposed at end of scope
  const content = await file.read();
  return parse(content);
} // file[Symbol.asyncDispose]() called automatically

// Decorator metadata (stage 3)
function validate(schema: ZodSchema) {
  return function <T extends { new (...args: any[]): {} }>(target: T, context: ClassDecoratorContext) {
    context.metadata.schema = schema;
    return target;
  };
}

// NoInfer utility type — prevent inference from specific positions
function createFSM<S extends string>(config: {
  initial: NoInfer<S>;
  states: S[];
}) { /* ... */ }

createFSM({ initial: "idle", states: ["idle", "loading", "done"] });
// Without NoInfer, `initial` would widen the inference
```

---

## Strict Mode Patterns

```typescript
// tsconfig.json — non-negotiable settings for 2026
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,        // TS 5.7: no enums/namespaces
    "isolatedDeclarations": true,       // TS 5.5: faster parallel builds
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2024"
  }
}
```

---

## Type Narrowing

```typescript
// Discriminated unions — the most powerful pattern
type ApiResponse<T> =
  | { status: "success"; data: T; timestamp: number }
  | { status: "error"; error: { code: string; message: string } }
  | { status: "loading" };

function handle<T>(response: ApiResponse<T>) {
  switch (response.status) {
    case "success": return response.data;
    case "error": throw new AppError(response.error.code);
    case "loading": return null;
  }
}

// Type predicates — custom narrowing
function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}
const results = items.map(transform).filter(isNonNull); // T[]

// Assertion functions
function assertDefined<T>(value: T | undefined, msg: string): asserts value is T {
  if (value === undefined) throw new Error(msg);
}
```

---

## Generics Patterns

```typescript
// Constrained generics with defaults
type Pagination<T, Meta = { total: number; page: number }> = {
  items: T[];
  meta: Meta;
};

// Generic factory with const type parameter
function createEnum<const T extends Record<string, string>>(values: T): T {
  return Object.freeze(values);
}
const Status = createEnum({ Active: "active", Inactive: "inactive" });
// typeof Status = { readonly Active: "active"; readonly Inactive: "inactive" }

// Builder pattern with generics
class QueryBuilder<T, Selected extends keyof T = keyof T> {
  select<K extends keyof T>(...fields: K[]): QueryBuilder<T, K> { return this as any; }
  where<K extends Selected>(field: K, value: T[K]): this { return this; }
  execute(): Promise<Pick<T, Selected>[]> { /* ... */ }
}

// Infer in conditional types
type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T;
type EventPayload<T> = T extends { payload: infer P } ? P : never;
```

---

## Bun 1.3 APIs

```typescript
// Bun.serve — high-performance HTTP server
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/users" && req.method === "GET") {
      const users = await db.query("SELECT * FROM users");
      return Response.json(users);
    }
    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) { ws.subscribe("chat"); },
    message(ws, msg) { ws.publish("chat", msg); },
  },
});

// Bun.file — zero-copy file I/O
const file = Bun.file("./data.json");
const data = await file.json(); // Typed, fast

// Bun.spawn — subprocess management
const proc = Bun.spawn(["esbuild", "--bundle", "src/index.ts"], {
  stdout: "pipe",
  stderr: "pipe",
});
const output = await new Response(proc.stdout).text();

// Bun test runner (built-in, Jest-compatible)
import { test, expect, describe, mock } from "bun:test";

describe("UserService", () => {
  test("creates user with hashed password", async () => {
    const service = new UserService(mockRepo);
    const user = await service.create({ email: "a@b.com", password: "secret" });
    expect(user.passwordHash).not.toBe("secret");
    expect(user.email).toBe("a@b.com");
  });
});

// Bun.build — bundler API
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "node",
  splitting: true,
  minify: true,
});
```

---

## Result Type & Error Handling

```typescript
// Result type — explicit error handling without exceptions
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Usage with discriminated union errors
type ParseError = "NOT_FOUND" | "INVALID_JSON" | "SCHEMA_MISMATCH";

async function parseConfig(path: string): Promise<Result<Config, ParseError>> {
  const content = await readFile(path).catch(() => null);
  if (!content) return Err("NOT_FOUND");
  try {
    const raw = JSON.parse(content);
    const parsed = ConfigSchema.safeParse(raw);
    return parsed.success ? Ok(parsed.data) : Err("SCHEMA_MISMATCH");
  } catch {
    return Err("INVALID_JSON");
  }
}
```

---

## Zod Validation

```typescript
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user", "moderator"]),
  createdAt: z.coerce.date(),
});

type User = z.infer<typeof UserSchema>;

// Environment validation (fail fast at startup)
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]),
  API_KEY: z.string().min(32),
});
export const env = EnvSchema.parse(process.env);
```

---

## Utility Types & Branded Types

```typescript
// Branded types — nominal typing in a structural type system
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

function createUserId(id: string): UserId { return id as UserId; }
// createUserId("abc") cannot be passed where OrderId is expected

// DeepPartial for nested config overrides
type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

// Template literal types
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type ApiRoute = `/${string}`;
type RouteHandler = `${Lowercase<HttpMethod>} ${ApiRoute}`;

// Exhaustive switch helper
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| `any` | `unknown` + type narrowing |
| `@ts-ignore` without comment | Fix the type or use `@ts-expect-error` with explanation |
| `as` type assertions | Type guards or discriminated unions |
| `enum` (runtime overhead) | `as const` objects or union types |
| `!` non-null assertion | Proper null checks or `assertDefined` |
| Barrel files at scale | Direct imports (better tree-shaking) |
| `Function` type | Specific signature: `(args: T) => R` |
| `Object` / `{}` type | `Record<string, unknown>` or specific shape |
| Mutable global state | Dependency injection or module-scoped |
| `eval()` or `new Function()` | Never. No exceptions. |
| `namespace` | ES modules |
| Default exports | Named exports (better refactoring, auto-import) |

---

## Verification Checklist

Before considering TypeScript work done:
- [ ] `strict: true` in tsconfig — no exceptions
- [ ] Zero `any` types (search: `grep -r ": any"`)
- [ ] All external data validated at boundaries (Zod or equivalent)
- [ ] Error cases handled explicitly (Result type or try/catch)
- [ ] No type assertions (`as`) without justification comment
- [ ] Generics used where code is duplicated across types
- [ ] Discriminated unions for state machines / API responses
- [ ] `noUncheckedIndexedAccess` enabled for array/object safety
- [ ] `tsc --noEmit` passes with zero errors
- [ ] `isolatedDeclarations` enabled for library code
