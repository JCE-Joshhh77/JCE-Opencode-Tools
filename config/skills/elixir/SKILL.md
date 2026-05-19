---
name: elixir
description: Elixir, Phoenix, LiveView, OTP. Use when working on elixir tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Elixir
# Loaded on-demand when working with .ex, .exs files, Phoenix, LiveView

## Auto-Detect

Trigger this skill when:
- File extensions: `.ex`, `.exs`, `mix.exs`, `.heex`
- Frameworks: Phoenix, LiveView, Ecto, Nerves
- Tools: Mix, Hex, IEx, Dialyzer
- Patterns: `defmodule`, `|>`, `GenServer`, `Supervisor`

---

## Decision Tree: Architecture

```
What are you building?
+-- Web application?
|   +-- Real-time UI? -> Phoenix LiveView (server-rendered, WebSocket)
|   +-- REST/GraphQL API? -> Phoenix controllers + Absinthe
|   +-- Full-stack with SPA? -> Phoenix API + separate frontend
+-- Background processing?
|   +-- Data pipeline (ETL)? -> Broadway (batching, backpressure)
|   +-- Scheduled jobs? -> Oban (persistent, retries)
|   +-- Stream processing? -> GenStage / Flow
+-- Distributed system?
|   +-- Pub/sub? -> Phoenix.PubSub (built-in clustering)
|   +-- Distributed state? -> Horde / :global / CRDTs
|   +-- Service mesh? -> libcluster + Node.connect
+-- ML/Numerical?
|   +-- Nx + Axon (Elixir-native ML)
+-- IoT/Embedded?
    +-- Nerves (Linux on embedded devices)
```

## Decision Tree: State Management

```
Where to keep state?
+-- Request-scoped? -> Conn/Socket assigns
+-- Per-user session? -> LiveView socket assigns
+-- Shared mutable state? -> GenServer / Agent / ETS
+-- Persistent? -> Ecto + PostgreSQL
+-- Distributed cache? -> :ets + pg (process groups) or Cachex
+-- Ephemeral, high-read? -> ETS (in-memory, concurrent reads)
```

---

## Elixir 1.17 Patterns

```elixir
# Type system improvements (Elixir 1.17+) — gradual set-theoretic types
# Compiler now warns on type mismatches without Dialyzer

defmodule MyApp.Accounts do
  @type user_params :: %{
    email: String.t(),
    name: String.t(),
    age: non_neg_integer() | nil
  }

  @spec create_user(user_params()) :: {:ok, User.t()} | {:error, Ecto.Changeset.t()}
  def create_user(params) do
    %User{}
    |> User.changeset(params)
    |> Repo.insert()
  end
end

# Duration sigil (Elixir 1.17)
timeout = ~D[30s]
cache_ttl = ~D[5m]
token_expiry = ~D[7d]

# dbg/1 — debug pipe chains without breaking flow
result =
  raw_input
  |> String.trim()
  |> dbg()  # prints value + location, returns value unchanged
  |> String.downcase()
  |> String.split(",")
  |> Enum.map(&String.trim/1)
  |> Enum.reject(&(&1 == ""))

# Multi-clause functions with guards
defmodule Pricing do
  def discount(price, :vip) when price > 100, do: price * 0.8
  def discount(price, :member) when price > 50, do: price * 0.9
  def discount(price, _tier), do: price
end
```

---

## Phoenix 1.8 & LiveView 1.0

```elixir
# LiveView 1.0 — streams for efficient list rendering
defmodule MyAppWeb.ProductLive.Index do
  use MyAppWeb, :live_view

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(:page_title, "Products")
     |> stream(:products, Catalog.list_products())}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    product = Catalog.get_product!(id)
    {:ok, _} = Catalog.delete_product(product)
    {:noreply, stream_delete(socket, :products, product)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.header>Products</.header>

    <.table id="products" rows={@streams.products} row_click={fn {_id, product} ->
      JS.navigate(~p"/products/#{product}")
    end}>
      <:col :let={{_id, product}} label="Name"><%= product.name %></:col>
      <:col :let={{_id, product}} label="Price"><%= product.price %></:col>
      <:action :let={{id, product}}>
        <.link phx-click={JS.push("delete", value: %{id: product.id})}
               data-confirm="Are you sure?">
          Delete
        </.link>
      </:action>
    </.table>
    """
  end
end

# LiveView async operations — non-blocking data loading
defmodule MyAppWeb.DashboardLive do
  use MyAppWeb, :live_view

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(:page_title, "Dashboard")
     |> assign_async(:stats, fn -> {:ok, %{stats: Analytics.compute_stats()}} end)
     |> assign_async(:recent_orders, fn -> {:ok, %{recent_orders: Orders.recent()}} end)}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <.async_result :let={stats} assign={@stats}>
      <:loading>Loading stats...</:loading>
      <:failed :let={_reason}>Failed to load stats</:failed>
      <.stats_grid stats={stats} />
    </.async_result>
    """
  end
end

# Phoenix Verified Routes — compile-time checked paths
~p"/users/#{user}"           # Raises at compile time if route doesn't exist
~p"/users/#{user}/edit"
url(~p"/api/webhooks")       # Full URL with host
```

---

## GenServer Patterns

```elixir
# GenServer with proper timeout and state management
defmodule MyApp.RateLimiter do
  use GenServer

  @max_requests 100
  @window_ms :timer.minutes(1)

  # Client API
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, %{}, name: name)
  end

  def check(key, server \\ __MODULE__) do
    GenServer.call(server, {:check, key})
  end

  # Server callbacks
  @impl true
  def init(_opts) do
    schedule_cleanup()
    {:ok, %{}}
  end

  @impl true
  def handle_call({:check, key}, _from, state) do
    now = System.monotonic_time(:millisecond)
    requests = Map.get(state, key, [])
    recent = Enum.filter(requests, &(&1 > now - @window_ms))

    if length(recent) >= @max_requests do
      {:reply, {:error, :rate_limited}, state}
    else
      {:reply, :ok, Map.put(state, key, [now | recent])}
    end
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.monotonic_time(:millisecond)
    cleaned = state
      |> Enum.map(fn {k, v} -> {k, Enum.filter(v, &(&1 > now - @window_ms))} end)
      |> Enum.reject(fn {_k, v} -> v == [] end)
      |> Map.new()
    schedule_cleanup()
    {:noreply, cleaned}
  end

  defp schedule_cleanup, do: Process.send_after(self(), :cleanup, @window_ms)
end
```

---

## Broadway (Data Pipelines)

```elixir
defmodule MyApp.OrderPipeline do
  use Broadway

  def start_link(_opts) do
    Broadway.start_link(__MODULE__,
      name: __MODULE__,
      producer: [
        module: {BroadwaySQS.Producer, queue_url: System.get_env("SQS_QUEUE_URL")},
        concurrency: 2
      ],
      processors: [
        default: [concurrency: 10, max_demand: 5]
      ],
      batchers: [
        default: [batch_size: 50, batch_timeout: 1_000, concurrency: 3]
      ]
    )
  end

  @impl true
  def handle_message(_processor, message, _context) do
    order = message.data |> Jason.decode!() |> Order.from_map()

    case Orders.validate(order) do
      :ok -> message
      {:error, reason} -> Message.failed(message, reason)
    end
  end

  @impl true
  def handle_batch(_batcher, messages, _batch_info, _context) do
    orders = Enum.map(messages, & &1.data)
    Orders.bulk_insert(orders)
    messages
  end

  @impl true
  def handle_failed(messages, _context) do
    # Dead-letter queue or alerting
    Enum.each(messages, fn msg ->
      Logger.error("Failed to process: #{inspect(msg.data)}, reason: #{inspect(msg.status)}")
    end)
    messages
  end
end
```

---

## Nx (Numerical/ML)

```elixir
# Nx — numerical computing in Elixir
defmodule MyApp.Recommender do
  import Nx.Defn

  # JIT-compiled numerical function (runs on CPU/GPU)
  defn cosine_similarity(a, b) do
    dot = Nx.dot(a, b)
    norm_a = Nx.LinAlg.norm(a)
    norm_b = Nx.LinAlg.norm(b)
    dot / (norm_a * norm_b)
  end

  def recommend(user_embedding, item_embeddings) do
    item_embeddings
    |> Enum.map(fn {id, embedding} ->
      score = cosine_similarity(user_embedding, embedding) |> Nx.to_number()
      {id, score}
    end)
    |> Enum.sort_by(&elem(&1, 1), :desc)
    |> Enum.take(10)
  end
end
```

---

## Testing (ExUnit)

```elixir
defmodule MyApp.AccountsTest do
  use MyApp.DataCase, async: true

  alias MyApp.Accounts
  import MyApp.AccountsFixtures

  describe "create_user/1" do
    test "with valid attrs creates user" do
      attrs = %{name: "Alice", email: "alice@example.com"}
      assert {:ok, user} = Accounts.create_user(attrs)
      assert user.name == "Alice"
      assert user.email == "alice@example.com"
    end

    test "with duplicate email returns error" do
      user = user_fixture(email: "taken@example.com")
      assert {:error, changeset} = Accounts.create_user(%{name: "Bob", email: user.email})
      assert %{email: ["has already been taken"]} = errors_on(changeset)
    end
  end
end

# LiveView testing
defmodule MyAppWeb.ProductLiveTest do
  use MyAppWeb.ConnCase, async: true
  import Phoenix.LiveViewTest

  test "lists products", %{conn: conn} do
    product = product_fixture(name: "Widget")
    {:ok, view, html} = live(conn, ~p"/products")
    assert html =~ "Widget"
  end

  test "deletes product", %{conn: conn} do
    product = product_fixture()
    {:ok, view, _html} = live(conn, ~p"/products")
    assert view |> element("[data-confirm]") |> render_click() =~ "deleted"
    refute has_element?(view, "#products-#{product.id}")
  end
end

# Mox for behaviour-based mocking
Mox.defmock(MyApp.HTTPClientMock, for: MyApp.HTTPClient)

test "fetches external data" do
  expect(MyApp.HTTPClientMock, :get, fn "/api/data" ->
    {:ok, %{status: 200, body: ~s({"result": 42})}}
  end)

  assert {:ok, 42} = MyApp.ExternalService.fetch_data()
end
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Calling `Repo` from controllers | Tight coupling, untestable | Use contexts (bounded modules) |
| Nested `case` statements | Hard to read, deep indentation | Use `with` for multi-step operations |
| GenServer for everything | Over-engineering, bottleneck | ETS for reads, Agent for simple state |
| No supervision tree | Crashes kill the app | Supervisor with proper restart strategy |
| Synchronous GenServer calls for fire-and-forget | Unnecessary blocking | Use `cast` or `Task.async` |
| Large LiveView modules | Hard to maintain | Extract components, use `live_component` |
| No `@impl true` on callbacks | Silent bugs when callback name changes | Always annotate implementations |
| Blocking in GenServer callbacks | Blocks all callers | Offload to Task, reply later |

---

## Verification Checklist

Before considering Elixir work done:
- [ ] `mix compile --warnings-as-errors` passes
- [ ] `mix test` passes (with `async: true` where possible)
- [ ] `mix format` applied (no formatting diffs)
- [ ] `mix credo --strict` passes
- [ ] `mix dialyzer` passes (type specs correct)
- [ ] Supervision tree properly configured (restart strategies)
- [ ] Contexts used as boundaries (no `Repo` in controllers)
- [ ] LiveView streams used for lists (not assigns)
- [ ] `@impl true` on all callback implementations
- [ ] `with` used instead of nested `case` for multi-step ops
