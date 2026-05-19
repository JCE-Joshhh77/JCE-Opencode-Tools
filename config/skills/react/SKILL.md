---
name: react
description: React, JSX/TSX, hooks, React 19, Server Components. Use when working on react tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: React Advanced
# Loaded on-demand when working with React, JSX, TSX components

## Auto-Detect

Trigger this skill when:
- File extensions: `.jsx`, `.tsx`, `*.component.tsx`
- `package.json` contains: `react`, `react-dom`, `next`, `@tanstack/react-query`
- Imports from: `react`, `react-dom`, `react-dom/client`
- Directory patterns: `components/`, `hooks/`, `app/` (Next.js App Router)

---

## Decision Tree: State Management

```
Need to store data?
├── Derived from props/other state? → Compute during render (no state needed)
├── Only used by this component? → useState / useReducer
├── Shared by 2-3 nearby components? → Lift state up
├── App-wide UI state (theme, sidebar)? → Zustand (no providers, minimal boilerplate)
├── Server data (API responses)? → TanStack Query (caching, revalidation, dedup)
├── Complex form state? → React Hook Form + Zod
├── URL-driven state? → useSearchParams / nuqs
└── Deeply nested prop threading? → Context (but ONLY for rarely-changing values)
```

## Decision Tree: Component Type

```
Does it need interactivity (state, effects, event handlers)?
├── No → Server Component (default in App Router, no directive needed)
│   ├── Needs data? → async function + direct DB/API call
│   ├── Needs streaming? → Wrap in Suspense boundary
│   └── Renders children that are interactive? → Pass Client Components as children
└── Yes → Client Component ('use client' directive)
    ├── Needs form submission? → Server Action + useActionState
    ├── Needs optimistic UI? → useOptimistic
    ├── Needs pending state? → useTransition or useFormStatus
    └── Needs to read a promise? → use() hook (suspends until resolved)
```

## Decision Tree: Data Fetching

```
Where does data come from?
├── Server Component (App Router)?
│   ├── Direct DB/ORM call (Prisma, Drizzle) → async component
│   ├── External API → fetch() with caching options
│   └── Multiple sources? → Promise.all() to avoid waterfalls
├── Client Component?
│   ├── Needs caching/dedup/revalidation? → TanStack Query
│   ├── Simple one-off fetch? → use() + Suspense
│   └── Real-time data? → useSyncExternalStore + WebSocket
└── Hybrid (server-fetched, client-refreshed)?
    └── Server Component initial + TanStack Query hydration
```

---

## React 19 Patterns

```tsx
// useActionState — handles async form actions with pending state
'use client';
import { useActionState } from 'react';
import { createPost } from './actions';

function CreatePost() {
  const [state, action, isPending] = useActionState(
    async (prev: { error: string | null }, formData: FormData) => {
      const result = await createPost(formData);
      if (!result.ok) return { error: result.error };
      return { error: null };
    },
    { error: null }
  );

  return (
    <form action={action}>
      <input name="title" required />
      {state.error && <p role="alert" className="text-red-500">{state.error}</p>}
      <button disabled={isPending}>{isPending ? 'Creating...' : 'Create'}</button>
    </form>
  );
}

// use() — read promises and context in render
import { use, Suspense } from 'react';

function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise); // suspends until resolved
  return <h1>{user.name}</h1>;
}

// use() with context — replaces useContext
function ThemeButton() {
  const theme = use(ThemeContext); // can be called conditionally!
  return <button className={theme.buttonClass}>Click</button>;
}

// Parent passes the promise, Suspense handles loading
function Page({ id }: { id: string }) {
  const userPromise = fetchUser(id); // starts fetching immediately
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <UserProfile userPromise={userPromise} />
    </Suspense>
  );
}

// useOptimistic — instant UI feedback before server confirms
function LikeButton({ likes, postId }: { likes: number; postId: string }) {
  const [optimisticLikes, setOptimisticLikes] = useOptimistic(likes);

  async function handleLike(formData: FormData) {
    setOptimisticLikes((prev) => prev + 1);
    await likePost(postId); // server action
  }

  return (
    <form action={handleLike}>
      <button type="submit">♥ {optimisticLikes}</button>
    </form>
  );
}

// useFormStatus — access parent form's pending state
import { useFormStatus } from 'react-dom';

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending, data, method } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Submitting...' : children}
    </button>
  );
}

// ref as prop — no more forwardRef wrapper in React 19
function Input({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}

// Document metadata in components — hoisted to <head> automatically
function BlogPost({ post }: { post: Post }) {
  return (
    <article>
      <title>{post.title}</title>
      <meta name="description" content={post.excerpt} />
      <link rel="canonical" href={`https://example.com/posts/${post.slug}`} />
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  );
}
```

---

## Server Components (RSC) Patterns

```tsx
// Server Component — async, direct data access, zero client JS
async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id } });
  if (!product) notFound();

  return (
    <main>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      {/* Client component receives serializable props only */}
      <AddToCartButton productId={product.id} price={product.price} />
    </main>
  );
}

// Streaming with independent Suspense boundaries
async function Dashboard() {
  return (
    <main>
      <h1>Dashboard</h1>
      {/* Each boundary streams independently — fast parts show first */}
      <Suspense fallback={<StatsSkeleton />}>
        <Stats />
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <RevenueChart /> {/* Slow query doesn't block Stats */}
      </Suspense>
    </main>
  );
}

// Composition pattern: Server content through Client wrapper
// ClientTabs.tsx — 'use client'
function ClientTabs({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState(0);
  return <div>{/* tab logic wrapping server-rendered children */}{children}</div>;
}

// Page.tsx — Server Component
async function Page() {
  const data = await fetchData();
  return (
    <ClientTabs>
      <ServerRenderedContent data={data} /> {/* Stays on server */}
    </ClientTabs>
  );
}

// Server Actions in separate file
// actions.ts
'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';

export async function updateProfile(prevState: any, formData: FormData) {
  const name = formData.get('name') as string;
  const result = await db.user.update({ where: { id: session.userId }, data: { name } });
  revalidatePath('/profile');
  return { success: true };
}
```

---

## Hooks Best Practices

```tsx
// Custom hook: encapsulate reusable logic
function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// useReducer for complex state machines
type State = { status: 'idle' | 'loading' | 'success' | 'error'; data?: Data; error?: string };
type Action = { type: 'fetch' } | { type: 'success'; data: Data } | { type: 'error'; error: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'fetch': return { status: 'loading' };
    case 'success': return { status: 'success', data: action.data };
    case 'error': return { status: 'error', error: action.error };
  }
}

// useSyncExternalStore — subscribe to external stores safely
function useOnlineStatus() {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener('online', callback);
      window.addEventListener('offline', callback);
      return () => {
        window.removeEventListener('online', callback);
        window.removeEventListener('offline', callback);
      };
    },
    () => navigator.onLine,       // client snapshot
    () => true                     // server snapshot (SSR)
  );
}
```

---

## Performance Patterns

```tsx
// React Compiler (React 19) — auto-memoization, no manual memo/useMemo/useCallback
// If using React Compiler, remove manual memoization — it handles it automatically

// Without compiler: React.memo for expensive renders (profile first!)
const ExpensiveList = memo(function ExpensiveList({ items }: { items: Item[] }) {
  return items.map(item => <ExpensiveRow key={item.id} item={item} />);
});

// lazy + Suspense for route-level code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
<Suspense fallback={<DashboardSkeleton />}><Dashboard /></Suspense>

// startTransition — mark non-urgent updates
function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value); // urgent: update input immediately
    startTransition(() => setResults(filterItems(e.target.value))); // non-urgent
  }
  return <input value={query} onChange={handleChange} />;
}

// useDeferredValue — defer expensive child re-renders
function FilteredList({ filter }: { filter: string }) {
  const deferredFilter = useDeferredValue(filter);
  const items = useMemo(() => expensiveFilter(deferredFilter), [deferredFilter]);
  return <List items={items} />;
}
```

---

## TanStack Query Patterns

```tsx
// Query with proper typing and options
function useProducts(filters: Filters) {
  return useQuery({
    queryKey: ['products', filters],
    queryFn: () => fetchProducts(filters),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: 2,
  });
}

// Mutation with optimistic update
function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProduct,
    onMutate: async (newProduct) => {
      await queryClient.cancelQueries({ queryKey: ['products'] });
      const previous = queryClient.getQueryData(['products']);
      queryClient.setQueryData(['products'], (old: Product[]) =>
        old.map(p => p.id === newProduct.id ? { ...p, ...newProduct } : p)
      );
      return { previous };
    },
    onError: (_err, _new, context) => {
      queryClient.setQueryData(['products'], context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// Prefetching for instant navigation
function ProductLink({ id }: { id: string }) {
  const queryClient = useQueryClient();
  return (
    <Link
      href={`/products/${id}`}
      onMouseEnter={() => queryClient.prefetchQuery({
        queryKey: ['product', id],
        queryFn: () => fetchProduct(id),
      })}
    >
      View Product
    </Link>
  );
}
```

---

## Testing Patterns

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Test behavior, not implementation
test('submits form with validated data', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<ContactForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText(/email/i), 'test@example.com');
  await user.click(screen.getByRole('button', { name: /submit/i }));

  expect(onSubmit).toHaveBeenCalledWith({ email: 'test@example.com' });
});

// Test async components with MSW
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.get('/api/users', () => HttpResponse.json([{ id: '1', name: 'Alice' }]))
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('displays users from API', async () => {
  render(<UserList />);
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
});

// Test accessibility: prefer getByRole
// screen.getByRole('button', { name: /submit/i }) > screen.getByTestId('submit-btn')
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| `useEffect` to sync derived state | Compute during render |
| `useEffect` to fetch data | TanStack Query / Server Component / use() |
| Index as key for dynamic lists | Stable unique ID (`item.id`) |
| Object literals in JSX props | Hoist to module scope or useMemo |
| Prop drilling 4+ levels deep | Composition, Context, or Zustand |
| Giant useEffect doing 3 things | Split into separate effects |
| `any` in component props | Proper TypeScript generics |
| `useEffect` + `setState` for transforms | `useMemo` or compute inline |
| Fetching in useEffect without cleanup | Use a data library or AbortController |
| `forwardRef` in React 19 | Pass ref as regular prop |
| `useContext` in React 19 | `use(Context)` — works conditionally |
| Manual memo/useCallback everywhere | Use React Compiler or profile first |

---

## Verification Checklist

Before considering React work done:
- [ ] No `useEffect` for derived state — computed inline or `useMemo`
- [ ] All lists use stable keys (not index)
- [ ] Client Components have `'use client'` directive
- [ ] Server Components have no `useState`/`useEffect`/event handlers
- [ ] Error boundaries wrap async/suspense boundaries
- [ ] Forms use useActionState or React Hook Form + Zod
- [ ] No prop drilling beyond 2 levels
- [ ] Accessibility: semantic HTML, ARIA labels, keyboard navigation
- [ ] Performance: no unnecessary re-renders (React DevTools Profiler)
- [ ] Tests cover user-facing behavior, not implementation details
- [ ] Suspense boundaries have meaningful fallbacks (skeletons, not spinners)
- [ ] Server Actions validate input and handle errors gracefully
