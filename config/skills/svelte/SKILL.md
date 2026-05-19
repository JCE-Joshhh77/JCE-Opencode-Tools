---
name: svelte
description: Svelte 5, SvelteKit, runes. Use when working on svelte tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Svelte
# Loaded on-demand when working with .svelte files, SvelteKit

## Auto-Detect

Trigger this skill when:
- File extensions: `.svelte`, `.svelte.ts`, `.svelte.js`
- `package.json` contains: `svelte`, `@sveltejs/kit`, `@sveltejs/vite-plugin-svelte`
- Imports from: `svelte`, `svelte/store`, `$app/`
- Directory patterns: `src/routes/`, `src/lib/`, `+page.svelte`

---

## Decision Tree: Reactivity

```
What kind of reactive data?
├── Component-local mutable state? → $state()
├── Large immutable dataset (replace, not mutate)? → $state.raw()
├── Derived/computed from other state? → $derived() or $derived.by()
├── Side effect when state changes? → $effect()
├── Need to run before DOM update? → $effect.pre()
├── Shared state across components? → .svelte.ts module with $state
├── Need store contract (subscribe)? → writable/readable (Svelte 4 compat)
└── Prop that parent can bind to? → $bindable()
```

## Decision Tree: Data Loading

```
Where does data come from?
├── Server-only (DB, secrets, auth)? → +page.server.ts load function
├── Runs on both server and client? → +page.ts universal load function
├── API endpoint? → +server.ts route handler
├── Need to invalidate/refetch? → depends() + invalidate()
├── Form submission? → Form actions (+page.server.ts actions)
├── Client-only after hydration? → onMount + fetch
└── Streaming data? → Server-sent events or WebSocket in onMount
```

---

## Svelte 5 Runes

### Core Runes

```svelte
<script lang="ts">
  // $state: reactive state declaration
  let count = $state(0);
  let items = $state<string[]>([]);

  // $state with objects — deep reactivity by default
  let user = $state({ name: 'Alice', age: 30 });
  user.name = 'Bob'; // reactive, triggers update

  // $state.raw: opt out of deep reactivity (better for large immutable data)
  let dataset = $state.raw<DataPoint[]>([]);
  dataset = [...dataset, newPoint]; // must reassign entirely

  // $state.snapshot: get a plain (non-reactive) copy for logging/serialization
  const snapshot = $state.snapshot(user); // { name: 'Bob', age: 30 }

  // $derived: computed values (replaces $: reactive declarations)
  let doubled = $derived(count * 2);

  // $derived.by: complex derivations with function body
  let sorted = $derived.by(() => {
    return [...items].sort((a, b) => a.localeCompare(b));
  });

  // $effect: side effects that auto-track dependencies
  $effect(() => {
    document.title = `Count: ${count}`;
    // cleanup function (runs before re-execution and on destroy)
    return () => console.log('cleaning up');
  });

  // $effect.pre: runs before DOM update
  $effect.pre(() => {
    // useful for scroll position preservation
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });

  // $effect.tracking: check if code is running in a tracking context
  $effect(() => {
    console.log($effect.tracking()); // true inside $effect
  });

  // untrack: read reactive values without creating a dependency
  import { untrack } from 'svelte';
  $effect(() => {
    console.log(count); // tracked
    untrack(() => console.log(items)); // NOT tracked
  });
</script>

<button onclick={() => count++}>Count: {count}</button>
<p>Doubled: {doubled}</p>
```

### Component Props (Svelte 5)

```svelte
<!-- Button.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  // $props: declare component props with TypeScript
  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    onclick,
    children,       // snippet — replaces default slot
    ...restProps    // spread remaining props (class, id, aria-*, etc.)
  }: {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();

  // $bindable: props that support bind: from parent
  let { value = $bindable('') }: { value: string } = $props();
</script>

<button
  class="{variant} {size}"
  {disabled}
  {onclick}
  {...restProps}
>
  {@render children?.()}
</button>
```

### Snippets (Svelte 5 — replaces slots)

```svelte
<!-- DataTable.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    data,
    header,
    row,
    empty,
  }: {
    data: any[];
    header: Snippet;
    row: Snippet<[item: any, index: number]>;
    empty?: Snippet;
  } = $props();
</script>

<table>
  <thead>{@render header()}</thead>
  <tbody>
    {#if data.length === 0}
      {@render empty?.()}
    {:else}
      {#each data as item, i (item.id)}
        {@render row(item, i)}
      {/each}
    {/if}
  </tbody>
</table>

<!-- Usage -->
<DataTable {data}>
  {#snippet header()}<tr><th>Name</th><th>Email</th></tr>{/snippet}
  {#snippet row(user, i)}<tr><td>{user.name}</td><td>{user.email}</td></tr>{/snippet}
  {#snippet empty()}<tr><td colspan="2">No data</td></tr>{/snippet}
</DataTable>
```

---

## Shared Reactive State (.svelte.ts)

```ts
// lib/stores/cart.svelte.ts — Svelte 5 reactive module
export function createCart() {
  let items = $state<CartItem[]>([]);
  let total = $derived(items.reduce((sum, i) => sum + i.price * i.qty, 0));
  let count = $derived(items.reduce((sum, i) => sum + i.qty, 0));

  return {
    get items() { return items; },
    get total() { return total; },
    get count() { return count; },
    add(product: Product) {
      const existing = items.find(i => i.id === product.id);
      if (existing) existing.qty++;
      else items.push({ ...product, qty: 1 });
    },
    remove(id: string) {
      items = items.filter(i => i.id !== id);
    },
    clear() {
      items = [];
    },
  };
}

// Singleton instance for app-wide state
export const cart = createCart();

// Usage in any .svelte file:
// import { cart } from '$lib/stores/cart.svelte';
// cart.add(product);
// {cart.total}
```

---

## SvelteKit 2 Patterns

### Route Structure

```
src/routes/
  +layout.ts          # shared data loading (universal)
  +layout.server.ts   # shared data loading (server-only)
  +layout.svelte      # shared UI wrapper
  +page.ts            # universal load function
  +page.server.ts     # server-only load + form actions
  +page.svelte        # page component
  +error.svelte       # error boundary
  (auth)/             # route group (no URL segment)
    login/+page.svelte
    register/+page.svelte
  users/
    [id]/
      +page.server.ts # dynamic route with param
      +page.svelte
  api/
    users/
      +server.ts      # API endpoint (GET, POST, etc.)
  [[lang]]/           # optional param
    about/+page.svelte
```

### Load Functions

```ts
// +page.server.ts — runs only on server
import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals, depends, url }) => {
  depends('app:users'); // custom invalidation key

  const page = parseInt(url.searchParams.get('page') ?? '1');
  const user = await db.user.findUnique({ where: { id: params.id } });

  if (!user) error(404, { message: 'User not found' });
  if (!locals.user) redirect(303, '/login');

  return { user, page };
};

// +page.ts — universal load (runs on server AND client)
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params, data, depends }) => {
  depends('app:posts');
  // SvelteKit fetch: relative URLs work, cookies forwarded, deduped
  const res = await fetch(`/api/users/${params.id}/posts`);
  if (!res.ok) error(res.status, 'Failed to load posts');
  const posts = await res.json();

  return {
    ...data, // merge with server load data
    posts,
  };
};
```

### Form Actions

```ts
// +page.server.ts
import type { Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: 'Unauthorized' });

    const formData = await request.formData();
    const parsed = createSchema.safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return fail(400, {
        data: Object.fromEntries(formData),
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    await db.user.create({ data: parsed.data });
    redirect(303, '/users');
  },

  delete: async ({ request, locals }) => {
    const data = await request.formData();
    const id = data.get('id') as string;
    await db.user.delete({ where: { id } });
    return { success: true };
  },
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidate } from '$app/navigation';

  let { data, form } = $props();

  // Progressive enhancement with custom logic
  function handleSubmit() {
    return async ({ result, update }) => {
      if (result.type === 'success') {
        await invalidate('app:users');
      }
      await update(); // apply default behavior
    };
  }
</script>

<form method="POST" action="?/create" use:enhance={handleSubmit}>
  <input name="name" value={form?.data?.name ?? ''} />
  {#if form?.errors?.name}
    <p class="error">{form.errors.name[0]}</p>
  {/if}
  <input name="email" value={form?.data?.email ?? ''} />
  <button>Create</button>
</form>
```

### Hooks

```ts
// src/hooks.server.ts
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

const auth: Handle = async ({ event, resolve }) => {
  const session = await getSession(event.cookies);
  event.locals.user = session?.user ?? null;
  return resolve(event);
};

const security: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
};

export const handle = sequence(auth, security);

export const handleError: HandleServerError = async ({ error, event, status, message }) => {
  const errorId = crypto.randomUUID();
  console.error(`[${errorId}]`, error);
  return { message: 'An unexpected error occurred', errorId };
};
```

### API Routes (+server.ts)

```ts
// src/routes/api/users/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) error(401, 'Unauthorized');
  const page = parseInt(url.searchParams.get('page') ?? '1');
  const users = await db.user.findMany({ skip: (page - 1) * 20, take: 20 });
  return json({ data: users, page });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = await request.json();
  const user = await db.user.create({ data: body });
  return json(user, { status: 201 });
};
```

---

## Transitions & Animations

```svelte
<script>
  import { fly, fade, slide, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';

  let visible = $state(true);
  let items = $state([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
</script>

{#if visible}
  <div transition:fly={{ y: 200, duration: 300, easing: cubicOut }}>
    Flies in/out
  </div>
  <div in:fade={{ duration: 200 }} out:slide={{ duration: 300 }}>
    Different in/out transitions
  </div>
{/if}

{#each items as item (item.id)}
  <div animate:flip={{ duration: 300 }} transition:fade>
    {item.name}
  </div>
{/each}
```

---

## SSR / SSG / SPA Modes

```ts
// +page.ts or +layout.ts
export const prerender = true;   // SSG: generate at build time
export const ssr = false;        // SPA: client-only rendering
export const csr = true;         // default: client-side hydration
export const trailingSlash = 'always'; // URL trailing slash behavior

// Adapters: adapter-auto (Vercel/Cloudflare), adapter-node, adapter-static
```

---

## Testing

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Counter from './Counter.svelte';

test('increments count on click', async () => {
  const user = userEvent.setup();
  render(Counter, { props: { initial: 0 } });

  const button = screen.getByRole('button');
  expect(button).toHaveTextContent('0');

  await user.click(button);
  expect(button).toHaveTextContent('1');
});

test('emits event on action', async () => {
  const user = userEvent.setup();
  const { component } = render(Counter);

  const handler = vi.fn();
  component.$on('change', handler);

  await user.click(screen.getByRole('button'));
  expect(handler).toHaveBeenCalled();
});
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| `$:` reactive declarations (Svelte 4) | `$derived` and `$effect` runes |
| Mutate `$state.raw` objects | Reassign entirely: `data = [...data, item]` |
| `$effect` for derived state | `$derived` or `$derived.by` |
| Side effects in `$derived` | Use `$effect` for side effects |
| Circular `$effect` dependencies | Restructure to avoid loops, use `untrack` |
| `$state` outside `.svelte`/`.svelte.ts` | Runes require Svelte compiler context |
| `on:click` syntax (Svelte 4) | `onclick` attribute (Svelte 5) |
| `<slot />` (Svelte 4) | `{@render children?.()}` with snippets |
| `createEventDispatcher` | Callback props: `onclick`, `onchange` |
| Stores for component-local state | `$state` rune (simpler, no subscribe) |

---

## Verification Checklist

Before considering Svelte work done:
- [ ] All reactive state uses `$state` (not `let` without rune)
- [ ] Derived values use `$derived`, not `$effect` + assignment
- [ ] Effects have cleanup functions for async/subscriptions
- [ ] Props typed with TypeScript in `$props()` destructuring
- [ ] Snippets used instead of slots for Svelte 5 components
- [ ] `onclick` attribute syntax (not `on:click` directive)
- [ ] Form actions validate input server-side with proper error returns
- [ ] Load functions use `depends()` for invalidation support
- [ ] `{#each}` blocks have proper key expressions `(item.id)`
- [ ] No blocking waterfalls — parallel data fetching where possible
- [ ] Error boundaries (`+error.svelte`) at appropriate route levels
- [ ] Progressive enhancement: forms work without JavaScript
