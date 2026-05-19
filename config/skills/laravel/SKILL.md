---
name: laravel
description: Laravel, Eloquent, Blade, Artisan. Use when working on laravel tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Laravel
# Loaded on-demand when working with Laravel, Eloquent, Blade, Artisan

## Auto-Detect

Trigger this skill when:
- Files: `artisan`, `composer.json` with `laravel/framework`, `*.blade.php`
- Directories: `app/Http/`, `app/Models/`, `routes/`, `database/migrations/`
- Task mentions: Laravel, Eloquent, Blade, Livewire, Volt, Pennant, Reverb

---

## Decision Tree: Architecture Pattern

```
What are you building?
├── Simple CRUD (< 5 models)?
│   └── Controller + FormRequest + Resource (no service layer needed)
├── Complex domain logic?
│   ├── Action classes (single-purpose, invokable)
│   └── Service classes (orchestrate multiple actions)
├── Real-time features?
│   ├── Broadcasting? → Laravel Reverb (WebSocket server)
│   └── Live UI updates? → Livewire 3 / Volt components
├── Feature flags / gradual rollout?
│   └── Laravel Pennant (database or array driver)
├── Background processing?
│   ├── Simple jobs → Queue with database/Redis driver
│   ├── Complex workflows → Laravel Workflow or job chains
│   └── Scheduled tasks → schedule() in routes/console.php
└── API only (no views)?
    └── API Resources + Sanctum/Passport + versioned routes
```

## Decision Tree: Frontend Approach

```
Need interactive UI?
├── Full SPA (React/Vue)? → Laravel as API + Sanctum
├── Server-rendered with sprinkles? → Blade + Alpine.js + Livewire
├── Single-file reactive components? → Volt (Livewire single-file)
├── Inertia.js? → Server routing + React/Vue/Svelte views
└── Static pages with forms? → Blade + Turbo (Laravel Precognition)
```

---

## Laravel 12 & Modern Patterns

```php
// bootstrap/app.php — slim skeleton (no Http/Kernel.php)
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->api(prepend: [EnsureFrontendRequestsAreStateful::class]);
        $middleware->throttleApi('api', perSecond: 10);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(fn (NotFoundHttpException $e, Request $request) =>
            $request->expectsJson() ? response()->json(['message' => 'Not found'], 404) : null
        );
    })
    ->create();
```

---

## Eloquent ORM — Modern Patterns

```php
// Model with casts, scopes, and relationships (Laravel 12)
class Post extends Model
{
    protected function casts(): array
    {
        return [
            'published_at' => 'immutable_datetime',
            'metadata' => AsCollection::class,
            'status' => PostStatus::class, // Backed enum cast
        ];
    }

    // Eager load by default — prevent N+1 at model level
    protected $with = ['author'];

    public function author(): BelongsTo { return $this->belongsTo(User::class); }
    public function comments(): HasMany { return $this->hasMany(Comment::class); }
    public function tags(): BelongsToMany { return $this->belongsToMany(Tag::class); }

    // Scopes
    public function scopePublished(Builder $query): Builder
    {
        return $query->whereNotNull('published_at')->where('published_at', '<=', now());
    }

    public function scopeByAuthor(Builder $query, User $user): Builder
    {
        return $query->where('user_id', $user->id);
    }
}

// Eager loading — ALWAYS use with() for relationships in loops
$posts = Post::with(['comments.user', 'tags'])
    ->published()
    ->cursorPaginate(20); // cursor pagination for infinite scroll

// Batch processing — never ->get() unbounded
Post::where('created_at', '<', now()->subYear())
    ->chunkById(1000, fn (Collection $posts) => $posts->each->archive());
```

---

## Livewire 3 & Volt Components

```php
// Volt single-file component (resources/views/livewire/counter.blade.php)
<?php
use function Livewire\Volt\{state, computed};

state(['count' => 0]);

$increment = fn () => $this->count++;

$doubled = computed(fn () => $this->count * 2);
?>

<div>
    <span>{{ $this->doubled }}</span>
    <button wire:click="increment">+</button>
</div>

// Full Livewire 3 component with validation and real-time
#[Validate(['title' => 'required|max:255', 'body' => 'required|min:50'])]
class CreatePost extends Component
{
    public string $title = '';
    public string $body = '';

    public function save(): void
    {
        $validated = $this->validate();
        $post = auth()->user()->posts()->create($validated);
        $this->dispatch('post-created', id: $post->id);
        $this->redirect(route('posts.show', $post));
    }

    public function render(): View
    {
        return view('livewire.create-post');
    }
}
```

---

## Laravel Pennant — Feature Flags

```php
// Define features in AppServiceProvider
Feature::define('new-dashboard', function (User $user) {
    return match (true) {
        $user->isAdmin() => true,
        $user->isBetaTester() => true,
        default => Lottery::odds(1, 10), // 10% rollout
    };
});

// Usage in controllers/views
if (Feature::active('new-dashboard')) {
    return view('dashboard.new');
}

// Blade directive
@feature('new-dashboard')
    <x-new-dashboard />
@else
    <x-legacy-dashboard />
@endfeature

// Middleware-based gating
Route::middleware('feature:new-dashboard')->group(function () {
    Route::get('/dashboard', NewDashboardController::class);
});

// Programmatic activation for testing
Feature::for($user)->activate('new-dashboard');
Feature::purge('new-dashboard'); // Reset all stored values
```

---

## Laravel Reverb — WebSockets

```php
// Broadcasting event (real-time via Reverb)
class OrderStatusUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Order $order) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel("orders.{$this->order->user_id}")];
    }

    public function broadcastWith(): array
    {
        return ['status' => $this->order->status->value, 'updated_at' => now()->toIso8601String()];
    }
}

// Client-side (Echo + Reverb)
Echo.private(`orders.${userId}`)
    .listen('OrderStatusUpdated', (e) => {
        updateOrderStatus(e.status);
    });

// config/broadcasting.php — Reverb driver (built-in, no Pusher needed)
'reverb' => [
    'driver' => 'reverb',
    'app_id' => env('REVERB_APP_ID'),
    'options' => ['host' => env('REVERB_HOST', '0.0.0.0'), 'port' => env('REVERB_PORT', 8080)],
],
```

---

## API Resources & Validation

```php
// Form Request — validation + authorization
class StorePostRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Post::class);
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'body' => ['required', 'string', 'min:50'],
            'category_id' => ['required', 'exists:categories,id'],
            'tags' => ['array', 'max:10'],
            'tags.*' => ['exists:tags,id'],
            'publish_at' => ['nullable', 'date', 'after:now'],
        ];
    }
}

// API Resource with conditional fields
class PostResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'excerpt' => str($this->body)->limit(200),
            'author' => UserResource::make($this->whenLoaded('author')),
            'comments_count' => $this->whenCounted('comments'),
            'is_owner' => $this->when(
                $request->user(),
                fn () => $this->user_id === $request->user()->id
            ),
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }
}
```

---

## Testing — Pest & Feature Tests

```php
// Pest test (Laravel 12 default)
uses(RefreshDatabase::class);

it('creates a post with valid data', function () {
    $user = User::factory()->create();
    $category = Category::factory()->create();

    $response = $this->actingAs($user)
        ->postJson('/api/posts', [
            'title' => 'My Post',
            'body' => str_repeat('Content ', 20),
            'category_id' => $category->id,
        ]);

    $response->assertCreated()
        ->assertJsonPath('data.title', 'My Post');

    $this->assertDatabaseHas('posts', ['user_id' => $user->id, 'title' => 'My Post']);
});

it('rejects invalid post data', function () {
    $this->actingAs(User::factory()->create())
        ->postJson('/api/posts', ['title' => ''])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['title', 'body', 'category_id']);
});

// Factory with states
class PostFactory extends Factory
{
    public function published(): static
    {
        return $this->state(fn () => ['published_at' => now()->subHour()]);
    }

    public function draft(): static
    {
        return $this->state(fn () => ['published_at' => null]);
    }

    public function withComments(int $count = 3): static
    {
        return $this->has(Comment::factory()->count($count));
    }
}
```

---

## Caching & Performance

```php
// Tagged cache with automatic invalidation
$posts = Cache::tags(['posts', "user:{$userId}"])
    ->remember("user:{$userId}:published", 3600, fn () =>
        Post::where('user_id', $userId)->published()->get()
    );

// Invalidate on model events (Observer or event listener)
class PostObserver
{
    public function saved(Post $post): void
    {
        Cache::tags(['posts', "user:{$post->user_id}"])->flush();
    }
}

// Database query optimization
Post::query()
    ->select(['id', 'title', 'user_id', 'published_at']) // Only needed columns
    ->withCount('comments')
    ->withAvg('ratings', 'score')
    ->published()
    ->cursorPaginate(20);
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| N+1 queries | 100 posts = 101 queries | `with()` / `$with` / `load()` |
| `Model::all()->count()` | Loads all rows into memory | `Model::count()` |
| Fat controllers | 200+ line methods | FormRequests, Actions, Services |
| Facades in domain logic | Hidden deps, untestable | Constructor injection |
| Caching without invalidation | Stale data served forever | Tagged caches + model observers |
| No queue for slow operations | Request timeout, bad UX | `dispatch()` for email, API calls |
| Raw SQL without bindings | SQL injection | Parameterized queries always |
| `env()` outside config files | Breaks config caching | Use `config()` helper |
| Missing database indexes | Slow queries at scale | Index FKs + filter columns |
| Storing files locally | Breaks in multi-server | Use `Storage` facade with S3/R2 |

---

## Verification Checklist

Before considering Laravel work done:
- [ ] `php artisan test` passes (Pest/PHPUnit)
- [ ] No N+1 queries (use `barryvdh/laravel-debugbar` or `beyondcode/laravel-query-detector`)
- [ ] All user input validated via FormRequest
- [ ] Authorization via Policies (not inline checks)
- [ ] Sensitive operations queued (email, external APIs)
- [ ] Database migrations have rollback (`down()` method)
- [ ] API responses use Resources (not raw model `toArray()`)
- [ ] `php artisan route:list` shows no unintended public routes
- [ ] Environment config via `config()` not `env()` in app code
- [ ] Feature flags cleaned up after full rollout (Pennant)
