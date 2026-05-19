---
name: java-kotlin
description: Java, Kotlin, JVM ecosystem. Use when working on java-kotlin tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Java / Kotlin
# Loaded on-demand when working with .java, .kt, .kts files

## Auto-Detect

Trigger this skill when:
- File extensions: `.java`, `.kt`, `.kts`, `.gradle`, `.gradle.kts`
- Build files: `pom.xml`, `build.gradle.kts`, `settings.gradle.kts`
- Imports from: `java.`, `javax.`, `jakarta.`, `kotlin.`, `kotlinx.`
- Frameworks: Spring Boot, Ktor, Quarkus, Micronaut

---

## Decision Tree: JVM Language Choice

```
Which language?
├── Existing Java codebase, team knows Java? → Java 23
├── New project, team open to modern syntax? → Kotlin
├── Android development? → Kotlin (mandatory)
├── Spring Boot?
│   ├── Both work well → Kotlin for conciseness, Java for hiring pool
│   └── Coroutines needed? → Kotlin
└── Performance-critical library? → Java (better AOT with GraalVM)
```

## Decision Tree: Concurrency Model

```
What concurrency model?
├── Simple parallel I/O (HTTP calls, DB)? → Virtual threads (Java 23)
├── Structured async with cancellation? → Kotlin coroutines
├── Reactive streams (backpressure)? → Project Reactor / Kotlin Flow
├── CPU-bound parallelism? → ForkJoinPool / parallel streams
└── Actor model? → Akka / Kotlin actors (rare, specific use cases)
```

---

## Java 23 Patterns

```java
// Records — immutable data carriers
public record User(String id, String email, String name) {
    // Compact constructor for validation
    public User {
        Objects.requireNonNull(email, "email must not be null");
        if (!email.contains("@")) throw new IllegalArgumentException("invalid email");
    }
}

// Sealed interfaces — exhaustive type hierarchies
public sealed interface Result<T> permits Success, Failure {}
public record Success<T>(T value) implements Result<T> {}
public record Failure<T>(String code, String message) implements Result<T> {}

// Pattern matching with switch (Java 21+)
String describe(Object obj) {
    return switch (obj) {
        case Integer i when i < 0 -> "negative: " + i;
        case Integer i -> "positive: " + i;
        case String s when s.isBlank() -> "blank string";
        case String s -> "string: " + s;
        case null -> "null";
        default -> "unknown: " + obj.getClass().getSimpleName();
    };
}

// Unnamed patterns and variables (Java 22+)
if (obj instanceof Point(var x, _)) {
    // Only need x coordinate, ignore y
    System.out.println("x = " + x);
}

// String templates (preview in Java 23)
// var msg = STR."Hello \{user.name()}, you have \{count} messages";

// Scoped values — structured sharing (replaces ThreadLocal for virtual threads)
private static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

void handleRequest(User user) {
    ScopedValue.runWhere(CURRENT_USER, user, () -> {
        processOrder(); // can read CURRENT_USER.get() anywhere in this scope
    });
}

// Virtual threads — lightweight concurrency (Java 21+)
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Response>> futures = urls.stream()
        .map(url -> executor.submit(() -> httpClient.send(
            HttpRequest.newBuilder(URI.create(url)).build(),
            HttpResponse.BodyHandlers.ofString())))
        .toList();

    List<Response> responses = futures.stream()
        .map(f -> { try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); } })
        .toList();
}

// Structured concurrency (preview)
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<User> userTask = scope.fork(() -> fetchUser(id));
    Subtask<List<Order>> ordersTask = scope.fork(() -> fetchOrders(id));
    scope.join().throwIfFailed();
    return new Dashboard(userTask.get(), ordersTask.get());
}
```

---

## Kotlin 2.1 Patterns

```kotlin
// Data class with copy
data class User(val id: String, val email: String, val name: String)

// Sealed hierarchy — exhaustive when
sealed interface Result<out T> {
    data class Success<T>(val value: T) : Result<T>
    data class Failure(val code: String, val message: String) : Result<Nothing>
}

fun <T> Result<T>.getOrThrow(): T = when (this) {
    is Result.Success -> value
    is Result.Failure -> throw AppException(code, message)
}

// Context receivers (Kotlin 2.0+)
context(LoggingContext, TransactionContext)
fun createUser(request: CreateUserRequest): User {
    log.info("Creating user: ${request.email}")
    return transaction {
        userRepository.save(request.toEntity())
    }
}

// Value classes — zero-cost type safety
@JvmInline
value class UserId(val value: String) {
    init { require(value.isNotBlank()) { "UserId cannot be blank" } }
}

@JvmInline
value class Email(val value: String) {
    init { require("@" in value) { "Invalid email: $value" } }
}

fun findUser(id: UserId): User? = repository.find(id) // Can't accidentally pass Email
```

---

## Kotlin Coroutines

```kotlin
// Structured concurrency — parent cancels children
suspend fun fetchDashboard(userId: String): Dashboard = coroutineScope {
    val user = async { userService.getUser(userId) }
    val orders = async { orderService.getOrders(userId) }
    val notifications = async { notificationService.getRecent(userId) }
    Dashboard(user.await(), orders.await(), notifications.await())
}

// Flow — cold async stream with backpressure
fun observeOrders(userId: String): Flow<Order> = flow {
    while (currentCoroutineContext().isActive) {
        val orders = orderRepository.findNew(userId)
        orders.forEach { emit(it) }
        delay(5.seconds)
    }
}.flowOn(Dispatchers.IO)
 .catch { e -> logger.error("Order stream failed", e) }

// Channel — hot producer/consumer
val orderChannel = Channel<Order>(capacity = Channel.BUFFERED)

// SupervisorJob — child failure doesn't cancel siblings
val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

// Exception handling
val handler = CoroutineExceptionHandler { _, exception ->
    logger.error("Unhandled coroutine exception", exception)
}
```

---

## Spring Boot Integration

```kotlin
// Spring Boot with Kotlin coroutines
@RestController
@RequestMapping("/api/users")
class UserController(private val userService: UserService) {

    @GetMapping("/{id}")
    suspend fun getUser(@PathVariable id: String): ResponseEntity<User> {
        val user = userService.findById(UserId(id))
        return user?.let { ResponseEntity.ok(it) }
            ?: ResponseEntity.notFound().build()
    }

    @PostMapping
    suspend fun createUser(@Valid @RequestBody request: CreateUserRequest): ResponseEntity<User> {
        val user = userService.create(request)
        return ResponseEntity.created(URI("/api/users/${user.id.value}")).body(user)
    }
}

// Repository with virtual threads (Java) or coroutines (Kotlin)
interface UserRepository : CoroutineCrudRepository<UserEntity, String> {
    suspend fun findByEmail(email: String): UserEntity?
}

// Configuration
@Configuration
class AppConfig {
    @Bean
    fun objectMapper(): ObjectMapper = jacksonObjectMapper()
        .registerModule(JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
}
```

---

## Build Configuration

```kotlin
// build.gradle.kts — Kotlin DSL
plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.spring") version "2.1.0"
    id("org.springframework.boot") version "3.4.0"
    id("io.spring.dependency-management") version "1.1.6"
}

kotlin {
    jvmToolchain(23)
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xcontext-receivers")
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.mockk:mockk:1.13.13")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test")
}

tasks.test { useJUnitPlatform() }
```

---

## Testing

```kotlin
// Unit test with MockK
class UserServiceTest {
    private val repo = mockk<UserRepository>()
    private val service = UserService(repo)

    @Test
    fun `findById returns user when exists`() = runTest {
        val expected = User(UserId("1"), Email("a@b.com"), "Alice")
        coEvery { repo.findById("1") } returns expected.toEntity()

        val result = service.findById(UserId("1"))

        assertEquals(expected, result)
        coVerify(exactly = 1) { repo.findById("1") }
    }

    @Test
    fun `findById returns null when not found`() = runTest {
        coEvery { repo.findById(any()) } returns null
        assertNull(service.findById(UserId("999")))
    }
}

// Integration test (Java + Spring)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class UserApiIntegrationTest {
    @Autowired lateinit var client: WebTestClient

    @Test
    void `GET user returns 404 when not found`() {
        client.get().uri("/api/users/999")
            .exchange()
            .expectStatus().isNotFound
    }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| `var x: String? = null` everywhere | Null-safety defeated | Design non-null by default, nullable only at boundaries |
| `GlobalScope.launch` | Leaked coroutines, no cancellation | Use structured concurrency (`coroutineScope`, `viewModelScope`) |
| Blocking in coroutine (`Thread.sleep`) | Blocks virtual thread / coroutine thread | Use `delay()` or `withContext(Dispatchers.IO)` |
| `ThreadLocal` with virtual threads | Virtual threads multiplex on carriers | Use `ScopedValue` (Java) or coroutine context (Kotlin) |
| Mutable data classes | Thread-safety issues, unexpected mutations | Use `val` properties, `copy()` for changes |
| Catching `Exception` broadly | Swallows `CancellationException` in coroutines | Catch specific types, rethrow `CancellationException` |
| Raw strings for IDs | Type confusion (userId vs orderId) | Value classes / inline classes |
| No timeout on external calls | Hung threads, resource exhaustion | `withTimeout {}` (Kotlin) or `.timeout()` (Java HttpClient) |

---

## Verification Checklist

Before considering JVM work done:
- [ ] Build passes: `./gradlew build` or `mvn verify`
- [ ] No compiler warnings (treat warnings as errors in CI)
- [ ] Null safety enforced (Kotlin) or `@Nullable`/`@NonNull` annotations (Java)
- [ ] Coroutines use structured concurrency (no `GlobalScope`)
- [ ] Virtual threads used for blocking I/O (Java 21+)
- [ ] Tests pass with `./gradlew test` — no flaky tests
- [ ] Integration tests use `@SpringBootTest` or Testcontainers
- [ ] No blocking calls inside coroutine scopes without `Dispatchers.IO`
- [ ] Value classes used for domain IDs
- [ ] Detekt/ktlint (Kotlin) or Checkstyle/SpotBugs (Java) passes
