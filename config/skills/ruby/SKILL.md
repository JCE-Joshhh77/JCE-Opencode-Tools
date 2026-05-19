---
name: ruby
description: Ruby ecosystem, gems, Bundler. Use when working on ruby tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Ruby
# Loaded on-demand when working with .rb, .rake, Gemfile files

## Auto-Detect

Trigger this skill when:
- File extensions: `.rb`, `.rake`, `.gemspec`, `Gemfile`, `Rakefile`
- Frameworks: Rails, Sinatra, Hanami, Roda
- Tools: Bundler, RSpec, Minitest, RuboCop, Sorbet/Steep

---

## Decision Tree: Ruby Project Type

```
What are you building?
├── Web application?
│   ├── Full-stack with conventions? → Rails
│   ├── Lightweight API? → Sinatra / Roda
│   └── Clean architecture? → Hanami
├── Background jobs?
│   └── Sidekiq / GoodJob / Solid Queue
├── CLI tool?
│   └── Thor / dry-cli / GLI
├── Gem/library?
│   └── bundle gem + RSpec + standard
└── Script/automation?
    └── Plain Ruby + Bundler inline
```

## Decision Tree: Concurrency

```
Need concurrency?
├── I/O-bound (HTTP, DB)? → Ractors (isolated) or Fibers (cooperative)
├── CPU-bound parallelism? → Ractors (true parallelism, no GVL)
├── Background processing? → Sidekiq (threads) / GoodJob (Postgres-backed)
├── Async I/O? → Async gem (fiber scheduler)
└── Simple parallelism? → Parallel gem / Process.fork
```

---

## Ruby 3.4 Patterns

```ruby
# frozen_string_literal: true

# Pattern matching — powerful destructuring (Ruby 3.0+)
case response
in { status: 200, body: { data: [first, *rest] } }
  process(first, rest)
in { status: 404 }
  raise NotFoundError
in { status: (500..) => code, body: { error: String => msg } }
  raise ServerError.new(code:, message: msg)
end

# Find pattern — match element in array
case users
in [*, { role: :admin, name: String => admin_name }, *]
  puts "Found admin: #{admin_name}"
end

# Pin operator — match against existing variable
expected_status = 200
case response
in { status: ^expected_status }
  puts "Success"
end

# `it` block parameter (Ruby 3.4) — implicit block param
users.map { it.name }           # same as { |u| u.name }
numbers.select { it > 5 }      # same as { |n| n > 5 }
names.sort_by { it.length }

# Data class (Ruby 3.2+) — immutable value objects
Point = Data.define(:x, :y)
point = Point.new(x: 3, y: 4)
point.x          # => 3
moved = point.with(x: 10)  # => Point(x: 10, y: 4)

# Data with custom methods
Measurement = Data.define(:value, :unit) do
  def to_s = "#{value} #{unit}"
  def <=>(other)
    return nil unless unit == other.unit
    value <=> other.value
  end
end

# Ractors — true parallelism without GVL
ractor = Ractor.new do
  # Runs in isolated memory space
  loop do
    msg = Ractor.receive
    result = expensive_computation(msg)
    Ractor.yield(result)
  end
end

# Send work, receive results
ractor.send(data)
result = ractor.take

# Parallel processing with Ractor pool
workers = 4.times.map do
  Ractor.new do
    loop do
      item = Ractor.receive
      Ractor.yield(process(item))
    end
  end
end

# Fiber scheduler — async I/O
require "async"

Async do |task|
  # These run concurrently on fibers
  response1 = task.async { HTTP.get("https://api.example.com/users") }
  response2 = task.async { HTTP.get("https://api.example.com/orders") }
  [response1.wait, response2.wait]
end
```

---

## Type Annotations (RBS + Steep)

```ruby
# sig/user_service.rbs — type signature file
class UserService
  def initialize: (UserRepository repo, Logger logger) -> void
  def find: (String id) -> User?
  def create: (CreateUserParams params) -> Result[User, ValidationError]
end

interface _Repository[Entity, ID]
  def find: (ID id) -> Entity?
  def save: (Entity entity) -> Entity
  def delete: (ID id) -> void
end

type Result[T, E] = Success[T] | Failure[E]

class Success[T]
  attr_reader value: T
  def initialize: (T value) -> void
end

class Failure[E]
  attr_reader error: E
  def initialize: (E error) -> void
end
```

```yaml
# Steepfile — type checker configuration
target :app do
  signature "sig"
  check "app", "lib"
  library "set", "pathname"
end
```

---

## Modern Ruby Patterns

```ruby
# frozen_string_literal: true

# Service object with Result pattern
class CreateUser
  def initialize(repo:, mailer:)
    @repo = repo
    @mailer = mailer
  end

  def call(params)
    user = User.new(**params)
    return Failure.new(user.errors) unless user.valid?

    @repo.save(user)
    @mailer.send_welcome(user)
    Success.new(user)
  rescue ActiveRecord::RecordNotUnique
    Failure.new(email: ["already taken"])
  end
end

# Enumerable + lazy for large datasets
File.open("large.csv")
    .each_line
    .lazy
    .map { it.chomp.split(",") }
    .select { it[2].to_i > 18 }
    .first(100)

# Method composition
process = method(:validate) >> method(:transform) >> method(:persist)
result = process.call(input)

# Refinements — scoped monkey patching (safe)
module StringExtensions
  refine String do
    def to_slug
      downcase.gsub(/[^a-z0-9]+/, "-").chomp("-")
    end
  end
end

using StringExtensions
"Hello World!".to_slug  # => "hello-world"
```

---

## Testing (RSpec)

```ruby
# spec/services/create_user_spec.rb
RSpec.describe CreateUser do
  subject(:service) { described_class.new(repo:, mailer:) }

  let(:repo) { instance_double(UserRepository) }
  let(:mailer) { instance_double(UserMailer) }

  describe "#call" do
    context "with valid params" do
      let(:params) { { email: "alice@example.com", name: "Alice" } }

      before do
        allow(repo).to receive(:save).and_return(User.new(**params, id: "1"))
        allow(mailer).to receive(:send_welcome)
      end

      it "returns Success with user" do
        result = service.call(params)
        expect(result).to be_a(Success)
        expect(result.value.email).to eq("alice@example.com")
      end

      it "sends welcome email" do
        service.call(params)
        expect(mailer).to have_received(:send_welcome).once
      end
    end

    context "with invalid email" do
      it "returns Failure with errors" do
        result = service.call(email: "bad", name: "Alice")
        expect(result).to be_a(Failure)
        expect(result.error).to include(:email)
      end
    end
  end
end

# Shared examples for interface compliance
RSpec.shared_examples "a repository" do
  it { is_expected.to respond_to(:find).with(1).argument }
  it { is_expected.to respond_to(:save).with(1).argument }
  it { is_expected.to respond_to(:delete).with(1).argument }
end
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Monkey patching in production | Invisible side effects, breaks gems | Use Refinements for scoped extensions |
| `method_missing` without `respond_to_missing?` | Breaks introspection, debugging hell | Always implement both together |
| Mutable global state | Thread-safety issues, test pollution | Dependency injection, frozen objects |
| No frozen_string_literal | Unnecessary object allocations | Add magic comment to every file |
| Stringly-typed code | No type safety, typo bugs | Use Symbols, Enums, Data classes |
| God objects (1000+ line classes) | Untestable, violates SRP | Extract service objects, use composition |
| `rescue Exception` | Catches `SystemExit`, `Interrupt` | Rescue `StandardError` or specific classes |
| No type checking | Bugs found at runtime | RBS + Steep or Sorbet in CI |

---

## Verification Checklist

Before considering Ruby work done:
- [ ] `bundle exec rspec` passes (or `rails test`)
- [ ] RuboCop passes: `bundle exec rubocop`
- [ ] `# frozen_string_literal: true` in every file
- [ ] Type signatures exist for public APIs (RBS or Sorbet)
- [ ] Steep/Sorbet type check passes (if configured)
- [ ] Pattern matching used for complex conditionals
- [ ] Data classes used for value objects (not Struct)
- [ ] No `rescue Exception` — only `StandardError` or specific
- [ ] Service objects are testable with dependency injection
- [ ] Ractors/Fibers used appropriately for concurrency needs
