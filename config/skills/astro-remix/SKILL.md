---
name: astro-remix
description: Astro, Remix, islands architecture, SSR/SSG hybrid, loaders/actions. Use when working on astro-remix tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Astro & Remix
# Loaded on-demand when working with Astro or Remix projects

## Auto-Detect

Trigger this skill when:
- File extensions: `.astro`, `.mdx` (in Astro context)
- Config files: `astro.config.mjs`, `astro.config.ts`, `remix.config.js`, `app/root.tsx` (Remix)
- `package.json` contains: `astro`, `@astrojs/*`, `@remix-run/*`, `react-router` (v7+)
- Directory patterns: `src/pages/` (Astro), `src/content/` (Astro), `app/routes/` (Remix)
- Imports from: `astro:content`, `astro:transitions`, `@remix-run/react`, `react-router`

---

## Decision Tree: Astro vs Remix vs Next.js

```
What type of site/app are you building?
├── Content-first (blog, docs, marketing, portfolio)?
│   ├── Mostly static, rarely changes? → Astro (SSG)
│   ├── Static + some interactive widgets? → Astro (islands)
│   └── Content + authenticated sections? → Astro (hybrid mode)
├── App-first (dashboard, SaaS, CRUD)?
│   ├── Progressive enhancement critical? → Remix
│   ├── Heavy client interactivity + SEO? → Next.js App Router
│   ├── Nested layouts with independent data? → Remix
│   └── Need React Server Components? → Next.js
├── E-commerce?
│   ├── Catalog-heavy, few interactive pages? → Astro + islands
│   ├── Full checkout flow, auth, cart? → Remix or Next.js
│   └── Headless CMS + storefront? → Astro (content) or Next.js (app)
└── Hybrid (content + app sections)?
    ├── Marketing site + embedded app? → Astro (static) + React island
    ├── Docs site + interactive playground? → Astro + client:only islands
    └── Full-stack with forms + content? → Remix
```

## Decision Tree: Rendering Strategy

```
How should this page render?
├── Content never changes between deploys? → Static (SSG / prerender)
├── Content changes but not per-user? → SSG + ISR or on-demand revalidation
├── Content is personalized per user? → SSR (server-render on each request)
├── Section of page is personalized? → Static shell + server island (Astro 5)
├── Highly interactive, no SEO needed? → Client-only (SPA island)
└── Mix of static + dynamic on same page? → Astro hybrid mode or Remix with headers
```

---

## Astro 5 Patterns

### Content Collections (Type-Safe)

```astro
---
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    image: z.string().optional(),
  }),
});

export const collections = { blog };
---
```

```astro
---
// src/pages/blog/[slug].astro
import { getCollection, getEntry } from 'astro:content';
import BaseLayout from '../../layouts/BaseLayout.astro';

export async function getStaticPaths() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.map(post => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content, headings } = await post.render();
---

<BaseLayout title={post.data.title}>
  <article>
    <h1>{post.data.title}</h1>
    <time datetime={post.data.pubDate.toISOString()}>
      {post.data.pubDate.toLocaleDateString()}
    </time>
    <Content />
  </article>
</BaseLayout>
```

### Server Islands (Astro 5)

```astro
---
// Static shell renders immediately, server island streams in
---
<html>
  <body>
    <Header />
    <main>
      <h1>Product Page</h1>
      <ProductDetails product={product} />

      <!-- Server Island: renders on server, streams in after shell -->
      <UserReviews server:defer productId={product.id}>
        <ReviewsSkeleton slot="fallback" />
      </UserReviews>

      <!-- Client Island: hydrates on client -->
      <AddToCart client:visible productId={product.id} />
    </main>
  </body>
</html>
```

### View Transitions

```astro
---
import { ViewTransitions } from 'astro:transitions';
---
<html>
  <head>
    <ViewTransitions />
  </head>
  <body>
    <nav transition:persist>
      <!-- Nav persists across page navigations -->
    </nav>
    <main transition:animate="slide">
      <slot />
    </main>
  </body>
</html>
```

### Hybrid Rendering (SSG + SSR)

```typescript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'hybrid', // static by default, opt-in to SSR per page
  adapter: node({ mode: 'standalone' }),
});
```

```astro
---
// src/pages/dashboard.astro — opt into SSR
export const prerender = false; // This page renders on every request

const session = await getSession(Astro.request);
if (!session) return Astro.redirect('/login');
const userData = await fetchUserData(session.userId);
---
<DashboardLayout user={userData}>
  <Stats client:load data={userData.stats} />
</DashboardLayout>
```

### Island Hydration Directives

```astro
<!-- Load JS immediately (above the fold, critical interactivity) -->
<Counter client:load initial={0} />

<!-- Load JS when element enters viewport (below the fold) -->
<Comments client:visible postId={post.id} />

<!-- Load JS when browser is idle (non-critical) -->
<Newsletter client:idle />

<!-- Load JS on specific media query (mobile-only features) -->
<MobileMenu client:media="(max-width: 768px)" />

<!-- Never SSR, render only on client (auth-dependent, browser APIs) -->
<UserAvatar client:only="react" userId={user.id} />
```

---

## Remix v3 / React Router v7 Patterns

### Loaders & Actions

```tsx
// app/routes/posts.$postId.tsx
import type { Route } from "./+types/posts.$postId";
import { data, redirect } from "react-router";

// Loader runs on server before render — type-safe params
export async function loader({ params, request }: Route.LoaderArgs) {
  const post = await db.post.findUnique({ where: { id: params.postId } });
  if (!post) throw data(null, { status: 404 });

  const url = new URL(request.url);
  const showComments = url.searchParams.get('comments') === 'true';

  return { post, showComments };
}

// Action handles form submissions — progressive enhancement
export async function action({ params, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  switch (intent) {
    case 'delete':
      await db.post.delete({ where: { id: params.postId } });
      return redirect('/posts');
    case 'update':
      const title = formData.get('title') as string;
      await db.post.update({ where: { id: params.postId }, data: { title } });
      return { success: true };
    default:
      throw data({ error: 'Invalid intent' }, { status: 400 });
  }
}

// Component receives loader data with full type inference
export default function PostPage({ loaderData }: Route.ComponentProps) {
  const { post, showComments } = loaderData;

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
      <DeleteForm postId={post.id} />
      {showComments && <Comments postId={post.id} />}
    </article>
  );
}
```

### Progressive Enhancement Forms

```tsx
import { Form, useNavigation, useActionData } from "react-router";

function CreatePostForm() {
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const isSubmitting = navigation.state === 'submitting';

  return (
    // Form works without JS (progressive enhancement)
    // With JS: no full page reload, optimistic UI
    <Form method="post" action="/posts">
      <fieldset disabled={isSubmitting}>
        <label>
          Title
          <input
            name="title"
            required
            aria-invalid={actionData?.errors?.title ? true : undefined}
            aria-describedby="title-error"
          />
          {actionData?.errors?.title && (
            <span id="title-error" role="alert">{actionData.errors.title}</span>
          )}
        </label>

        <button type="submit">
          {isSubmitting ? 'Creating...' : 'Create Post'}
        </button>
      </fieldset>
    </Form>
  );
}
```

### Nested Routes & Error Boundaries

```tsx
// app/routes/dashboard.tsx — layout route
import { Outlet, useLoaderData } from "react-router";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAuth(request);
  return { user };
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="dashboard">
      <Sidebar user={loaderData.user} />
      <main>
        <Outlet /> {/* Child routes render here */}
      </main>
    </div>
  );
}

// Error boundary — catches errors in this route segment only
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return <div>Error {error.status}: {error.statusText}</div>;
  }
  return <div>Something went wrong</div>;
}
```

### Optimistic UI

```tsx
import { useFetcher } from "react-router";

function LikeButton({ postId, likes }: { postId: string; likes: number }) {
  const fetcher = useFetcher();
  const optimisticLikes = fetcher.formData
    ? likes + 1  // Optimistic: show +1 immediately
    : likes;

  return (
    <fetcher.Form method="post" action={`/posts/${postId}/like`}>
      <button type="submit" aria-label={`Like (${optimisticLikes})`}>
        ♥ {optimisticLikes}
      </button>
    </fetcher.Form>
  );
}
```

---

## SEO & Meta Patterns

### Astro

```astro
---
// src/components/SEO.astro
interface Props {
  title: string;
  description: string;
  image?: string;
  type?: 'website' | 'article';
}
const { title, description, image, type = 'website' } = Astro.props;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
---
<title>{title}</title>
<meta name="description" content={description} />
<link rel="canonical" href={canonicalURL} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:type" content={type} />
<meta property="og:url" content={canonicalURL} />
{image && <meta property="og:image" content={new URL(image, Astro.site)} />}
<meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
```

### Remix

```tsx
// app/routes/posts.$postId.tsx
export function meta({ data }: Route.MetaArgs) {
  if (!data?.post) return [{ title: 'Not Found' }];
  return [
    { title: data.post.title },
    { name: 'description', content: data.post.excerpt },
    { property: 'og:title', content: data.post.title },
    { property: 'og:type', content: 'article' },
  ];
}
```

---

## Deployment Targets

| Platform | Astro Adapter | Remix Adapter |
|----------|--------------|---------------|
| Vercel | `@astrojs/vercel` | `@react-router/vercel` |
| Cloudflare | `@astrojs/cloudflare` | `@react-router/cloudflare` |
| Node.js | `@astrojs/node` | `@react-router/node` |
| Deno | `@astrojs/deno` | `@react-router/deno` |
| Netlify | `@astrojs/netlify` | `@react-router/netlify` |
| Static | (default, no adapter) | N/A (Remix needs server) |

---

## Performance Patterns

```typescript
// Astro: Zero JS by default — only islands ship JavaScript
// Measure: lighthouse score should be 95+ for content pages

// Remix: Prefetch links for instant navigation
import { Link } from "react-router";
<Link to="/about" prefetch="intent">About</Link>  // prefetch on hover/focus
<Link to="/posts" prefetch="render">Posts</Link>   // prefetch immediately
<Link to="/heavy" prefetch="viewport">Heavy</Link> // prefetch when visible

// Remix: Cache headers for static-ish pages
export function headers() {
  return {
    "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  };
}

// Astro: Image optimization
import { Image } from 'astro:assets';
import heroImage from '../assets/hero.jpg';
<Image src={heroImage} alt="Hero" width={1200} format="avif" loading="eager" />
```

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| `client:load` on every component (Astro) | Use `client:visible` or `client:idle` for below-fold |
| Fetch data in client components (Astro) | Fetch in frontmatter, pass as props |
| Skip error boundaries in Remix routes | Every route segment gets an ErrorBoundary |
| Use `useEffect` for data fetching in Remix | Use loaders — they run on the server |
| Ignore progressive enhancement in Remix | Forms should work without JavaScript |
| Put auth logic in client islands (Astro) | Use middleware or SSR pages for auth |
| Giant monolithic Remix loader | Split into smaller utility functions |
| Skip `prefetch` on navigation links (Remix) | Use `prefetch="intent"` for perceived speed |
| Import heavy libraries in Astro frontmatter | Use dynamic imports in islands only |
| Use Remix for a static blog | Use Astro — zero JS, faster builds |

---

## Verification Checklist

Before considering Astro/Remix work done:
- [ ] Correct rendering mode per page (static vs SSR vs hybrid)
- [ ] Islands use appropriate hydration directive (`client:load` only when needed)
- [ ] Content collections have Zod schemas with proper validation
- [ ] Remix loaders handle 404/error cases with proper status codes
- [ ] Forms work without JavaScript (progressive enhancement)
- [ ] Error boundaries on every Remix route segment
- [ ] SEO meta tags on all public pages
- [ ] Images optimized (Astro `<Image>`, proper formats, lazy loading)
- [ ] Cache headers set for appropriate routes
- [ ] Lighthouse performance score ≥ 90 for content pages
- [ ] Deployment adapter configured and tested
- [ ] View transitions don't break back/forward navigation

---

## MCP Integration

| Tool | Use For |
|------|---------|
| `context7` | Look up Astro 5 API, Remix/React Router v7 loader patterns |
| `playwright` | E2E testing of page transitions, form submissions |
| `sequential-thinking` | Design routing structure and data flow |
| `grep/glob` | Find existing route patterns and content schemas |
