---
name: spring-boot
description: Spring Boot, Spring Security, JPA. Use when working on spring-boot tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Spring Boot
# Loaded on-demand when working with Spring Boot, Spring Framework, Java backend

## Auto-Detect

Trigger this skill when:
- Files: `pom.xml` or `build.gradle` with `spring-boot-starter`
- Directories: `src/main/java/`, `src/main/resources/application.yml`
- Task mentions: Spring Boot, Spring Security, JPA, Hibernate, Spring Data

---

## Decision Tree: Architecture Style

```
What are you building?
├── Simple REST API (< 10 endpoints)?
│   └── Controller + Service + Repository (standard layered)
├── Complex domain logic?
│   ├── Hexagonal architecture (ports & adapters)
│   └── Domain-Driven Design (aggregates, value objects)
├── High-throughput / reactive?
│   ├── Virtual threads (Spring Boot 3.4+, Project Loom) → preferred
│   └── WebFlux (only if streaming/backpressure needed)
├── Microservices?
│   ├── Spring Cloud (discovery, config, gateway)
│   └── Direct HTTP/gRPC with resilience4j
├── Native compilation needed?
│   └── GraalVM native image (Spring Boot 3.4 AOT)
└── Batch processing?
    └── Spring Batch with chunk-oriented processing
```

## Decision Tree: Threading Model

```
Need concurrency?
├── I/O-bound (DB, HTTP calls, file)?
│   └── Virtual threads (zero-cost, Spring Boot 3.4 default option)
├── CPU-bound computation?
│   └── Platform threads with bounded pool
├── Streaming with backpressure?
│   └── WebFlux + Project Reactor
├── Background tasks?
│   └── @Async with virtual thread executor
└── Scheduled jobs?
    └── @Scheduled + ShedLock for distributed locking
```

---

## Spring Boot 3.4 — Virtual Threads

```java
// application.yml — enable virtual threads (one line!)
spring:
  threads:
    virtual:
      enabled: true  // All request handling uses virtual threads

// That's it. Every @RestController, @Service, @Repository
// now runs on virtual threads. No code changes needed.

// Custom virtual thread executor for @Async
@Configuration
@EnableAsync
public class AsyncConfig {
    @Bean
    public Executor taskExecutor() {
        return Executors.newVirtualThreadPerTaskExecutor();
    }
}

// Structured concurrency (Java 21+ preview, production in Java 24)
@Service
public class OrderService {
    public OrderDetails getOrderDetails(Long orderId) throws Exception {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var orderFuture = scope.fork(() -> orderRepo.findById(orderId).orElseThrow());
            var paymentFuture = scope.fork(() -> paymentClient.getPayment(orderId));
            var shippingFuture = scope.fork(() -> shippingClient.getStatus(orderId));

            scope.join().throwIfFailed();

            return new OrderDetails(
                orderFuture.get(),
                paymentFuture.get(),
                shippingFuture.get()
            );
        }
    }
}
```

---

## GraalVM Native Image

```java
// Build native image — 10x faster startup, 5x less memory
// mvn -Pnative native:compile
// or: gradle nativeCompile

// Runtime hints for reflection (needed for native)
@RegisterReflectionForBinding({User.class, OrderDto.class})
@Configuration
public class NativeConfig {}

// Conditional beans for native vs JVM
@Profile("native")
@Configuration
public class NativeSpecificConfig {
    @Bean
    public DataSource dataSource() {
        // HikariCP works, but pool size should be smaller for native
        var ds = new HikariDataSource();
        ds.setMaximumPoolSize(5); // Native apps use less memory
        return ds;
    }
}
```

```yaml
# application.yml for native builds
spring:
  aot:
    enabled: true
  datasource:
    url: jdbc:postgresql://localhost:5432/app
    hikari:
      maximum-pool-size: ${POOL_SIZE:10}
```

---

## Spring Security 6.4

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity // Enables @PreAuthorize, @PostAuthorize
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.ignoringRequestMatchers("/api/**"))
            .sessionManagement(sm -> sm.sessionCreationPolicy(STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**", "/actuator/health").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/posts/**").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthConverter()))
            )
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((req, res, e) ->
                    res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Invalid token"))
            )
            .build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthConverter() {
        var converter = new JwtGrantedAuthoritiesConverter();
        converter.setAuthoritiesClaimName("roles");
        converter.setAuthorityPrefix("ROLE_");
        var jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(converter);
        return jwtConverter;
    }
}

// Method-level security
@Service
public class PostService {
    @PreAuthorize("hasRole('ADMIN') or #post.authorId == authentication.name")
    public void deletePost(Post post) { /* ... */ }

    @PostAuthorize("returnObject.authorId == authentication.name or hasRole('ADMIN')")
    public Post getPost(Long id) { return postRepo.findById(id).orElseThrow(); }
}
```

---

## Spring Data JPA — Modern Patterns

```java
// Repository with EntityGraph and custom queries
public interface PostRepository extends JpaRepository<Post, Long>,
                                        JpaSpecificationExecutor<Post> {

    @EntityGraph(attributePaths = {"author", "tags"})
    Page<Post> findByPublishedTrue(Pageable pageable);

    @Query("""
        SELECT p FROM Post p
        JOIN FETCH p.author
        WHERE p.category.id = :categoryId
        AND p.publishedAt <= CURRENT_TIMESTAMP
        ORDER BY p.publishedAt DESC
        """)
    List<Post> findPublishedByCategory(@Param("categoryId") Long categoryId);

    // Projection — fetch only needed columns
    @Query("SELECT p.id as id, p.title as title, p.author.name as authorName FROM Post p")
    List<PostSummaryProjection> findAllSummaries(Pageable pageable);
}

// Record-based DTO projection (Spring Boot 3.4)
public record PostSummary(Long id, String title, String authorName) {}

// Specifications for dynamic filtering
public class PostSpecifications {
    public static Specification<Post> hasCategory(Long categoryId) {
        return (root, query, cb) -> categoryId == null
            ? cb.conjunction()
            : cb.equal(root.get("category").get("id"), categoryId);
    }

    public static Specification<Post> titleContains(String keyword) {
        return (root, query, cb) -> keyword == null
            ? cb.conjunction()
            : cb.like(cb.lower(root.get("title")), "%" + keyword.toLowerCase() + "%");
    }

    public static Specification<Post> publishedBefore(Instant date) {
        return (root, query, cb) -> cb.lessThanOrEqualTo(root.get("publishedAt"), date);
    }
}

// Usage in service
public Page<Post> search(PostSearchCriteria criteria, Pageable pageable) {
    var spec = Specification.where(hasCategory(criteria.categoryId()))
        .and(titleContains(criteria.keyword()))
        .and(publishedBefore(Instant.now()));
    return postRepo.findAll(spec, pageable);
}
```

---

## Configuration & Observability

```java
// Type-safe configuration with records
@ConfigurationProperties(prefix = "app.payment")
public record PaymentProperties(
    String apiKey,
    String webhookSecret,
    Duration timeout,
    RetryProperties retry
) {
    public record RetryProperties(int maxAttempts, Duration backoff) {}
}

// Usage — inject directly
@Service
public class PaymentService {
    private final PaymentProperties config;
    public PaymentService(PaymentProperties config) { this.config = config; }
}
```

```yaml
# application.yml
app:
  payment:
    api-key: ${PAYMENT_API_KEY}
    webhook-secret: ${PAYMENT_WEBHOOK_SECRET}
    timeout: 30s
    retry:
      max-attempts: 3
      backoff: 2s

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
  tracing:
    sampling:
      probability: 1.0  # 100% in dev, lower in prod
```

---

## Exception Handling & Validation

```java
// Global exception handler with RFC 7807 Problem Details
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ProblemDetail handleNotFound(ResourceNotFoundException ex) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setTitle("Resource Not Found");
        problem.setProperty("resourceId", ex.getResourceId());
        return problem;
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        var problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Validation Failed");
        var errors = ex.getBindingResult().getFieldErrors().stream()
            .collect(Collectors.toMap(
                FieldError::getField,
                fe -> fe.getDefaultMessage() != null ? fe.getDefaultMessage() : "invalid",
                (a, b) -> a
            ));
        problem.setProperty("errors", errors);
        return ResponseEntity.badRequest().body(problem);
    }
}

// Validation with records
public record CreatePostRequest(
    @NotBlank @Size(max = 255) String title,
    @NotBlank @Size(min = 50, max = 50000) String body,
    @NotNull Long categoryId,
    @Size(max = 10) List<Long> tagIds
) {}
```

---

## Testing — Sliced & Integration

```java
// Integration test with Testcontainers (Spring Boot 3.4)
@SpringBootTest
@Testcontainers
class PostControllerIT {

    @Container
    @ServiceConnection // Auto-configures datasource
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired MockMvc mockMvc;
    @Autowired PostRepository postRepo;

    @Test
    @WithMockUser(roles = "USER")
    void shouldCreatePost() throws Exception {
        mockMvc.perform(post("/api/v1/posts")
                .contentType(APPLICATION_JSON)
                .content("""
                    {"title": "Test Post", "body": "%s", "categoryId": 1}
                    """.formatted("a".repeat(50))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.title").value("Test Post"));

        assertThat(postRepo.count()).isEqualTo(1);
    }
}

// Slice test — JPA only, no web layer
@DataJpaTest
@AutoConfigureTestDatabase(replace = NONE)
@Testcontainers
class PostRepositoryTest {
    @Container @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired PostRepository postRepo;
    @Autowired TestEntityManager em;

    @Test
    void shouldFindPublishedPosts() {
        em.persist(new Post("Published", true, Instant.now().minusSeconds(3600)));
        em.persist(new Post("Draft", false, null));

        var published = postRepo.findByPublishedTrue(Pageable.unpaged());
        assertThat(published).hasSize(1);
    }
}

// WebMvc slice test — controller only
@WebMvcTest(PostController.class)
class PostControllerTest {
    @Autowired MockMvc mockMvc;
    @MockitoBean PostService postService;

    @Test
    void shouldReturn404WhenPostNotFound() throws Exception {
        when(postService.findById(99L)).thenThrow(new ResourceNotFoundException("Post", 99L));
        mockMvc.perform(get("/api/v1/posts/99"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.title").value("Resource Not Found"));
    }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Field injection (`@Autowired`) | Hidden deps, untestable | Constructor injection (implicit with single constructor) |
| N+1 in JPA | Lazy loading in loops | `@EntityGraph`, `JOIN FETCH`, or DTO projections |
| No validation on DTOs | Invalid data reaches service | `@Valid` + Bean Validation annotations |
| Blocking calls in WebFlux | Thread starvation | Use virtual threads instead of WebFlux for most cases |
| Hardcoded config values | Can't change per environment | `@ConfigurationProperties` + profiles |
| No migration tool | Schema drift between environments | Flyway or Liquibase from day one |
| Monolithic test context | Slow tests, 30s+ startup | `@WebMvcTest`, `@DataJpaTest` slices |
| Catching `Exception` broadly | Swallows real errors | Catch specific exceptions, let others propagate |
| `@Transactional` on everything | Unnecessary DB locks | Only on methods that need atomicity |
| Returning entities from controllers | Exposes internal model | Use DTOs/records for API responses |

---

## Verification Checklist

Before considering Spring Boot work done:
- [ ] `./mvnw verify` or `./gradlew check` passes
- [ ] No field injection — all constructor-based
- [ ] All endpoints have integration tests
- [ ] Security config tested (authenticated + unauthorized paths)
- [ ] Database migrations present (Flyway/Liquibase)
- [ ] `@Valid` on all request body parameters
- [ ] Global exception handler returns consistent error format
- [ ] Actuator health endpoint exposed (not sensitive endpoints)
- [ ] Virtual threads enabled if on Spring Boot 3.4+
- [ ] No `@Transactional` on read-only queries (use `@Transactional(readOnly = true)`)
