---
name: nextjs
description: Next.js, App Router, Server Actions. Use when working on nextjs tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Next.js
# Loaded on-demand when working with Next.js, App Router, Pages Router

## Auto-Detect

Trigger this skill when:
- `package.json` contains: `next`
- Files: `next.config.ts`, `app/`, `pages/`
- Imports from: `next/`, `@next/`
- Directory patterns: `app/layout.tsx`, `app/page.tsx`, `middleware.ts`

---

## Decision Tree: Rendering Strategy

```
How should this page render?
├── Content never changes (marketing, docs)? → Static (default, build-time)
├── Content changes infrequently? → ISR (revalidate: seconds)
├── Content is user-specific or real-time? → Dynamic (force-dynamic / no-store)
├── Mix of static shell + dynamic content? → PPR (Partial Prerendering)
├── Heavy client interactivity? → Client Component with server-fetched initial data
└── API response only (no HTML)? → Route Handler (+server.ts)
```

## Decision Tree: Data Fetching

```
Where to fetch data?
├── Server Component (default)?
│   ├── Database/ORM directly → async component, no API layer needed
│   ├── External API → fetch() with cache/revalidate options
│   ├── Multiple independent sources → Promise.all() (avoid waterfalls)
│   └── Slow data alongside fast data → Suspense boundaries (streaming)
├── Client Component?
│   ├── After user interaction → Server Action or TanStack Query mutation
│   ├── Polling/real-time → TanStack Query with refetchInterval
│   └── Infinite scroll → TanStack Query useInfiniteQuery
├── Form submission?
│   └── Server Action (useActionState + revalidatePath/revalidateTag)
└── Need to share between components?
    └── fetch() is auto-deduped in same render pass
```

---

## App Router File Conventions

```
app/
  layout.tsx          # Root layout (required, wraps all pages)
  page.tsx            # Home page (/)
  loading.tsx         # Instant loading UI (Suspense boundary)
  error.tsx           # Error boundary ('use client' required)
  not-found.tsx       # 404 page (triggered by notFound())
  global-error.tsx    # Root error boundary (wraps root layout)
  template.tsx        # Like layout but re-mounts on navigation
  default.tsx         # Fallback for parallel routes
  dashboard/
    layout.tsx        # Nested layout (persists across child navigations)
    page.tsx          # /dashboard
    @analytics/       # Parallel route (named slot)
      page.tsx
      default.tsx
    (.)settings/      # Intercepting route (modal pattern)
      page.tsx
  (marketing)/        # Route group (no URL segment, separate layout)
    about/page.tsx
  api/
    users/
      route.ts        # Route handler: GET, POST, PUT, DELETE
```

---

## Server Components vs Client Components

```tsx
// Server Component (DEFAULT — no directive needed)
// Can: access DB, read files, use secrets, await async, zero JS bundle
async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // Next.js 15: params is a Promise
  const product = await db.product.findUnique({ where: { id } });
  if (!product) notFound();
  return (
    <div>
      <h1>{product.name}</h1>
      <AddToCartButton productId={id} /> {/* Client component child */}
    </div>
  );
}

// Client Component — interactive, has state/effects/event handlers
'use client';
import { useState, useTransition } from 'react';
import { addToCart } from './actions';

function AddToCartButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() => startTransition(() => addToCart(productId))}
    >
      {isPending ? 'Adding...' : 'Add to Cart'}
    </button>
  );
}
```

### Boundary Rules

```
Server Component CAN import Client Component ✅
Client Component CANNOT import Server Component ❌
Client Component CAN render Server Component passed as children/props ✅

// Pattern: pass server content through client wrapper
<ClientTabs>
  <ServerTabContent />  {/* rendered on server, passed as children */}
</ClientTabs>

// Use 'server-only' package to prevent accidental client import
import 'server-only'; // throws build error if imported in client component
```

---

## Partial Prerendering (PPR) — Next.js 15

```tsx
// next.config.ts
const config: NextConfig = {
  experimental: {
    ppr: 'incremental', // opt-in per route
  },
};

// app/dashboard/page.tsx
export const experimental_ppr = true; // enable PPR for this route

// Static shell renders at build time, dynamic parts stream in
async function DashboardPage() {
  return (
    <main>
      {/* Static: rendered at build time, cached at CDN */}
      <h1>Dashboard</h1>
      <Sidebar />

      {/* Dynamic: streams in at request time via Suspense */}
      <Suspense fallback={<StatsSkeleton />}>
        <DynamicStats /> {/* uses cookies(), headers(), or no-store fetch */}
      </Suspense>

      <Suspense fallback={<FeedSkeleton />}>
        <PersonalizedFeed />
      </Suspense>
    </main>
  );
}

// Components that use dynamic APIs automatically become dynamic holes:
// cookies(), headers(), searchParams, connection(), unstable_noStore()
```

---

## Server Actions

```tsx
// Separate file for reuse across components
// app/actions.ts
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const createPostSchema = z.object({
  title: z.string().min(3).max(255),
  body: z.string().min(10),
});

export async function createPost(prevState: any, formData: FormData) {
  const parsed = createPostSchema.safeParse({
    title: formData.get('title'),
    body: formData.get('body'),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await db.post.create({ data: parsed.data });
  revalidateTag('posts');
  redirect('/posts');
}

// Non-form server action (called from event handler)
export async function toggleLike(postId: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');

  await db.like.upsert({
    where: { userId_postId: { userId: session.user.id, postId } },
    create: { userId: session.user.id, postId },
    update: {},
  });
  revalidateTag(`post-${postId}`);
}

// Client component using server action with useActionState
'use client';
import { useActionState } from 'react';
import { createPost } from './actions';

function PostForm() {
  const [state, formAction, isPending] = useActionState(createPost, null);
  return (
    <form action={formAction}>
      <input name="title" />
      {state?.errors?.title && <p className="error">{state.errors.title[0]}</p>}
      <textarea name="body" />
      <button disabled={isPending}>{isPending ? 'Creating...' : 'Create'}</button>
    </form>
  );
}
```

---

## Caching Strategies (Next.js 15)

```tsx
// Next.js 15: fetch is NOT cached by default (changed from 14)
// You must opt-in to caching explicitly

// Static data — cached indefinitely until redeployed
const data = await fetch('https://api.example.com/static', {
  cache: 'force-cache',
});

// ISR — revalidate every hour
const posts = await fetch('https://api.example.com/posts', {
  next: { revalidate: 3600 },
});

// Dynamic — never cached (default in Next.js 15)
const live = await fetch('https://api.example.com/live');
// equivalent to: { cache: 'no-store' }

// Tag-based revalidation
const product = await fetch(`https://api.example.com/products/${id}`, {
  next: { tags: [`product-${id}`, 'products'] },
});
// Then in Server Action: revalidateTag('products')

// unstable_cache for non-fetch data (DB queries, etc.)
import { unstable_cache } from 'next/cache';

const getCachedUser = unstable_cache(
  async (id: string) => db.user.findUnique({ where: { id } }),
  ['user'],
  { revalidate: 3600, tags: ['users'] }
);

// Per-route segment config
export const dynamic = 'force-dynamic';     // always SSR
export const revalidate = 3600;             // ISR interval for entire route
export const fetchCache = 'force-cache';    // override fetch default
export const runtime = 'edge';              // edge runtime
```

---

## Data Fetching Patterns

```tsx
// Parallel data fetching (avoid waterfalls)
async function Dashboard() {
  // Start all fetches simultaneously
  const [users, analytics, revenue] = await Promise.all([
    getUsers(),
    getAnalytics(),
    getRevenue(),
  ]);
  return <DashboardView users={users} analytics={analytics} revenue={revenue} />;
}

// Streaming with Suspense (don't block on slow data)
async function Page() {
  // Fast data fetched immediately
  const categories = await getCategories();

  return (
    <main>
      <CategoryNav categories={categories} />
      {/* Slow data streams in independently */}
      <Suspense fallback={<ProductsSkeleton />}>
        <ProductList /> {/* async component, fetches its own data */}
      </Suspense>
    </main>
  );
}

// generateStaticParams — static generation for dynamic routes
export async function generateStaticParams() {
  const posts = await db.post.findMany({ select: { slug: true } });
  return posts.map((post) => ({ slug: post.slug }));
}

// Preloading data for client components
import { preload } from 'react-dom';
// preload('/api/data', { as: 'fetch' });
```

---

## Route Handlers

```ts
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100);

  const users = await db.user.findMany({
    skip: (page - 1) * limit,
    take: limit,
  });

  return NextResponse.json({ data: users, page, limit });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  // Validate with Zod
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const user = await db.user.create({ data: parsed.data });
  return NextResponse.json(user, { status: 201 });
}

// Streaming response
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of generateData()) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

---

## Middleware

```ts
// middleware.ts (root level — runs on Edge Runtime)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Auth check
  const token = request.cookies.get('session')?.value;
  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Add headers
  const response = NextResponse.next();
  response.headers.set('x-request-id', crypto.randomUUID());

  // Geolocation-based routing
  const country = request.geo?.country ?? 'US';
  response.headers.set('x-country', country);

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and _next
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

---

## Metadata & SEO

```tsx
import type { Metadata } from 'next';

// Static metadata
export const metadata: Metadata = {
  title: { default: 'My App', template: '%s | My App' },
  description: 'Built with Next.js',
  metadataBase: new URL('https://example.com'),
  openGraph: { title: 'My App', images: ['/og.png'], type: 'website' },
  robots: { index: true, follow: true },
};

// Dynamic metadata
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return {
    title: product.name,
    description: product.description,
    openGraph: { images: [{ url: product.image, width: 1200, height: 630 }] },
  };
}

// JSON-LD structured data
function ProductJsonLd({ product }: { product: Product }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description,
        offers: { '@type': 'Offer', price: product.price, priceCurrency: 'USD' },
      }) }}
    />
  );
}
```

---

## Parallel & Intercepting Routes

```tsx
// app/layout.tsx — parallel routes via named slots
export default function Layout({
  children,
  modal,      // @modal/(.)photo/[id]/page.tsx
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}

// @modal/default.tsx — return null when modal not active
export default function Default() { return null; }

// Intercepting route: (.) same level, (..) one level up, (...) root
// Used for modal patterns — clicking link shows modal, direct URL shows full page
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| `'use client'` on every component | Push client boundary as low as possible |
| Fetch in client useEffect when server works | Use Server Components for data |
| Import server-only code in client | Use `import 'server-only'` guard |
| Large client bundles | Audit with `@next/bundle-analyzer` |
| Missing `loading.tsx` | Always provide loading UI for routes |
| `getServerSideProps` in App Router | Use async Server Components |
| Secrets in `NEXT_PUBLIC_` variables | Only use for truly public values |
| Not awaiting `params` in Next.js 15 | `params` and `searchParams` are Promises |
| Fetching same data in multiple components | fetch() is auto-deduped in same render |
| No error boundaries | Add `error.tsx` at route segment levels |
| Caching assumptions from Next.js 14 | Next.js 15 does NOT cache fetch by default |
| Server Actions without input validation | Always validate with Zod before DB ops |

---

## Verification Checklist

Before considering Next.js work done:
- [ ] `params` and `searchParams` awaited (Next.js 15 async APIs)
- [ ] Server Components used for data fetching (no client useEffect)
- [ ] Client boundary pushed as low as possible in component tree
- [ ] Suspense boundaries wrap slow async components (streaming)
- [ ] Server Actions validate all input (Zod) and handle errors
- [ ] Caching strategy explicit: `revalidate`, tags, or `no-store`
- [ ] `loading.tsx` and `error.tsx` at appropriate route levels
- [ ] No secrets exposed via `NEXT_PUBLIC_` prefix
- [ ] Metadata/SEO configured with `generateMetadata`
- [ ] Images use `next/image` with proper sizing and priority
- [ ] Middleware scoped with matcher (not running on static assets)
- [ ] Build passes with `next build` — no type errors or warnings
