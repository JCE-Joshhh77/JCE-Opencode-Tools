---
name: frontend
description: UI components, accessibility, responsive design, state management, i18n. Use when working on frontend tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: UI/UX & Frontend
# Loaded on-demand when task involves accessibility, responsive design, state management, component patterns, performance, or i18n

## Auto-Detect

Trigger this skill when:
- Files: `*.tsx`, `*.vue`, `*.svelte`, `*.css`, `tailwind.config.*`
- Task mentions: UI, component, responsive, accessibility, a11y, performance, i18n
- `package.json` contains: `react`, `vue`, `svelte`, `@tanstack/react-query`, `tailwindcss`

---

## Decision Tree: Component Architecture

```
Building a UI component?
├── Is it purely presentational (no state, no side effects)?
│   └── Server Component (RSC) or static render — zero client JS
├── Does it need interactivity (click, hover, form input)?
│   └── Client Component with minimal state
├── Does it fetch data?
│   ├── Server-rendered page? → Fetch in Server Component, pass as props
│   ├── Client-side SPA? → TanStack Query (caching, dedup, revalidation)
│   └── Real-time data? → WebSocket/SSE + optimistic UI
├── Is it a form?
│   └── React Hook Form + Zod (validation) + Server Action (submission)
├── Is it a list > 100 items?
│   └── Virtualization (TanStack Virtual) — render only visible items
└── Is it a complex interactive widget (date picker, combobox)?
    └── Use Radix/Ark UI primitives — accessible by default
```

---

## Core Web Vitals Optimization (2026)

| Metric | Target | Key Optimizations |
|--------|--------|-------------------|
| **LCP** (Largest Contentful Paint) | < 2.5s | Preload hero image, SSR/SSG, font-display: swap |
| **INP** (Interaction to Next Paint) | < 200ms | Minimize main thread, use `startTransition`, web workers |
| **CLS** (Cumulative Layout Shift) | < 0.1 | Set explicit dimensions, no layout-shifting ads/embeds |

### LCP Optimization

```html
<!-- Preload critical hero image -->
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />

<!-- Responsive images with modern formats -->
<picture>
  <source srcset="/hero.avif" type="image/avif" />
  <source srcset="/hero.webp" type="image/webp" />
  <img src="/hero.jpg" alt="Hero" width="1200" height="600"
       fetchpriority="high" decoding="async" />
</picture>
```

### INP Optimization

```typescript
// Break up long tasks with scheduler
import { startTransition } from 'react';

function handleFilterChange(value: string) {
  // Urgent: update input immediately
  setInputValue(value);
  // Non-urgent: defer expensive filtering
  startTransition(() => {
    setFilteredResults(expensiveFilter(value, allItems));
  });
}

// Move heavy computation off main thread
const worker = new Worker(new URL('./search-worker.ts', import.meta.url));
worker.postMessage({ query, items });
worker.onmessage = (e) => setResults(e.data);
```

### CLS Prevention

```css
/* Always set explicit dimensions for media */
img, video, iframe { aspect-ratio: 16/9; width: 100%; height: auto; }

/* Reserve space for dynamic content */
.ad-slot { min-height: 250px; }
.skeleton { min-height: var(--expected-height); }
```

---

## Modern CSS (2026)

### Container Queries

```css
/* Component responds to its container, not viewport */
.card-container { container-type: inline-size; container-name: card; }

@container card (min-width: 400px) {
  .card { flex-direction: row; }
  .card-image { width: 40%; }
}

@container card (max-width: 399px) {
  .card { flex-direction: column; }
  .card-image { width: 100%; aspect-ratio: 16/9; }
}
```

### :has() Selector

```css
/* Style parent based on child state */
.form-group:has(input:invalid) { border-color: var(--color-error); }
.form-group:has(input:focus) { border-color: var(--color-primary); }

/* Conditional layouts */
.grid:has(> :nth-child(4)) { grid-template-columns: repeat(2, 1fr); }
.grid:has(> :nth-child(7)) { grid-template-columns: repeat(3, 1fr); }

/* Style sibling based on state */
input:invalid + .error-message { display: block; }
```

### CSS Layers (Cascade Control)

```css
/* Define layer order — later layers win */
@layer reset, base, components, utilities;

@layer reset { *, *::before, *::after { box-sizing: border-box; margin: 0; } }
@layer base { body { font-family: system-ui; line-height: 1.6; } }
@layer components { .btn { padding: 0.5rem 1rem; border-radius: 0.375rem; } }
@layer utilities { .sr-only { position: absolute; clip: rect(0,0,0,0); } }
```

### View Transitions

```css
/* Smooth page transitions (MPA and SPA) */
@view-transition { navigation: auto; }

::view-transition-old(root) { animation: fade-out 0.2s ease-out; }
::view-transition-new(root) { animation: fade-in 0.3s ease-in; }

/* Named transitions for specific elements */
.hero-image { view-transition-name: hero; }
```

---

## Accessibility Automation

```typescript
// vitest + axe-core for automated a11y testing
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('form has no accessibility violations', async () => {
  const { container } = render(<LoginForm />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

// Playwright a11y audit in E2E
import AxeBuilder from '@axe-core/playwright';

test('page passes a11y audit', async ({ page }) => {
  await page.goto('/dashboard');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

### Accessibility Checklist (Non-Negotiable)

- All images have `alt` text (decorative: `alt=""`)
- All form inputs have associated `<label>` elements
- Color is never the only way to convey information
- Minimum contrast: 4.5:1 normal text, 3:1 large text
- All interactive elements keyboard-accessible (Tab, Enter, Escape)
- Focus indicators visible — never `outline: none` without replacement
- Proper heading hierarchy (h1 → h2 → h3, no skipping)
- ARIA used correctly — prefer semantic HTML over ARIA
- `aria-live` for dynamic content announcements
- `prefers-reduced-motion` respected for animations

---

## Internationalization (i18n) Patterns

```typescript
// next-intl / react-intl pattern
import { useTranslations } from 'next-intl';

function ProductCard({ product }: { product: Product }) {
  const t = useTranslations('product');
  const format = useFormatter();

  return (
    <article>
      <h2>{product.name}</h2>
      <p>{t('inStock', { count: product.stock })}</p>
      {/* ICU MessageFormat: {count, plural, one {# item} other {# items}} */}
      <p>{format.number(product.price, { style: 'currency', currency: 'USD' })}</p>
      <p>{format.dateTime(product.createdAt, { dateStyle: 'medium' })}</p>
    </article>
  );
}
```

**i18n Rules:**
- Externalize ALL user-facing strings — never hardcode text
- Use ICU MessageFormat for pluralization and gender
- RTL support: use CSS logical properties (`margin-inline-start` not `margin-left`)
- Never concatenate translated strings — word order varies by language
- Use `Intl.DateTimeFormat` and `Intl.NumberFormat` with user's locale
- Pseudo-localization in dev to catch hardcoded strings and layout overflow

---

## Micro-Frontends

```
When to use micro-frontends?
├── Multiple teams owning different parts of the UI? → Consider it
├── Different release cadences per feature area? → Good fit
├── Single team, single app? → DON'T — adds massive complexity
└── Need to mix frameworks (legacy + new)? → Module Federation or iframe

Approaches (2026):
├── Module Federation (Webpack/Vite) — shared runtime, lazy-loaded remotes
├── Single-SPA — framework-agnostic orchestrator
├── Web Components — native encapsulation, any framework
├── Server-side composition — ESI, Fragments (Cloudflare Workers)
└── iframe (last resort) — full isolation but poor UX
```

---

## State Management Decision Tree

```
Need to store data?
├── Derived from props/other state? → Compute during render (no state)
├── Only used by this component? → useState / useReducer
├── Shared by 2-3 nearby components? → Lift state up
├── App-wide UI state (theme, sidebar)? → Zustand (minimal boilerplate)
├── Server data (API responses)? → TanStack Query (caching, revalidation)
├── Complex form state? → React Hook Form + Zod
├── URL-driven state? → useSearchParams / nuqs
└── Deeply nested prop threading? → Context (ONLY for rarely-changing values)
```

---

## Performance Budget

```
Initial load budget (mobile 4G):
├── HTML: < 14KB (first TCP roundtrip)
├── CSS: < 50KB (critical inlined, rest async)
├── JS: < 200KB gzipped (total initial bundle)
├── Images: < 500KB (above-the-fold, lazy-load rest)
├── Fonts: < 100KB (subset, preload, font-display: swap)
└── Total: < 1MB transferred, < 3s LCP on 4G

Tools:
├── bundlewatch — fail CI if bundle exceeds budget
├── Lighthouse CI — track CWV scores over time
├── web-vitals library — real user monitoring (RUM)
└── Chrome DevTools Performance panel — identify long tasks
```

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| `useEffect` to sync derived state | Compute during render or `useMemo` |
| Index as key for dynamic lists | Stable unique ID (`item.id`) |
| Prop drilling 4+ levels | Composition, Context, or Zustand |
| CSS-in-JS at runtime (Emotion) | Zero-runtime (Tailwind, CSS Modules, Panda) |
| Layout shifts from dynamic content | Reserve space with aspect-ratio/min-height |
| Blocking render with non-critical JS | Code split, defer, lazy load |
| Testing implementation details | Test user-facing behavior (Testing Library) |
| Ignoring reduced-motion preference | Wrap animations in `prefers-reduced-motion` |
| Hardcoded strings in components | i18n from day one |
| Giant monolithic CSS file | CSS layers + component-scoped styles |

---

## Verification Checklist

- [ ] Core Web Vitals pass (LCP < 2.5s, INP < 200ms, CLS < 0.1)
- [ ] Accessibility audit passes (axe-core, zero violations)
- [ ] Keyboard navigation works for all interactive elements
- [ ] Responsive at 320px, 768px, 1024px, 1440px
- [ ] Dark mode works correctly (if supported)
- [ ] Images use modern formats (WebP/AVIF) with fallbacks
- [ ] Bundle size within budget (< 200KB initial JS gzipped)
- [ ] No layout shifts from dynamic content
- [ ] i18n strings externalized, RTL tested
- [ ] Error, loading, and empty states handled for all data-fetching
