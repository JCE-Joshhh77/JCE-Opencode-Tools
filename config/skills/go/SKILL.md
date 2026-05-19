---
name: go
description: Go modules, goroutines, interfaces. Use when working on go tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Go
# Loaded on-demand when working with .go files

## Auto-Detect

Trigger this skill when:
- File extensions: `.go`, `go.mod`, `go.sum`
- Directories: `cmd/`, `internal/`, `pkg/`
- Task mentions: Go, Golang, goroutines, channels, interfaces

---

## Decision Tree: Project Structure

```
What are you building?
+-- Single binary (CLI, server)?
|   +-- cmd/myapp/main.go + internal/ packages
+-- Multiple binaries?
|   +-- cmd/api/main.go, cmd/worker/main.go + shared internal/
+-- Library for others?
|   +-- Root package + subpackages, no cmd/
+-- Microservice?
|   +-- cmd/server/main.go + internal/{handler,service,repository}/
+-- Monorepo with multiple modules?
    +-- Go workspace (go.work) + separate go.mod per module
```

## Decision Tree: Concurrency Pattern

```
Need concurrency?
+-- Fan-out (parallel independent tasks)?
|   +-- errgroup.Group (structured, collects errors)
+-- Pipeline (stages of processing)?
|   +-- Channels connecting goroutines
+-- Worker pool (bounded parallelism)?
|   +-- Semaphore pattern or errgroup.SetLimit()
+-- Pub/sub within process?
|   +-- Channels with select
+-- Request-scoped cancellation?
|   +-- context.Context propagation
+-- Shared mutable state?
|   +-- sync.Mutex (simple) or channels (complex coordination)
+-- One-time initialization?
    +-- sync.Once
```

## Decision Tree: Error Handling

```
Function returned an error?
+-- Can you handle it here? -> Handle and don't propagate
+-- Need to add context? -> fmt.Errorf("doing X: %w", err)
+-- Need to check error type upstream? -> Use sentinel errors or custom types
+-- Multiple errors to collect? -> errors.Join() (Go 1.20+)
+-- Should caller retry? -> Return typed error with IsRetryable()
+-- Unrecoverable? -> log.Fatal() only in main(), never in libraries
```

---

## Go 1.23 — Range Over Func (Iterators)

```go
// Range over function — custom iterators (Go 1.23)
// Iterator types:
//   func(yield func() bool)           — no values
//   func(yield func(V) bool)          — single value
//   func(yield func(K, V) bool)       — key-value pair

// Custom iterator for filtered results
func FilterUsers(users []User, pred func(User) bool) iter.Seq[User] {
    return func(yield func(User) bool) {
        for _, u := range users {
            if pred(u) && !yield(u) {
                return
            }
        }
    }
}

// Usage — works with range
for user := range FilterUsers(users, func(u User) bool { return u.Active }) {
    fmt.Println(user.Name)
}

// Paginated database iterator
func AllOrders(db *sql.DB, batchSize int) iter.Seq2[Order, error] {
    return func(yield func(Order, error) bool) {
        var cursor int64
        for {
            rows, err := db.Query(
                "SELECT * FROM orders WHERE id > ? ORDER BY id LIMIT ?",
                cursor, batchSize,
            )
            if err != nil {
                yield(Order{}, err)
                return
            }
            var count int
            for rows.Next() {
                var order Order
                if err := rows.Scan(&order.ID, &order.Total, &order.Status); err != nil {
                    rows.Close()
                    yield(Order{}, err)
                    return
                }
                cursor = order.ID
                count++
                if !yield(order, nil) {
                    rows.Close()
                    return
                }
            }
            rows.Close()
            if count < batchSize {
                return // No more pages
            }
        }
    }
}

// Composing iterators
func Map[In, Out any](seq iter.Seq[In], fn func(In) Out) iter.Seq[Out] {
    return func(yield func(Out) bool) {
        for v := range seq {
            if !yield(fn(v)) {
                return
            }
        }
    }
}

func Take[V any](seq iter.Seq[V], n int) iter.Seq[V] {
    return func(yield func(V) bool) {
        i := 0
        for v := range seq {
            if i >= n || !yield(v) {
                return
            }
            i++
        }
    }
}
```

---

## Structured Logging (slog)

```go
// slog — structured logging in stdlib (Go 1.21+)
import "log/slog"

// Setup with JSON handler (production)
func setupLogger(env string) *slog.Logger {
    var handler slog.Handler
    switch env {
    case "production":
        handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
            Level:     slog.LevelInfo,
            AddSource: true,
        })
    default:
        handler = slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
            Level: slog.LevelDebug,
        })
    }
    logger := slog.New(handler)
    slog.SetDefault(logger)
    return logger
}

// Usage — structured key-value pairs
func (s *OrderService) CreateOrder(ctx context.Context, req CreateOrderReq) (*Order, error) {
    logger := slog.With("user_id", req.UserID, "request_id", middleware.RequestID(ctx))

    logger.Info("creating order", "items_count", len(req.Items))

    order, err := s.repo.Create(ctx, req)
    if err != nil {
        logger.Error("failed to create order",
            "error", err,
            "user_id", req.UserID,
        )
        return nil, fmt.Errorf("creating order: %w", err)
    }

    logger.Info("order created", "order_id", order.ID, "total", order.Total)
    return order, nil
}

// Context-aware logging (attach request metadata)
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        logger := slog.With(
            "method", r.Method,
            "path", r.URL.Path,
            "request_id", r.Header.Get("X-Request-ID"),
        )
        ctx = context.WithValue(ctx, loggerKey, logger)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Custom log attributes for domain types
func (o Order) LogValue() slog.Value {
    return slog.GroupValue(
        slog.String("id", o.ID),
        slog.String("status", string(o.Status)),
        slog.Float64("total", o.Total),
    )
}
```

---

## Generics Patterns

```go
// Generic result type
type Result[T any] struct {
    Value T
    Err   error
}

// Generic repository
type Repository[T any, ID comparable] interface {
    FindByID(ctx context.Context, id ID) (T, error)
    Create(ctx context.Context, entity T) (T, error)
    Update(ctx context.Context, entity T) error
    Delete(ctx context.Context, id ID) error
    List(ctx context.Context, opts ListOptions) ([]T, error)
}

// Generic slice utilities
func Filter[T any](items []T, pred func(T) bool) []T {
    result := make([]T, 0, len(items)/2) // Preallocate estimate
    for _, item := range items {
        if pred(item) {
            result = append(result, item)
        }
    }
    return result
}

func Map[In, Out any](items []In, fn func(In) Out) []Out {
    result := make([]Out, len(items))
    for i, item := range items {
        result[i] = fn(item)
    }
    return result
}

// Generic set
type Set[T comparable] map[T]struct{}

func NewSet[T comparable](items ...T) Set[T] {
    s := make(Set[T], len(items))
    for _, item := range items {
        s[item] = struct{}{}
    }
    return s
}

func (s Set[T]) Contains(item T) bool { _, ok := s[item]; return ok }
func (s Set[T]) Add(item T)           { s[item] = struct{}{} }

// Type constraints
type Number interface {
    ~int | ~int32 | ~int64 | ~float32 | ~float64
}

func Sum[T Number](items []T) T {
    var total T
    for _, item := range items {
        total += item
    }
    return total
}
```

---

## Error Wrapping & Sentinel Errors

```go
// Sentinel errors — for errors callers need to check
var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
    ErrUnauthorized  = errors.New("unauthorized")
)

// Custom error type with context
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Message)
}

// Wrapping with context — ALWAYS wrap errors with %w
func (r *UserRepo) FindByEmail(ctx context.Context, email string) (*User, error) {
    var user User
    err := r.db.QueryRowContext(ctx,
        "SELECT id, email, name FROM users WHERE email = $1", email,
    ).Scan(&user.ID, &user.Email, &user.Name)

    switch {
    case errors.Is(err, sql.ErrNoRows):
        return nil, fmt.Errorf("user with email %s: %w", email, ErrNotFound)
    case err != nil:
        return nil, fmt.Errorf("querying user by email: %w", err)
    }
    return &user, nil
}

// Checking errors upstream
user, err := repo.FindByEmail(ctx, email)
if err != nil {
    if errors.Is(err, ErrNotFound) {
        return nil, &HTTPError{Status: 404, Message: "user not found"}
    }
    return nil, err // Propagate unexpected errors
}

// errors.Join for multiple errors (Go 1.20+)
func validateOrder(o Order) error {
    var errs []error
    if o.Total <= 0 {
        errs = append(errs, &ValidationError{Field: "total", Message: "must be positive"})
    }
    if len(o.Items) == 0 {
        errs = append(errs, &ValidationError{Field: "items", Message: "cannot be empty"})
    }
    return errors.Join(errs...)
}
```

---

## Concurrency Patterns

```go
// errgroup — structured concurrency with error propagation
import "golang.org/x/sync/errgroup"

func fetchUserData(ctx context.Context, userID string) (*UserData, error) {
    g, ctx := errgroup.WithContext(ctx)

    var profile *Profile
    var orders []Order
    var prefs *Preferences

    g.Go(func() error {
        var err error
        profile, err = fetchProfile(ctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        orders, err = fetchOrders(ctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        prefs, err = fetchPreferences(ctx, userID)
        return err
    })

    if err := g.Wait(); err != nil {
        return nil, fmt.Errorf("fetching user data: %w", err)
    }
    return &UserData{Profile: profile, Orders: orders, Preferences: prefs}, nil
}

// Bounded concurrency with errgroup.SetLimit
func processItems(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(10) // Max 10 concurrent goroutines

    for _, item := range items {
        g.Go(func() error {
            return processItem(ctx, item)
        })
    }
    return g.Wait()
}

// Graceful shutdown
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    server := &http.Server{Addr: ":8080", Handler: router}

    go func() {
        if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            slog.Error("server error", "error", err)
        }
    }()

    <-ctx.Done()
    slog.Info("shutting down gracefully")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := server.Shutdown(shutdownCtx); err != nil {
        slog.Error("shutdown error", "error", err)
    }
}
```

---

## Functional Options Pattern

```go
type Server struct {
    port    int
    host    string
    tls     bool
    logger  *slog.Logger
    timeout time.Duration
}

type Option func(*Server)

func WithPort(port int) Option {
    return func(s *Server) { s.port = port }
}

func WithHost(host string) Option {
    return func(s *Server) { s.host = host }
}

func WithTLS() Option {
    return func(s *Server) { s.tls = true }
}

func WithLogger(logger *slog.Logger) Option {
    return func(s *Server) { s.logger = logger }
}

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func NewServer(opts ...Option) *Server {
    s := &Server{
        port:    8080,
        host:    "0.0.0.0",
        logger:  slog.Default(),
        timeout: 30 * time.Second,
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage
server := NewServer(
    WithPort(9090),
    WithTLS(),
    WithTimeout(60 * time.Second),
)
```

---

## Testing

```go
// Table-driven tests with subtests
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name  string
        email string
        want  bool
    }{
        {"valid email", "user@example.com", true},
        {"missing @", "invalid", false},
        {"empty string", "", false},
        {"minimal valid", "a@b.c", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := ValidateEmail(tt.email)
            if got != tt.want {
                t.Errorf("ValidateEmail(%q) = %v, want %v", tt.email, got, tt.want)
            }
        })
    }
}

// Test with testcontainers
func TestUserRepository(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test")
    }

    ctx := context.Background()
    container, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("test"),
    )
    t.Cleanup(func() { container.Terminate(ctx) })
    require.NoError(t, err)

    connStr, _ := container.ConnectionString(ctx)
    db, _ := sql.Open("pgx", connStr)
    repo := NewUserRepo(db)

    t.Run("create and find", func(t *testing.T) {
        user, err := repo.Create(ctx, NewUser{Email: "test@example.com", Name: "Test"})
        require.NoError(t, err)
        assert.NotEmpty(t, user.ID)

        found, err := repo.FindByID(ctx, user.ID)
        require.NoError(t, err)
        assert.Equal(t, "test@example.com", found.Email)
    })
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Naked goroutines | Lost errors, panics crash process | errgroup, recover in goroutine |
| `init()` functions | Hidden side effects, test ordering | Explicit initialization in main |
| Global mutable state | Race conditions, hard to test | Dependency injection via structs |
| Ignoring errors (`_ = fn()`) | Silent failures | Always handle or explicitly document why ignored |
| `panic` in libraries | Crashes caller's program | Return errors, let caller decide |
| `interface{}` / `any` everywhere | No type safety | Generics or specific interfaces |
| Large interfaces | Hard to implement, mock | Small interfaces (1-3 methods) |
| Premature channels | Complexity without benefit | Start with mutex, upgrade if needed |
| No context propagation | Can't cancel, no deadlines | Pass `context.Context` as first param |
| `fmt.Errorf` without `%w` | Can't unwrap errors upstream | Always use `%w` for wrapping |

---

## Verification Checklist

Before considering Go work done:
- [ ] `go build ./...` compiles without errors
- [ ] `go vet ./...` reports no issues
- [ ] `golangci-lint run` passes (or staticcheck)
- [ ] `go test ./...` passes all tests
- [ ] `go test -race ./...` detects no race conditions
- [ ] All errors wrapped with context (`fmt.Errorf("...: %w", err)`)
- [ ] No naked goroutines (use errgroup or handle panics)
- [ ] Context propagated through all I/O operations
- [ ] Interfaces defined by consumers, not implementers
- [ ] `go mod tidy` leaves no unused dependencies
