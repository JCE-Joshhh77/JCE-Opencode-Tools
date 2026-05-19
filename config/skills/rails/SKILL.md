---
name: rails
description: Ruby on Rails, ActiveRecord, Hotwire. Use when working on rails tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Ruby on Rails
# Loaded on-demand when working with Rails, ActiveRecord, ERB, Hotwire

## Auto-Detect

Trigger this skill when:
- Files: `Gemfile` with `rails`, `config/routes.rb`, `*.erb`, `*.rb` in `app/`
- Directories: `app/models/`, `app/controllers/`, `db/migrate/`
- Task mentions: Rails, ActiveRecord, Hotwire, Turbo, Stimulus, Kamal, Solid Queue

---

## Decision Tree: Architecture Pattern

```
What are you building?
├── Simple CRUD (< 5 models)?
│   └── Resourceful controllers + concerns (Rails default)
├── Complex domain logic?
│   ├── Service objects (app/services/) for orchestration
│   ├── Form objects (app/forms/) for multi-model forms
│   └── Query objects (app/queries/) for complex SQL
├── Background processing?
│   ├── Solid Queue (Rails 8 default, database-backed)
│   ├── Sidekiq (Redis-backed, high throughput)
│   └── GoodJob (Postgres-backed, dashboard included)
├── Real-time features?
│   ├── Turbo Streams (server-push HTML fragments)
│   ├── ActionCable (WebSocket channels)
│   └── Hotwire Native (mobile apps)
├── Caching strategy?
│   ├── Solid Cache (Rails 8, database-backed cache)
│   ├── Redis (traditional, fast)
│   └── Fragment caching (Russian doll)
└── Deployment?
    └── Kamal 2 (Docker-based, zero-downtime, built into Rails 8)
```

## Decision Tree: Frontend Approach

```
Need interactivity?
├── Page navigation without full reload? → Turbo Drive (automatic)
├── Partial page updates? → Turbo Frames (scoped replacement)
├── Real-time server push? → Turbo Streams (append/replace/remove)
├── Client-side behavior? → Stimulus controllers
├── Complex client state? → Stimulus + morphing (Turbo 8)
├── Mobile app? → Hotwire Native (iOS/Android)
└── Full SPA needed? → Rails API mode + React/Vue (rare)
```

---

## Rails 8 — Solid Queue, Solid Cache, Kamal 2

```ruby
# config/queue.yml — Solid Queue (database-backed, no Redis needed)
production:
  dispatchers:
    - polling_interval: 1
      batch_size: 500
  workers:
    - queues: "*"
      threads: 5
      processes: 2
      polling_interval: 0.1

# Job with Solid Queue
class ProcessOrderJob < ApplicationJob
  queue_as :default
  retry_on Net::OpenTimeout, wait: :polynomially_longer, attempts: 5
  discard_on ActiveJob::DeserializationError

  def perform(order)
    OrderProcessor.new(order).call
    order.update!(processed_at: Time.current)
  end
end

# Solid Cache — database-backed cache (no Redis for caching)
# config/cache.yml
production:
  database: cache  # Separate database for cache
  store_options:
    max_age: 1.week
    max_size: 256.megabytes
    namespace: "app"

# Kamal 2 deployment (config/deploy.yml)
service: myapp
image: myapp
servers:
  web:
    hosts:
      - 192.168.1.1
    options:
      memory: 512m
  job:
    hosts:
      - 192.168.1.2
    cmd: bin/jobs

proxy:
  ssl: true
  host: myapp.com
  app_port: 3000

registry:
  server: ghcr.io
  username: deploy
  password:
    - KAMAL_REGISTRY_PASSWORD

env:
  secret:
    - RAILS_MASTER_KEY
    - DATABASE_URL
```

---

## Hotwire / Turbo 8 — Morphing & Streams

```erb
<%# Turbo Frame — scoped partial page updates %>
<%= turbo_frame_tag dom_id(@post) do %>
  <article class="post">
    <h2><%= @post.title %></h2>
    <p><%= @post.body %></p>
    <%= link_to "Edit", edit_post_path(@post) %>
  </article>
<% end %>

<%# Turbo 8 — Page refresh with morphing (no manual Turbo Streams needed) %>
<%# In layout: %>
<%= turbo_refreshes_with method: :morph, scroll: :preserve %>
```

```ruby
# Controller with Turbo Stream responses
class CommentsController < ApplicationController
  def create
    @comment = @post.comments.build(comment_params)
    @comment.user = current_user

    if @comment.save
      respond_to do |format|
        format.turbo_stream  # renders create.turbo_stream.erb
        format.html { redirect_to @post }
      end
    else
      render :new, status: :unprocessable_entity
    end
  end
end

# app/views/comments/create.turbo_stream.erb
<%= turbo_stream.prepend "comments", @comment %>
<%= turbo_stream.update "comment_count", @post.comments.count %>
<%= turbo_stream.replace "comment_form", partial: "comments/form", locals: { comment: Comment.new } %>

# Broadcasting from model (real-time to all viewers)
class Comment < ApplicationRecord
  after_create_commit -> { broadcast_prepend_to post, :comments }
  after_destroy_commit -> { broadcast_remove_to post, :comments }
end
```

---

## Stimulus Controllers

```javascript
// app/javascript/controllers/search_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "results"]
  static values = { url: String, debounce: { type: Number, default: 300 } }

  connect() { this.timeout = null }

  search() {
    clearTimeout(this.timeout)
    this.timeout = setTimeout(() => this.#fetchResults(), this.debounceValue)
  }

  async #fetchResults() {
    const query = this.inputTarget.value.trim()
    if (query.length < 2) { this.resultsTarget.innerHTML = ""; return }

    const response = await fetch(`${this.urlValue}?q=${encodeURIComponent(query)}`, {
      headers: { "Accept": "text/vnd.turbo-stream.html" }
    })
    if (response.ok) {
      this.resultsTarget.innerHTML = await response.text()
    }
  }

  disconnect() { clearTimeout(this.timeout) }
}
```

---

## ActiveRecord — Modern Patterns

```ruby
class Post < ApplicationRecord
  belongs_to :author, class_name: "User"
  has_many :comments, dependent: :destroy
  has_many :commenters, through: :comments, source: :user
  has_and_belongs_to_many :tags

  # Enums with Rails 8 syntax
  enum :status, { draft: 0, published: 1, archived: 2 }, validate: true

  # Scopes — composable, chainable
  scope :published, -> { where(status: :published).where("published_at <= ?", Time.current) }
  scope :recent, -> { order(published_at: :desc) }
  scope :trending, -> { published.where("published_at > ?", 7.days.ago).order(views_count: :desc) }
  scope :by_author, ->(user) { where(author: user) if user.present? }

  # Validations
  validates :title, presence: true, length: { maximum: 255 }
  validates :slug, uniqueness: true
  validates :body, presence: true, length: { minimum: 50 }, on: :publish

  # Normalizations (Rails 7.1+)
  normalizes :email, with: ->(email) { email.strip.downcase }
  normalizes :title, with: ->(title) { title.strip }

  # Callbacks — only for data integrity, never business logic
  before_validation :generate_slug, on: :create

  # Strict loading to catch N+1 in development
  self.strict_loading_by_default = true if Rails.env.development?

  private

  def generate_slug
    self.slug = title&.parameterize
  end
end

# Query optimization
posts = Post.includes(:author, :tags)
            .published
            .recent
            .page(params[:page])
            .per(20)

# Batch processing — never load unbounded
Post.where("created_at < ?", 1.year.ago).find_each(batch_size: 1000) do |post|
  post.archive!
end

# insert_all for bulk operations (skips callbacks/validations)
Post.insert_all([
  { title: "Post 1", user_id: 1, created_at: Time.current },
  { title: "Post 2", user_id: 1, created_at: Time.current },
], unique_by: :slug)
```

---

## Service Objects & Actions

```ruby
# app/services/posts/publish_service.rb
module Posts
  class PublishService
    def initialize(post, publisher:)
      @post = post
      @publisher = publisher
    end

    def call
      return failure(:unauthorized) unless @publisher.can?(:publish, @post)
      return failure(:invalid) unless @post.valid?(:publish)

      ActiveRecord::Base.transaction do
        @post.update!(status: :published, published_at: Time.current)
        @post.notify_subscribers
        ProcessPostJob.perform_later(@post)
      end

      success(@post)
    rescue ActiveRecord::RecordInvalid => e
      failure(:validation_error, e.message)
    end

    private

    def success(data) = Result.new(success: true, data: data)
    def failure(code, message = nil) = Result.new(success: false, error: { code:, message: })

    Result = Data.define(:success, :data, :error) do
      def success? = success
      def failure? = !success
    end
  end
end

# Usage in controller
class PostsController < ApplicationController
  def publish
    result = Posts::PublishService.new(@post, publisher: current_user).call

    if result.success?
      redirect_to @post, notice: "Published!"
    else
      redirect_to @post, alert: result.error[:message]
    end
  end
end
```

---

## Testing — RSpec & Minitest

```ruby
# RSpec feature test with system specs
RSpec.describe "Publishing a post", type: :system do
  let(:user) { create(:user) }
  let(:post) { create(:post, :draft, author: user) }

  before { sign_in user }

  it "publishes and shows confirmation" do
    visit post_path(post)
    click_button "Publish"

    expect(page).to have_content("Published!")
    expect(post.reload).to be_published
  end
end

# Request spec (API testing)
RSpec.describe "Posts API", type: :request do
  let(:user) { create(:user) }
  let(:headers) { auth_headers(user) }

  describe "POST /api/v1/posts" do
    let(:valid_params) { { post: attributes_for(:post, category_id: create(:category).id) } }

    it "creates a post" do
      expect {
        post "/api/v1/posts", params: valid_params, headers:, as: :json
      }.to change(Post, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(json_response.dig("data", "title")).to eq(valid_params[:post][:title])
    end
  end
end

# Factory with traits
FactoryBot.define do
  factory :post do
    association :author, factory: :user
    title { Faker::Lorem.sentence }
    body { Faker::Lorem.paragraph(sentence_count: 10) }
    status { :draft }

    trait(:published) do
      status { :published }
      published_at { 1.hour.ago }
    end

    trait(:with_comments) do
      transient { comments_count { 3 } }
      after(:create) { |post, ctx| create_list(:comment, ctx.comments_count, post:) }
    end
  end
end
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| N+1 queries | 100 posts = 101 queries | `includes` / `preload`; use `bullet` gem |
| Fat controllers | 200+ line actions | Service objects, form objects |
| Callbacks for business logic | Hidden side effects, hard to test | Service objects; callbacks for data integrity only |
| String interpolation in SQL | SQL injection | `where("col = ?", val)` parameterized |
| No background jobs | Request timeouts | ActiveJob + Solid Queue for anything > 100ms |
| Missing DB indexes | Slow queries at scale | Index all FKs, search columns, unique constraints |
| `Model.all` in views | Memory explosion | Always paginate, use `find_each` for batch |
| Mocking everything in tests | Tests pass but code is broken | Integration tests with real DB |
| No strict loading in dev | N+1 slips to production | `strict_loading_by_default = true` |
| Deploying with Capistrano | Complex, fragile | Kamal 2 (Docker, zero-downtime) |

---

## Verification Checklist

Before considering Rails work done:
- [ ] `bin/rails test` or `bundle exec rspec` passes
- [ ] No N+1 queries (check with `bullet` gem or strict_loading)
- [ ] Database migrations have both `up` and `down` (reversible)
- [ ] All user input validated in models or form objects
- [ ] Authorization checked (Pundit policies or similar)
- [ ] Background jobs for operations > 100ms
- [ ] Fragment caching for expensive view partials
- [ ] `bin/rails routes` shows no unintended public routes
- [ ] System tests cover critical user journeys
- [ ] `bundle audit` shows no known vulnerabilities
