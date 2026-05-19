---
name: rust
description: Rust, Cargo, async Rust, ownership. Use when working on rust tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Rust
# Loaded on-demand when working with .rs files

## Auto-Detect

Trigger this skill when:
- File extensions: `.rs`, `Cargo.toml`, `Cargo.lock`
- Directories: `src/`, `tests/`, `benches/`
- Task mentions: Rust, Cargo, async, ownership, lifetimes, traits

---

## Decision Tree: Error Handling

```
What kind of crate?
+-- Library (consumed by others)?
|   +-- Define error types with thiserror
|   +-- Return Result<T, YourError> from public API
|   +-- Never panic in library code
|   +-- Use #[non_exhaustive] on error enums
+-- Application (binary)?
|   +-- Use anyhow::Result for propagation
|   +-- Convert library errors with .context("what failed")
|   +-- Panic only for programmer bugs (unreachable state)
+-- Mixed (lib + bin in same crate)?
    +-- Library part: thiserror
    +-- Binary part: anyhow
    +-- Convert at boundary: .map_err() or From impl
```

## Decision Tree: Async Runtime

```
Need async?
+-- Web server / many connections?
|   +-- tokio (ecosystem standard, most libraries support it)
+-- Embedded / no_std?
|   +-- embassy (async for embedded)
+-- Minimal binary size?
|   +-- smol (lightweight, fewer features)
+-- Don't need async?
    +-- Use blocking I/O with rayon for parallelism
    +-- Simpler code, easier debugging

Executor choice:
+-- Multi-threaded (default)? -> tokio::runtime::Builder::new_multi_thread()
+-- Single-threaded (simpler)? -> tokio::runtime::Builder::new_current_thread()
+-- Work-stealing needed? -> Multi-threaded (default behavior)
```

## Decision Tree: Data Ownership

```
Who owns this data?
+-- Single owner, transferred between scopes?
|   +-- Move semantics (default)
+-- Single owner, temporarily shared?
|   +-- Borrow: &T (read) or &mut T (write)
+-- Multiple owners needed?
|   +-- Same thread? -> Rc<T>
|   +-- Across threads? -> Arc<T>
+-- Interior mutability needed?
|   +-- Single thread? -> RefCell<T> or Cell<T>
|   +-- Across threads? -> Mutex<T> or RwLock<T>
+-- Optional ownership?
    +-- Might not exist? -> Option<T>
    +-- Might fail? -> Result<T, E>
```

---

## Rust 2024 Edition

```rust
// Cargo.toml
[package]
edition = "2024"  // New edition: stricter lints, new features

// Async traits (stabilized — no more async-trait crate!)
trait Repository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DbError>;
    async fn create(&self, user: NewUser) -> Result<User, DbError>;
    async fn delete(&self, id: Uuid) -> Result<(), DbError>;
}

struct PgRepository {
    pool: PgPool,
}

impl Repository for PgRepository {
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, DbError> {
        sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::from)
    }

    async fn create(&self, user: NewUser) -> Result<User, DbError> {
        sqlx::query_as!(User,
            "INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *",
            user.email, user.name
        )
        .fetch_one(&self.pool)
        .await
        .map_err(DbError::from)
    }

    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        sqlx::query!("DELETE FROM users WHERE id = $1", id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// impl Trait in more places (return position in traits)
trait Processor {
    fn process(&self, data: &[u8]) -> impl Iterator<Item = Record> + '_;
}

// Let chains (if-let chaining)
if let Some(user) = get_user(id)
    && user.is_active()
    && let Some(subscription) = user.subscription()
{
    grant_access(subscription);
}
```

---

## Error Handling — thiserror + anyhow

```rust
// Library errors with thiserror
use thiserror::Error;

#[derive(Error, Debug)]
#[non_exhaustive]  // Allow adding variants without breaking downstream
pub enum AppError {
    #[error("user not found: {id}")]
    UserNotFound { id: Uuid },

    #[error("validation failed: {0}")]
    Validation(String),

    #[error("unauthorized: {reason}")]
    Unauthorized { reason: String },

    #[error("database error")]
    Database(#[from] sqlx::Error),

    #[error("external service error: {service}")]
    ExternalService {
        service: String,
        #[source]
        source: reqwest::Error,
    },
}

// Application code with anyhow
use anyhow::{Context, Result, bail, ensure};

async fn process_order(order_id: Uuid) -> Result<()> {
    let order = db.find_order(order_id)
        .await
        .context("failed to fetch order from database")?;

    ensure!(order.status == Status::Pending, "order {order_id} is not pending");

    let payment = payment_client
        .charge(order.total)
        .await
        .context("payment processing failed")?;

    if !payment.success {
        bail!("payment declined for order {order_id}");
    }

    db.update_order_status(order_id, Status::Paid)
        .await
        .context("failed to update order status")?;

    Ok(())
}
```

---

## Builder Pattern & Type State

```rust
// Type-state builder — compile-time enforcement of required fields
use std::marker::PhantomData;

struct Yes;
struct No;

struct ServerBuilder<HasPort, HasHost> {
    port: Option<u16>,
    host: Option<String>,
    tls: bool,
    _port: PhantomData<HasPort>,
    _host: PhantomData<HasHost>,
}

impl ServerBuilder<No, No> {
    fn new() -> Self {
        Self { port: None, host: None, tls: false, _port: PhantomData, _host: PhantomData }
    }
}

impl<H> ServerBuilder<No, H> {
    fn port(self, port: u16) -> ServerBuilder<Yes, H> {
        ServerBuilder { port: Some(port), host: self.host, tls: self.tls, _port: PhantomData, _host: PhantomData }
    }
}

impl<P> ServerBuilder<P, No> {
    fn host(self, host: impl Into<String>) -> ServerBuilder<P, Yes> {
        ServerBuilder { port: self.port, host: Some(host.into()), tls: self.tls, _port: PhantomData, _host: PhantomData }
    }
}

impl ServerBuilder<Yes, Yes> {
    fn build(self) -> Server {
        Server { port: self.port.unwrap(), host: self.host.unwrap(), tls: self.tls }
    }
}

// Usage — won't compile without port AND host
let server = ServerBuilder::new()
    .port(8080)
    .host("localhost")
    .build(); // Only available when both are set
```

---

## Newtype Pattern & Zero-Cost Abstractions

```rust
// Newtype for type safety — zero runtime cost
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UserId(Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OrderId(Uuid);

impl UserId {
    pub fn new() -> Self { Self(Uuid::new_v4()) }
    pub fn as_uuid(&self) -> &Uuid { &self.0 }
}

// Can't accidentally pass OrderId where UserId is expected
fn get_user(id: UserId) -> Result<User, AppError> { /* ... */ }

// Deref for ergonomic access (use sparingly)
impl std::ops::Deref for UserId {
    type Target = Uuid;
    fn deref(&self) -> &Self::Target { &self.0 }
}
```

---

## Iterators & Functional Patterns

```rust
// Prefer iterators over index-based loops — zero-cost abstraction
let active_users: Vec<&User> = users.iter()
    .filter(|u| u.is_active())
    .collect();

// Chained transformations
let report: HashMap<Department, Vec<String>> = employees.iter()
    .filter(|e| e.years_of_service > 5)
    .map(|e| (e.department.clone(), e.name.clone()))
    .into_group_map(); // from itertools

// Fallible iteration — stop on first error
let results: Result<Vec<Output>, Error> = inputs.iter()
    .map(|input| process(input))
    .collect(); // Short-circuits on first Err

// Parallel iteration with rayon
use rayon::prelude::*;
let processed: Vec<Output> = inputs.par_iter()
    .map(|input| expensive_computation(input))
    .collect();
```

---

## Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Table-driven tests
    #[test]
    fn test_email_validation() {
        let cases = [
            ("user@example.com", true),
            ("invalid", false),
            ("", false),
            ("a@b.c", true),
        ];

        for (email, expected) in cases {
            assert_eq!(
                is_valid_email(email), expected,
                "email={email:?} should be valid={expected}"
            );
        }
    }

    // Async test with tokio
    #[tokio::test]
    async fn test_create_user() {
        let pool = setup_test_db().await;
        let repo = PgRepository::new(pool);

        let user = repo.create(NewUser {
            email: "test@example.com".into(),
            name: "Test User".into(),
        }).await.unwrap();

        assert_eq!(user.email, "test@example.com");
        assert!(user.id != Uuid::nil());
    }

    // Property-based testing with proptest
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn roundtrip_serialization(user in arb_user()) {
            let json = serde_json::to_string(&user).unwrap();
            let deserialized: User = serde_json::from_str(&json).unwrap();
            prop_assert_eq!(user, deserialized);
        }
    }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `unwrap()` in production | Panics at runtime | `?` operator, `.context()`, or match |
| `clone()` everywhere | Hidden performance cost | Borrow, use references, or Arc |
| `unsafe` without proof | UB, memory corruption | Minimize unsafe, document invariants |
| Stringly-typed APIs | No compile-time safety | Newtypes, enums |
| `Box<dyn Error>` in libraries | Callers can't match on error type | thiserror with specific variants |
| Naked `tokio::spawn` | Lost errors, no cancellation | JoinSet, or handle JoinHandle |
| `Mutex` in async code | Deadlocks, blocks executor | `tokio::sync::Mutex` or channels |
| Giant `match` arms | Hard to read | Extract to methods, use if-let chains |
| `pub` on everything | No encapsulation | `pub(crate)`, `pub(super)` |
| No `#[must_use]` on Results | Errors silently ignored | Add `#[must_use]` to Result-returning fns |

---

## Verification Checklist

Before considering Rust work done:
- [ ] `cargo clippy -- -D warnings` passes (no warnings)
- [ ] `cargo test` passes all tests
- [ ] `cargo fmt --check` shows no formatting issues
- [ ] No `unwrap()` or `expect()` in non-test code (use `?` or proper handling)
- [ ] Error types use `thiserror` (library) or `anyhow` (application)
- [ ] All public items have doc comments (`///`)
- [ ] `unsafe` blocks have `// SAFETY:` comments explaining invariants
- [ ] No `clone()` without justification (prefer borrowing)
- [ ] Async code uses structured concurrency (JoinSet/TaskGroup)
- [ ] `cargo audit` shows no known vulnerabilities
