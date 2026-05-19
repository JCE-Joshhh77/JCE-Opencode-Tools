---
name: tailwind
description: Tailwind CSS, utility-first styling, responsive design. Use when working on tailwind tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Tailwind CSS

## Auto-Detect

Trigger this skill when:
- Task mentions: Tailwind, utility classes, responsive design, dark mode CSS
- Files: `tailwind.config.*`, `postcss.config.*`, `app.css` with @tailwind directives
- Patterns: className with utility patterns, `cn()` helper, `twMerge`
- Dependencies: `tailwindcss`, `@tailwindcss/typography`, `tailwind-merge`, `class-variance-authority`

---

## Decision Tree: Configuration Approach

```
Which Tailwind version?
├── Tailwind CSS 4 (2025+)?
│   ├── CSS-first config (no tailwind.config.js needed)
│   ├── @theme directive in CSS for customization
│   ├── Automatic content detection (no content array)
│   └── Native container queries, 3D transforms
├── Tailwind CSS 3.x (legacy)?
│   ├── tailwind.config.js with content array
│   ├── JIT mode (default since 3.0)
│   └── Plugin-based extensions
└── Migrating 3 → 4?
    └── npx @tailwindcss/upgrade (automated codemods)
```

## Decision Tree: Dark Mode

```
├── User-controlled toggle? → class strategy (data-theme attribute)
├── Follow OS preference only? → media strategy (@media prefers-color-scheme)
├── Both (OS default + user override)? → class strategy + JS to sync with OS
└── Multiple themes (light/dark/dim/high-contrast)? → CSS variables + data-theme
```

---

## Tailwind CSS 4: CSS-First Config

```css
/* app.css — Tailwind 4 uses CSS for configuration */
@import "tailwindcss";

/* Custom theme values via @theme */
@theme {
  --color-brand-50: #eff6ff;
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
  --color-brand-900: #1e3a5f;

  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  --spacing-18: 4.5rem;
  --spacing-88: 22rem;

  --radius-lg: 12px;
  --radius-xl: 16px;

  --animate-fade-in: fade-in 0.3s ease-in-out;
  --animate-slide-up: slide-up 0.3s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-up {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Dark mode via CSS variables */
@variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

---

## Responsive Design (Mobile-First)

```html
<!-- Breakpoints: sm(640) md(768) lg(1024) xl(1280) 2xl(1536) -->

<!-- Responsive grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
  <div class="p-4">Card</div>
</div>

<!-- Stack on mobile, row on desktop -->
<div class="flex flex-col md:flex-row md:items-center gap-4">
  <img class="w-full md:w-48 h-48 object-cover rounded-lg" src="..." alt="..." />
  <div class="flex-1">
    <h2 class="text-lg md:text-2xl font-bold">Title</h2>
    <p class="text-sm md:text-base text-gray-600">Description</p>
  </div>
</div>

<!-- Container queries (Tailwind 4 native) -->
<div class="@container">
  <div class="flex flex-col @md:flex-row @lg:grid @lg:grid-cols-3 gap-4">
    <!-- Responds to container width, not viewport -->
  </div>
</div>

<!-- Auto-fill grid (no breakpoints needed) -->
<div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
  <!-- Cards auto-wrap based on available space -->
</div>
```

---

## Dark Mode

```html
<!-- Class strategy with data attribute -->
<html data-theme="dark">
  <body class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
    <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <p class="text-gray-600 dark:text-gray-400">Adapts to theme</p>
    </div>
  </body>
</html>
```

```typescript
// Theme toggle with OS preference detection
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored as 'light' | 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return { theme, toggle: () => setTheme(t => t === 'light' ? 'dark' : 'light') };
}
```

---

## Common Patterns

```html
<!-- Centering -->
<div class="grid place-items-center min-h-screen">Centered</div>

<!-- Sticky header + scrollable content -->
<div class="h-screen flex flex-col">
  <header class="sticky top-0 z-10 bg-white/80 backdrop-blur border-b px-4 py-3">Nav</header>
  <main class="flex-1 overflow-y-auto p-6">Content</main>
</div>

<!-- Card with hover effect -->
<div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden
            border border-gray-100 dark:border-gray-700
            hover:shadow-xl transition-shadow duration-300">
  <img class="w-full h-48 object-cover" src="..." alt="..." />
  <div class="p-6">
    <h3 class="text-lg font-semibold">Title</h3>
    <p class="mt-2 text-gray-600 dark:text-gray-400 line-clamp-2">Description</p>
  </div>
</div>

<!-- Group and peer modifiers -->
<div class="group cursor-pointer p-4 hover:bg-gray-50 rounded-lg">
  <h3 class="group-hover:text-blue-600 transition-colors">Hover parent</h3>
  <p class="group-hover:translate-x-1 transition-transform">Child reacts</p>
</div>

<input class="peer" type="checkbox" id="toggle" />
<label for="toggle" class="peer-checked:text-blue-600 peer-checked:font-bold">
  Checked state
</label>

<!-- Arbitrary values (escape hatch) -->
<div class="top-[117px] w-[calc(100%-2rem)] bg-[#1a1a2e] text-[13px]">
  One-off values when theme doesn't cover it
</div>
```

---

## Integration with React/Vue

```tsx
// cn() utility — merge + deduplicate Tailwind classes
import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Component with variant support
function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
      variant === 'default' && 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      variant === 'success' && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      variant === 'danger' && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      className // Allow override from parent
    )}>
      {children}
    </span>
  );
}
```

---

## Performance

```
Tailwind 4 optimizations (automatic):
├── Only generates used classes (no purge config needed)
├── Automatic content detection (scans project files)
├── Lightning CSS engine (10x faster than PostCSS)
├── Incremental builds (only recompile changed files)
└── Tiny production bundles (typically 5-15KB gzipped)

Best practices:
├── Use prettier-plugin-tailwindcss for consistent class order
├── Avoid @apply (extract components instead)
├── Use CSS variables for dynamic values (not arbitrary values)
├── Prefer semantic color names in @theme (brand, surface, muted)
└── Install @tailwindcss/typography for prose content
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Excessive @apply | Defeats utility-first purpose | Extract React/Vue components instead |
| Arbitrary values everywhere | Hard to maintain, no consistency | Extend @theme with proper tokens |
| Not using tailwind-merge | Conflicting classes from props | Always use cn() for dynamic classes |
| Desktop-first responsive | Breaks on mobile, harder to maintain | Mobile-first: base → sm → md → lg |
| Hardcoded colors in markup | Cannot theme, inconsistent | Semantic names in @theme (brand, muted) |
| Deep nesting of arbitrary | Unreadable class strings | Simplify or extract to component |
| Ignoring dark mode | Excludes users, looks broken | Add dark: variants from the start |
| No class sorting | Inconsistent, hard to scan | prettier-plugin-tailwindcss |

---

## Verification Checklist

- [ ] @theme defines all custom colors, spacing, fonts (no magic values)
- [ ] Dark mode works correctly (test both themes)
- [ ] Responsive design tested at all breakpoints (mobile-first)
- [ ] Container queries used where component-level responsiveness needed
- [ ] cn() utility used for all dynamic/conditional classes
- [ ] No @apply in component styles (components extracted instead)
- [ ] prettier-plugin-tailwindcss configured for class sorting
- [ ] Production bundle size < 20KB gzipped
- [ ] Accessibility: focus-visible styles on all interactive elements
- [ ] Typography plugin used for prose/article content
