---
name: scala
description: Scala, Akka, Cats/ZIO, SBT. Use when working on scala tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Scala
# Loaded on-demand when working with .scala, .sc files, Akka, Play

## Auto-Detect

Trigger this skill when:
- File extensions: `.scala`, `.sc`, `.sbt`
- Build files: `build.sbt`, `project/build.properties`, `build.sc` (Mill)
- Imports from: `zio.`, `cats.`, `akka.`, `sttp.`, `tapir.`
- Frameworks: ZIO, Cats Effect, Akka, Play, http4s, Tapir

---

## Decision Tree: Effect System

```
Which effect system?
+-- New project, want batteries-included?
|   +-- ZIO 2 (DI, config, logging, streams, testing built-in)
+-- Prefer typelevel ecosystem, minimal runtime?
|   +-- Cats Effect 3 + fs2 + http4s
+-- Need actor model / distributed?
|   +-- Akka (Pekko) Typed
+-- Simple app, no effects?
|   +-- Direct style with Scala 3 (boundary/break, Ox)
+-- Existing Java codebase integration?
    +-- Direct style or CompletableFuture interop
```

## Decision Tree: HTTP Framework

```
Which HTTP library?
+-- Type-safe endpoints with OpenAPI generation? -> Tapir
+-- Functional, streaming, Cats Effect? -> http4s
+-- Full-stack web framework? -> Play Framework
+-- ZIO ecosystem? -> zio-http
+-- High performance, minimal? -> Vert.x (via Scala wrapper)
```

---

## Scala 3.5 Patterns

```scala
// Opaque types — zero-cost type safety (no boxing)
object Types:
  opaque type UserId = String
  opaque type Email = String
  opaque type Money = BigDecimal

  object UserId:
    def apply(value: String): UserId = value
    extension (id: UserId) def value: String = id

  object Email:
    def apply(value: String): Either[String, Email] =
      if value.contains("@") then Right(value)
      else Left(s"Invalid email: $value")
    extension (e: Email) def value: String = e

  object Money:
    def apply(amount: BigDecimal): Money = amount
    extension (m: Money)
      def value: BigDecimal = m
      def +(other: Money): Money = m + other
      def *(factor: BigDecimal): Money = m * factor

// Usage — compiler prevents mixing types
import Types.*
def findUser(id: UserId): Option[User] = ???
// findUser(Email("x@y.com")) // Won't compile!

// Enum with methods (Scala 3)
enum HttpStatus(val code: Int):
  case Ok extends HttpStatus(200)
  case NotFound extends HttpStatus(404)
  case InternalError extends HttpStatus(500)

  def isSuccess: Boolean = code >= 200 && code < 300

// Union types — lightweight alternatives to sealed traits
type JsonPrimitive = String | Int | Double | Boolean | Null
type Result[+A] = A | Error

// Context functions — dependency injection at type level
type Transactional[A] = Transaction ?=> A

def transfer(from: AccountId, to: AccountId, amount: Money): Transactional[Unit] =
  val tx = summon[Transaction]
  tx.debit(from, amount)
  tx.credit(to, amount)

// Given instances — type class derivation
given Ordering[User] = Ordering.by(_.name)
given [A: Ordering]: Ordering[List[A]] = Ordering.by(_.sorted.headOption)
```

---

## ZIO 2

```scala
import zio.*
import zio.stream.*

// ZIO[R, E, A] — R = environment, E = error, A = success
// Fully typed effects with dependency injection

// Service definition
trait UserRepository:
  def find(id: UserId): IO[AppError, Option[User]]
  def save(user: User): IO[AppError, User]
  def findByEmail(email: Email): IO[AppError, Option[User]]

// Service implementation
case class UserRepositoryLive(db: Database) extends UserRepository:
  def find(id: UserId): IO[AppError, Option[User]] =
    db.query(sql"SELECT * FROM users WHERE id = ${id.value}")
      .map(_.headOption.map(User.fromRow))
      .mapError(AppError.Database(_))

  def save(user: User): IO[AppError, User] =
    db.execute(sql"INSERT INTO users ...")
      .as(user)
      .mapError(AppError.Database(_))

  def findByEmail(email: Email): IO[AppError, Option[User]] =
    db.query(sql"SELECT * FROM users WHERE email = ${email.value}")
      .map(_.headOption.map(User.fromRow))
      .mapError(AppError.Database(_))

object UserRepositoryLive:
  val layer: ZLayer[Database, Nothing, UserRepository] =
    ZLayer.fromFunction(UserRepositoryLive(_))

// Business logic — composable, testable
def createUser(request: CreateUserRequest): ZIO[UserRepository & EmailService, AppError, User] =
  for
    existing <- ZIO.serviceWithZIO[UserRepository](_.findByEmail(request.email))
    _        <- ZIO.when(existing.isDefined)(ZIO.fail(AppError.Conflict("Email taken")))
    user     <- ZIO.serviceWithZIO[UserRepository](_.save(User.from(request)))
    _        <- ZIO.serviceWithZIO[EmailService](_.sendWelcome(user)).forkDaemon
  yield user

// ZIO Streams — backpressured, composable
def processEvents: ZStream[EventSource & Database, AppError, ProcessedEvent] =
  ZStream
    .fromQueue(eventQueue)
    .mapZIOPar(16)(event => processEvent(event))
    .filter(_.isSuccess)
    .grouped(100)
    .mapZIO(batch => saveBatch(batch))
    .flatMap(ZStream.fromIterable(_))

// App wiring — layers compose automatically
object Main extends ZIOAppDefault:
  val run =
    createUser(request)
      .provide(
        UserRepositoryLive.layer,
        EmailServiceLive.layer,
        DatabaseLive.layer,
        ZLayer.succeed(DatabaseConfig("jdbc:postgresql://..."))
      )
```

---

## Cats Effect 3

```scala
import cats.effect.*
import cats.syntax.all.*

// IO[A] — pure functional effect
trait UserService[F[_]]:
  def find(id: UserId): F[Option[User]]
  def create(request: CreateUserRequest): F[Either[AppError, User]]

class UserServiceImpl[F[_]: Async](
  repo: UserRepository[F],
  mailer: EmailService[F]
) extends UserService[F]:

  def create(request: CreateUserRequest): F[Either[AppError, User]] =
    (for
      existing <- repo.findByEmail(request.email)
      _ <- existing.traverse_(_ => AppError.Conflict("Email taken").raiseError[F, Unit])
      user <- repo.save(User.from(request))
      _ <- mailer.sendWelcome(user).start // Fire and forget
    yield user).attempt.map(_.leftMap {
      case e: AppError => e
      case e => AppError.Unexpected(e.getMessage)
    })

// Resource management — bracket pattern
def makeHttpClient: Resource[IO, HttpClient] =
  Resource.make(IO(HttpClient.create()))(client => IO(client.close()))

def makeApp: Resource[IO, Unit] =
  for
    config <- Resource.eval(Config.load)
    db     <- Database.resource(config.db)
    http   <- makeHttpClient
    server <- HttpServer.resource(config.server, routes(db, http))
  yield ()

// Concurrent operations
def fetchDashboard(userId: UserId): IO[Dashboard] =
  (fetchProfile(userId), fetchOrders(userId), fetchNotifications(userId))
    .parMapN(Dashboard.apply)

// Ref — concurrent mutable state
def rateLimiter(maxRequests: Int): IO[String => IO[Boolean]] =
  Ref.of[IO, Map[String, Int]](Map.empty).map { ref =>
    key => ref.modify { state =>
      val count = state.getOrElse(key, 0)
      if count >= maxRequests then (state, false)
      else (state.updated(key, count + 1), true)
    }
  }
```

---

## Tapir (Type-Safe HTTP Endpoints)

```scala
import sttp.tapir.*
import sttp.tapir.json.zio.*
import sttp.tapir.server.ziohttp.*

// Define endpoint as a value — generates OpenAPI, client, server
val createUserEndpoint =
  endpoint.post
    .in("api" / "users")
    .in(jsonBody[CreateUserRequest])
    .out(jsonBody[User])
    .errorOut(
      oneOf[AppError](
        oneOfVariant(statusCode(StatusCode.Conflict), jsonBody[AppError.Conflict]),
        oneOfVariant(statusCode(StatusCode.BadRequest), jsonBody[AppError.Validation])
      )
    )
    .description("Create a new user")

// Server implementation
val createUserRoute =
  createUserEndpoint.zServerLogic(request => createUser(request))

// Generate OpenAPI docs
val docs = OpenAPIDocsInterpreter()
  .toOpenAPI(List(createUserEndpoint), "My API", "1.0.0")

// All endpoints -> HTTP server
val routes = ZioHttpInterpreter().toHttp(List(createUserRoute))
```

---

## Testing

```scala
import zio.test.*
import zio.test.Assertion.*

// ZIO Test — property-based + effect testing
object UserServiceSpec extends ZIOSpecDefault:
  def spec = suite("UserService")(
    test("creates user with valid email"):
      for
        service <- ZIO.service[UserService]
        result  <- service.create(CreateUserRequest("alice@test.com", "Alice"))
      yield assertTrue(
        result.isRight,
        result.toOption.get.email == Email("alice@test.com")
      )
    ,
    test("rejects duplicate email"):
      for
        service <- ZIO.service[UserService]
        _       <- service.create(CreateUserRequest("dup@test.com", "First"))
        result  <- service.create(CreateUserRequest("dup@test.com", "Second"))
      yield assertTrue(result.isLeft)
    ,
    test("email validation"):
      check(Gen.alphaNumericString)(str =>
        val result = Email(str)
        if str.contains("@") then assertTrue(result.isRight)
        else assertTrue(result.isLeft)
      )
  ).provide(UserServiceLive.layer, InMemoryUserRepo.layer, TestEmailService.layer)

// MUnit for simpler tests
class ParserSuite extends munit.FunSuite:
  test("parses valid integer"):
    assertEquals(parseInt("42"), Right(42))

  test("returns error for empty"):
    assert(parseInt("").isLeft)
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| `Any` / `AnyRef` types | Defeats type safety | Use opaque types, union types, proper ADTs |
| `null` usage | NPE at runtime | `Option[A]` exclusively |
| Blocking in effect context | Starves thread pool | `ZIO.attemptBlocking` / `IO.blocking` |
| Implicit abuse (Scala 2 style) | Unreadable, hard to trace | Scala 3 `given`/`using` with clear names |
| God objects with 50+ methods | Untestable, violates SRP | Small services, ZLayer composition |
| `Future` without ExecutionContext control | Thread pool exhaustion | Use ZIO/CE3 with controlled fiber scheduling |
| Throwing exceptions in pure code | Breaks referential transparency | Return `Either`/`ZIO.fail` |
| No resource safety (open connections) | Leaks on error | `Resource` / `ZIO.acquireRelease` |

---

## Verification Checklist

Before considering Scala work done:
- [ ] `sbt compile` passes with no warnings (`-Xfatal-warnings`)
- [ ] `sbt test` passes — all specs green
- [ ] No `Any`/`null`/`var` in production code
- [ ] Opaque types used for domain primitives
- [ ] Effects are properly typed (`ZIO[R, E, A]` or `IO[A]`)
- [ ] Resources managed with `Resource`/`acquireRelease`
- [ ] Error types are explicit (sealed trait hierarchy)
- [ ] `scalafmt` and `scalafix` pass
- [ ] Tapir endpoints generate valid OpenAPI spec
- [ ] Integration tests use test layers/mocks
