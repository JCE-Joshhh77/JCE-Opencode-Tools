---
name: design-systems
description: Design tokens, Storybook, theming, component API, variants. Use when working on design-systems tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Design Systems

## Auto-Detect

Trigger this skill when:
- Task mentions: design system, design tokens, Storybook, component library, theming, variants
- Files: `tokens/`, `*.stories.tsx`, `.storybook/`, `theme.*`, `design-system/`
- Patterns: component API design, variant patterns, accessibility in components
- Dependencies: `storybook`, `@radix-ui/*`, `class-variance-authority`, `@vanilla-extract/*`

---

## Decision Tree: Scope

```
What level of design system?
├── Just consistent styling?
│   └── Design tokens + Tailwind → No component library needed
├── Shared components within one app?
│   └── Local component library (src/components/) → No package needed
├── Shared across apps (same team)?
│   └── Internal package (@acme/ui) → Monorepo workspace
├── Shared across teams/orgs?
│   └── Published package + Storybook docs + Chromatic + versioning
└── Building on existing primitives?
    └── Radix UI / Headless UI (unstyled) + your tokens
```

## Decision Tree: Styling

```
├── Zero-runtime CSS? → Tailwind CSS 4 or Vanilla Extract
├── Runtime theming (user-switchable)? → CSS custom properties + Tailwind
├── TypeScript-first styling? → Vanilla Extract (build-time)
├── Maximum flexibility + DX? → Tailwind + CVA (class-variance-authority)
└── Framework-agnostic tokens? → W3C Design Tokens Format + Style Dictionary
```

---

## Design Tokens (W3C Format)

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "primitive": {
      "blue": {
        "500": { "$value": "#3b82f6", "$type": "color" },
        "600": { "$value": "#2563eb", "$type": "color" },
        "700": { "$value": "#1d4ed8", "$type": "color" }
      }
    },
    "semantic": {
      "primary": {
        "$value": "{color.primitive.blue.600}",
        "$type": "color",
        "$description": "Primary brand action color"
      },
      "primary-hover": {
        "$value": "{color.primitive.blue.700}",
        "$type": "color"
      }
    }
  },
  "spacing": {
    "xs": { "$value": "4px", "$type": "dimension" },
    "sm": { "$value": "8px", "$type": "dimension" },
    "md": { "$value": "16px", "$type": "dimension" },
    "lg": { "$value": "24px", "$type": "dimension" },
    "xl": { "$value": "32px", "$type": "dimension" }
  },
  "radius": {
    "sm": { "$value": "4px", "$type": "dimension" },
    "md": { "$value": "8px", "$type": "dimension" },
    "lg": { "$value": "12px", "$type": "dimension" },
    "full": { "$value": "9999px", "$type": "dimension" }
  }
}
```

### Tokens to CSS Variables

```css
/* Generated from tokens — light theme */
:root {
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-background: #ffffff;
  --color-foreground: #111827;
  --color-muted: #6b7280;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --radius-md: 8px;
}

/* Dark theme override */
[data-theme="dark"] {
  --color-primary: #3b82f6;
  --color-primary-hover: #60a5fa;
  --color-background: #0f172a;
  --color-foreground: #f8fafc;
  --color-muted: #94a3b8;
}
```

---

## Component API Design (CVA + Radix)

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

// Variant definitions with CVA
const buttonVariants = cva(
  // Base styles (always applied)
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        default: 'h-10 px-4 py-2',
        lg: 'h-11 px-8 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

// Component with polymorphic rendering (asChild pattern)
interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

function Button({ className, variant, size, asChild, loading, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? <><Spinner className="mr-2 h-4 w-4 animate-spin" />{children}</> : children}
    </Comp>
  );
}
```

### Compound Component Pattern

```tsx
// Usage: <Card><Card.Header>...</Card.Header><Card.Body>...</Card.Body></Card>
import { createContext, useContext } from 'react';

interface CardContextValue { variant: 'default' | 'outlined' | 'elevated' }
const CardContext = createContext<CardContextValue>({ variant: 'default' });

function Card({ variant = 'default', className, children, ...props }: CardProps) {
  return (
    <CardContext.Provider value={{ variant }}>
      <div className={cn(
        'rounded-lg border bg-card text-card-foreground',
        variant === 'elevated' && 'shadow-md',
        className
      )} {...props}>
        {children}
      </div>
    </CardContext.Provider>
  );
}

Card.Header = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
);

Card.Title = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
);

Card.Content = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-6 pt-0', className)} {...props} />
);

Card.Footer = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
);
```

---

## Storybook 8 Configuration

```typescript
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-interactions',
    '@chromatic-com/storybook',
  ],
  framework: '@storybook/react-vite',
};
export default config;
```

```tsx
// button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'destructive', 'outline', 'ghost', 'link'] },
    size: { control: 'select', options: ['sm', 'default', 'lg', 'icon'] },
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: 'Button' } };
export const Loading: Story = { args: { children: 'Saving...', loading: true } };

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(['default', 'destructive', 'outline', 'ghost', 'link'] as const).map(v => (
        <Button key={v} variant={v}>{v}</Button>
      ))}
    </div>
  ),
};

// Interaction test
export const ClickInteraction: Story = {
  args: { children: 'Click me' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    await userEvent.click(button);
    await expect(button).toHaveFocus();
  },
};
```

---

## Theming Strategy

```typescript
// Theme provider with CSS variable injection
function ThemeProvider({ children, theme = 'light' }: ThemeProviderProps) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

// Component consuming theme tokens via CSS variables (zero JS runtime cost)
// All components automatically respond to theme changes via CSS custom properties
// No re-renders needed — CSS handles the switch
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Boolean prop explosion | `<Button primary large disabled>` | CVA variants: `variant="primary" size="lg"` |
| Hardcoded colors in components | Cannot theme, inconsistent | Design tokens + CSS variables |
| No Storybook stories | Undocumented, untested visually | Story per variant + interaction tests |
| Wrapping native HTML poorly | Breaks a11y, loses features | Forward refs, spread props, Slot pattern |
| Inline styles for theming | No responsive, no hover states | Tailwind/CVA or CSS custom properties |
| No dark mode from day one | Expensive retrofit later | Semantic tokens with light/dark from start |
| Tight coupling to one framework | Cannot share React/Vue/Svelte | Headless logic + framework adapters |
| Skipping accessibility testing | Excludes users, legal risk | Storybook a11y addon + axe-core in CI |

---

## Verification Checklist

- [ ] All colors use semantic tokens (not raw hex in components)
- [ ] Dark mode works via CSS variable swap (no JS re-render)
- [ ] Every component has Storybook story with all variants
- [ ] Interaction tests cover keyboard navigation
- [ ] a11y addon shows no violations (axe-core)
- [ ] Components forward refs and spread remaining props
- [ ] CVA variants are exhaustive (no inline style overrides needed)
- [ ] Chromatic visual regression catches unintended changes
- [ ] Component API uses composition over configuration
- [ ] Tokens follow W3C Design Tokens format for portability
