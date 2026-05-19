---
name: csharp
description: C#, .NET, ASP.NET Core. Use when working on csharp tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: C# / .NET
# Loaded on-demand when working with .cs, .csproj, .sln files

## Auto-Detect

Trigger this skill when:
- File extensions: `.cs`, `.csproj`, `.sln`, `.razor`
- Project files contain: `<Project Sdk="Microsoft.NET.Sdk">`
- Imports from: `Microsoft.AspNetCore`, `Microsoft.Extensions`, `System.Linq`
- Tools: `dotnet` CLI, NuGet, Entity Framework Core

---

## Decision Tree: Project Type

```
What are you building?
├── Web API?
│   ├── Simple CRUD? → Minimal APIs (no controllers)
│   ├── Complex domain? → Controllers + MediatR/Vertical Slices
│   └── Microservices? → .NET Aspire orchestration
├── Background processing?
│   ├── Simple timer? → BackgroundService / IHostedService
│   ├── Queue-based? → Worker Service + message broker
│   └── Complex workflows? → Durable Functions / Temporal
├── Desktop/UI?
│   ├── Cross-platform? → MAUI / Avalonia
│   └── Windows only? → WPF / WinUI 3
└── Library/Package?
    └── Class library + source generators for boilerplate
```

## Decision Tree: Data Access

```
How to access data?
├── Simple queries, full control? → Dapper
├── Rich domain model, migrations? → EF Core
├── Document store? → MongoDB.Driver / CosmosDB SDK
└── Caching layer?
    ├── In-process? → IMemoryCache
    └── Distributed? → IDistributedCache (Redis)
```

---

## C# 13 / .NET 9 Patterns

```csharp
// Primary constructors — DI without boilerplate
public class UserService(IUserRepository repo, ILogger<UserService> logger)
{
    public async Task<User?> GetByIdAsync(int id, CancellationToken ct = default)
    {
        logger.LogDebug("Fetching user {Id}", id);
        return await repo.FindAsync(id, ct);
    }
}

// Collection expressions — unified initialization syntax
int[] numbers = [1, 2, 3, 4, 5];
List<string> names = ["Alice", "Bob", "Charlie"];
Span<byte> buffer = [0x00, 0xFF, 0xAB];

// Spread operator in collections
int[] combined = [..firstArray, ..secondArray, 42];

// Raw string literals — no escaping needed
var json = """
    {
        "name": "Alice",
        "email": "alice@example.com"
    }
    """;

// Pattern matching — exhaustive and expressive
string Classify(object obj) => obj switch
{
    int n when n < 0 => "negative",
    int n => $"positive: {n}",
    string { Length: 0 } => "empty string",
    string s => $"string: {s}",
    null => "null",
    _ => "unknown"
};

// Required members + init-only
public class Config
{
    public required string ConnectionString { get; init; }
    public required int MaxRetries { get; init; }
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
}
```

---

## Minimal APIs (.NET 9)

```csharp
var builder = WebApplication.CreateBuilder(args);

// Service registration
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

var app = builder.Build();

// Endpoint groups — organized routing
var users = app.MapGroup("/api/users")
    .WithTags("Users")
    .RequireAuthorization();

users.MapGet("/", async (IUserRepository repo, CancellationToken ct) =>
    Results.Ok(await repo.GetAllAsync(ct)));

users.MapGet("/{id:int}", async (int id, IUserRepository repo, CancellationToken ct) =>
    await repo.FindAsync(id, ct) is { } user
        ? Results.Ok(user)
        : Results.NotFound());

users.MapPost("/", async (CreateUserRequest req, IUserRepository repo, CancellationToken ct) =>
{
    var user = await repo.CreateAsync(req, ct);
    return Results.Created($"/api/users/{user.Id}", user);
}).WithValidation<CreateUserRequest>();

app.Run();

// Typed results for OpenAPI generation
users.MapGet("/{id:int}", async Task<Results<Ok<User>, NotFound>> (int id, IUserRepository repo, CancellationToken ct) =>
    await repo.FindAsync(id, ct) is { } user
        ? TypedResults.Ok(user)
        : TypedResults.NotFound());
```

---

## .NET Aspire (Cloud-Native Orchestration)

```csharp
// AppHost/Program.cs — orchestrate distributed app
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("pg")
    .WithPgAdmin()
    .AddDatabase("appdb");

var redis = builder.AddRedis("cache");

var api = builder.AddProject<Projects.MyApp_Api>("api")
    .WithReference(postgres)
    .WithReference(redis)
    .WithExternalHttpEndpoints();

builder.AddProject<Projects.MyApp_Web>("web")
    .WithReference(api)
    .WithExternalHttpEndpoints();

builder.Build().Run();

// In API project — consume Aspire resources
builder.AddNpgsqlDbContext<AppDbContext>("appdb");
builder.AddRedisDistributedCache("cache");

// Service defaults (resilience, telemetry, health checks)
builder.AddServiceDefaults(); // Adds OpenTelemetry, health checks, resilience
```

---

## Source Generators

```csharp
// Compile-time code generation — zero runtime reflection
[JsonSerializable(typeof(User))]
[JsonSerializable(typeof(List<User>))]
internal partial class AppJsonContext : JsonSerializerContext { }

// Usage — AOT-compatible, faster serialization
app.MapGet("/users", () => Results.Json(users, AppJsonContext.Default.ListUser));

// Logging source generator — structured, high-performance
public static partial class Log
{
    [LoggerMessage(Level = LogLevel.Information, Message = "User {UserId} created")]
    public static partial void UserCreated(ILogger logger, int userId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to process order {OrderId}")]
    public static partial void OrderFailed(ILogger logger, string orderId, Exception ex);
}

// Regex source generator
public partial class Validators
{
    [GeneratedRegex(@"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")]
    private static partial Regex EmailRegex();

    public static bool IsValidEmail(string email) => EmailRegex().IsMatch(email);
}
```

---

## Error Handling & Result Pattern

```csharp
// Typed result — no exceptions for expected failures
public abstract record Result<T>
{
    public record Success(T Value) : Result<T>;
    public record Failure(Error Error) : Result<T>;

    public TOut Match<TOut>(Func<T, TOut> onSuccess, Func<Error, TOut> onFailure) =>
        this switch
        {
            Success s => onSuccess(s.Value),
            Failure f => onFailure(f.Error),
            _ => throw new InvalidOperationException()
        };
}

public record Error(string Code, string Message);

// Global exception handler middleware
app.UseExceptionHandler(error => error.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var response = exception switch
    {
        NotFoundException e => (StatusCodes.Status404NotFound, e.Message),
        ValidationException e => (StatusCodes.Status422UnprocessableEntity, e.Message),
        _ => (StatusCodes.Status500InternalServerError, "An unexpected error occurred")
    };
    context.Response.StatusCode = response.Item1;
    await context.Response.WriteAsJsonAsync(new { error = response.Item2 });
}));
```

---

## Testing

```csharp
// Integration test with WebApplicationFactory
public class UsersApiTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.WithWebHostBuilder(builder =>
    {
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase("test"));
        });
    }).CreateClient();

    [Fact]
    public async Task GetUser_ReturnsNotFound_WhenMissing()
    {
        var response = await _client.GetAsync("/api/users/999");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

// Unit test with NSubstitute
[Fact]
public async Task CreateUser_CallsRepository()
{
    var repo = Substitute.For<IUserRepository>();
    var service = new UserService(repo, NullLogger<UserService>.Instance);

    await service.CreateAsync(new("alice@test.com", "Alice"), CancellationToken.None);

    await repo.Received(1).CreateAsync(Arg.Any<CreateUserRequest>(), Arg.Any<CancellationToken>());
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| `async void` methods | Unobserved exceptions crash the process | Always return `Task` or `Task<T>` |
| Catching `Exception` broadly | Swallows bugs, hides root cause | Catch specific exceptions, let others propagate |
| `Task.Result` / `.Wait()` | Deadlocks in sync-over-async | Use `await` all the way up |
| Service locator (`GetService` everywhere) | Hidden dependencies, untestable | Constructor injection via DI |
| No `CancellationToken` propagation | Requests can't be cancelled, resource waste | Pass `CancellationToken` through all async chains |
| Mutable DTOs with public setters | Accidental mutation, thread-safety issues | Use `record` or `required init` properties |
| String concatenation for SQL | SQL injection vulnerability | Use parameterized queries / EF Core |
| `HttpClient` created per request | Socket exhaustion | Use `IHttpClientFactory` |

---

## Verification Checklist

Before considering .NET work done:
- [ ] `dotnet build` succeeds with no warnings (TreatWarningsAsErrors)
- [ ] Nullable reference types enabled (`<Nullable>enable</Nullable>`)
- [ ] All async methods accept and forward `CancellationToken`
- [ ] No `async void` except event handlers
- [ ] DI lifetimes correct (Scoped for DB, Singleton for stateless)
- [ ] EF migrations generated and tested
- [ ] Integration tests cover critical API paths
- [ ] Source generators used for serialization (AOT-ready)
- [ ] Health checks registered for all external dependencies
- [ ] `dotnet test` passes with no flaky tests
