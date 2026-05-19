---
name: php
description: PHP ecosystem, Composer. Use when working on php tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: PHP
# Loaded on-demand when working with .php files

## Auto-Detect

Trigger this skill when:
- File extensions: `.php`, `composer.json`, `composer.lock`
- Frameworks: Laravel, Symfony, WordPress, Drupal
- Tools: Composer, PHPStan, Pest, PHPUnit
- Patterns: `<?php`, `declare(strict_types=1)`

---

## Decision Tree: PHP Project Architecture

```
What are you building?
├── Web application?
│   ├── Full-stack with admin? → Laravel
│   ├── Enterprise/complex DDD? → Symfony
│   ├── CMS/content site? → WordPress (reluctantly) / Statamic
│   └── API-only? → Laravel or Slim/Mezzio
├── Package/library?
│   └── Composer package + PSR standards
├── CLI tool?
│   └── Symfony Console / Laravel Zero
└── Microservice?
    └── Swoole/RoadRunner + framework of choice
```

## Decision Tree: Type Safety

```
How strict?
├── New project? → PHPStan level 9 + strict_types everywhere
├── Legacy codebase? → Start at PHPStan level 5, increase gradually
├── Need runtime validation? → Symfony Validator / Laravel Form Requests
└── Complex domain? → Value objects + enums + readonly classes
```

---

## PHP 8.4 Patterns

```php
<?php

declare(strict_types=1);

// Property hooks (PHP 8.4) — computed/validated properties without boilerplate
class Temperature
{
    public float $celsius {
        get => ($this->fahrenheit - 32) * 5 / 9;
        set => $this->fahrenheit = ($value * 9 / 5) + 32;
    }

    public function __construct(
        public float $fahrenheit,
    ) {}
}

// Asymmetric visibility (PHP 8.4) — public read, private write
class User
{
    public function __construct(
        public private(set) string $name,
        public private(set) string $email,
        public private(set) readonly string $id,
    ) {}

    public function rename(string $name): void
    {
        $this->name = $name; // allowed internally
    }
}
// $user->name; // OK — public read
// $user->name = 'x'; // Error — private set

// Enums with methods and interfaces
enum OrderStatus: string implements HasLabel
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Shipped = 'shipped';
    case Cancelled = 'cancelled';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Awaiting Payment',
            self::Paid => 'Processing',
            self::Shipped => 'On the Way',
            self::Cancelled => 'Cancelled',
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return match ($this) {
            self::Pending => in_array($next, [self::Paid, self::Cancelled]),
            self::Paid => $next === self::Shipped,
            self::Shipped, self::Cancelled => false,
        };
    }
}

// Readonly classes — all properties are implicitly readonly
readonly class CreateUserDTO
{
    public function __construct(
        public string $email,
        public string $name,
        public ?int $age = null,
    ) {}
}

// First-class callable syntax + array functions
$names = array_map($users->getName(...), $userList);
$adults = array_filter($users, fn(User $u) => $u->age >= 18);

// Named arguments for clarity
$response = Http::timeout(seconds: 30)
    ->retry(times: 3, sleepMilliseconds: 100)
    ->post(url: $endpoint, data: $payload);

// Fibers — cooperative multitasking (foundation for async)
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('paused');
    echo "Resumed with: $value";
});

$result = $fiber->start();    // 'paused'
$fiber->resume('hello');      // "Resumed with: hello"
```

---

## Modern PHP Patterns

```php
<?php

declare(strict_types=1);

// Value objects — type-safe domain primitives
readonly class Email
{
    public function __construct(public string $value)
    {
        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException("Invalid email: {$value}");
        }
    }

    public function domain(): string
    {
        return explode('@', $this->value)[1];
    }
}

// Result pattern — no exceptions for expected failures
readonly class Result
{
    private function __construct(
        public readonly bool $ok,
        public readonly mixed $value = null,
        public readonly ?string $error = null,
    ) {}

    public static function success(mixed $value): self
    {
        return new self(ok: true, value: $value);
    }

    public static function failure(string $error): self
    {
        return new self(ok: false, error: $error);
    }
}

// Service class with constructor promotion
final class OrderService
{
    public function __construct(
        private readonly OrderRepository $orders,
        private readonly PaymentGateway $payments,
        private readonly LoggerInterface $logger,
    ) {}

    public function place(CreateOrderDTO $dto): Result
    {
        $order = Order::create($dto);

        $payment = $this->payments->charge($order->total(), $dto->paymentMethod);
        if (!$payment->ok) {
            $this->logger->warning('Payment failed', ['order' => $order->id, 'error' => $payment->error]);
            return Result::failure("Payment failed: {$payment->error}");
        }

        $this->orders->save($order);
        return Result::success($order);
    }
}

// Interface segregation
interface Readable
{
    public function find(string $id): ?Entity;
    public function findAll(Criteria $criteria): array;
}

interface Writable
{
    public function save(Entity $entity): void;
    public function delete(string $id): void;
}

interface Repository extends Readable, Writable {}
```

---

## Composer & Autoloading

```json
{
    "require": {
        "php": "^8.4",
        "laravel/framework": "^12.0"
    },
    "require-dev": {
        "phpstan/phpstan": "^2.0",
        "pestphp/pest": "^3.0",
        "laravel/pint": "^1.18"
    },
    "autoload": {
        "psr-4": { "App\\": "src/" }
    },
    "scripts": {
        "test": "pest --parallel",
        "analyse": "phpstan analyse --level=9",
        "format": "pint",
        "check": ["@analyse", "@test"]
    }
}
```

---

## Testing (Pest)

```php
<?php

// Pest — expressive testing for PHP
describe('OrderService', function () {
    beforeEach(function () {
        $this->orders = mock(OrderRepository::class);
        $this->payments = mock(PaymentGateway::class);
        $this->service = new OrderService($this->orders, $this->payments, new NullLogger());
    });

    it('places order when payment succeeds', function () {
        $this->payments->shouldReceive('charge')->andReturn(Result::success('tx-123'));
        $this->orders->shouldReceive('save')->once();

        $result = $this->service->place(CreateOrderDTO::fake());

        expect($result->ok)->toBeTrue();
        expect($result->value)->toBeInstanceOf(Order::class);
    });

    it('returns failure when payment fails', function () {
        $this->payments->shouldReceive('charge')->andReturn(Result::failure('declined'));

        $result = $this->service->place(CreateOrderDTO::fake());

        expect($result->ok)->toBeFalse();
        expect($result->error)->toContain('declined');
    });
});

// Architecture tests
arch('domain has no framework dependencies')
    ->expect('App\Domain')
    ->toUseNothing()
    ->ignoring('App\Domain\Contracts');

arch('controllers are final')
    ->expect('App\Http\Controllers')
    ->toBeFinal();
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| No `declare(strict_types=1)` | Silent type coercion bugs | Add to every file, enforce via PHPStan |
| `mixed` return types | No type safety, IDE can't help | Explicit return types, generics via PHPDoc |
| `@` error suppression | Hides bugs silently | Handle errors explicitly, use try/catch |
| Array as data structure | No type safety, no autocomplete | Use DTOs, readonly classes, collections |
| `extract()` / `compact()` | Magic variables, impossible to trace | Explicit variable passing |
| God classes (1000+ lines) | Untestable, violates SRP | Split into focused services |
| No static analysis | Bugs found in production | PHPStan level 8+ in CI |
| `eval()` / dynamic `$$var` | Security vulnerability, unreadable | Never use — find typed alternatives |

---

## Verification Checklist

Before considering PHP work done:
- [ ] `declare(strict_types=1)` in every file
- [ ] PHPStan passes at level 8+ with no baseline additions
- [ ] All tests pass: `composer test`
- [ ] Code formatted: `composer format` (Pint/PHP-CS-Fixer)
- [ ] No `mixed` types in public APIs — explicit types everywhere
- [ ] Enums used instead of string constants
- [ ] Readonly classes/properties for immutable data
- [ ] Value objects for domain primitives (Email, Money, UserId)
- [ ] No `@` suppression, no `eval()`, no `extract()`
- [ ] Composer dependencies pinned to minor version (`^x.y`)
