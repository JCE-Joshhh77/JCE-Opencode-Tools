---
name: vue
description: Vue 3, Composition API, Pinia, Nuxt. Use when working on vue tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Vue.js
# Loaded on-demand when working with .vue files, Vue 3, Nuxt

## Auto-Detect

Trigger this skill when:
- File extensions: `.vue`
- `package.json` contains: `vue`, `nuxt`, `@vue/`, `pinia`, `vite`
- Imports from: `vue`, `@vue/reactivity`, `pinia`
- Directory patterns: `composables/`, `pages/`, `components/`

---

## Decision Tree: State Management

```
Need to store data?
├── Derived from other state? → computed() (no extra state needed)
├── Only used by this component? → ref() / reactive()
├── Shared by parent-child? → props + emit (one-way data flow)
├── Shared by 2-3 nearby components? → Lift state up or provide/inject
├── App-wide UI state (theme, auth, cart)? → Pinia store
├── Server data (API responses)? → VueQuery / Nuxt useFetch
├── Complex form state? → VeeValidate + Zod or FormKit
├── URL-driven state? → useRoute().query / useUrlSearchParams (VueUse)
└── Cross-component events? → Pinia action or composable (NOT event bus)
```

## Decision Tree: Reactivity Primitive

```
What kind of data?
├── Primitive (string, number, boolean)? → ref()
├── Object/Array you'll mutate deeply? → reactive()
├── Large immutable dataset (replace, not mutate)? → shallowRef()
├── Computed from other reactive sources? → computed()
├── Need writable computed? → computed({ get, set })
├── Prop that supports v-model? → defineModel() (Vue 3.4+)
└── Need to watch for side effects? → watch() or watchEffect()
```

---

## Vue 3.5+ Patterns

```vue
<script setup lang="ts">
import { ref, reactive, computed, watch, watchEffect, useTemplateRef } from 'vue';

// ref: single values, access via .value in script
const count = ref(0);
count.value++; // .value in script, auto-unwrapped in template

// reactive: objects, deep reactive, no .value
const state = reactive({ name: 'Alice', items: [] as string[] });
state.name = 'Bob'; // direct mutation

// computed: cached derived state
const doubled = computed(() => count.value * 2);

// Writable computed
const fullName = computed({
  get: () => `${state.firstName} ${state.lastName}`,
  set: (val: string) => {
    const [first, ...rest] = val.split(' ');
    state.firstName = first;
    state.lastName = rest.join(' ');
  },
});

// useTemplateRef (Vue 3.5+) — type-safe template refs
const inputRef = useTemplateRef<HTMLInputElement>('input');
// <input ref="input" /> in template

// watch: explicit source, old/new values
watch(count, (newVal, oldVal) => {
  console.log(`Changed from ${oldVal} to ${newVal}`);
}, { immediate: true });

// watchEffect: auto-tracks all reactive deps
watchEffect(() => {
  document.title = `Count: ${count.value}`;
});

// watch with cleanup (Vue 3.5+ onWatcherCleanup)
import { onWatcherCleanup } from 'vue';
watch(searchQuery, (query) => {
  const controller = new AbortController();
  fetchResults(query, { signal: controller.signal });
  onWatcherCleanup(() => controller.abort());
});
</script>
```

### defineModel (Vue 3.4+)

```vue
<!-- CustomInput.vue — replaces modelValue + emit pattern -->
<script setup lang="ts">
// Single v-model
const model = defineModel<string>({ required: true });

// Named v-model: v-model:title="..."
const title = defineModel<string>('title');

// With transform/validation
const count = defineModel<number>({ default: 0, set(val) { return Math.max(0, val); } });
</script>

<template>
  <input v-model="model" />
</template>

<!-- Parent usage -->
<!-- <CustomInput v-model="searchQuery" /> -->
```

### Typed Slots (Vue 3.3+)

```vue
<script setup lang="ts">
// Typed slots with defineSlots
const slots = defineSlots<{
  default(props: { item: User; index: number }): any;
  header(props: { count: number }): any;
  empty(): any;
}>();
</script>

<template>
  <div>
    <slot name="header" :count="items.length" />
    <div v-for="(item, i) in items" :key="item.id">
      <slot :item="item" :index="i" />
    </div>
    <slot name="empty" v-if="items.length === 0" />
  </div>
</template>
```

### defineOptions & defineExpose

```vue
<script setup lang="ts">
// defineOptions — set component options without separate <script> block
defineOptions({ name: 'UserCard', inheritAttrs: false });

// defineExpose — explicitly expose methods/state to parent via template ref
const reset = () => { /* ... */ };
const validate = () => { /* ... */ };
defineExpose({ reset, validate });
</script>
```

---

## Composables (Custom Hooks)

```ts
// composables/useFetch.ts
import { ref, toValue, watchEffect, type MaybeRefOrGetter } from 'vue';

export function useFetch<T>(url: MaybeRefOrGetter<string>) {
  const data = ref<T | null>(null);
  const error = ref<Error | null>(null);
  const loading = ref(false);

  async function execute() {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch(toValue(url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data.value = await response.json();
    } catch (e) {
      error.value = e as Error;
    } finally {
      loading.value = false;
    }
  }

  watchEffect(() => { toValue(url); execute(); });
  return { data, error, loading, execute };
}

// composables/useIntersectionObserver.ts
export function useIntersectionObserver(
  target: MaybeRefOrGetter<HTMLElement | null>,
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit
) {
  const isIntersecting = ref(false);
  let observer: IntersectionObserver | null = null;

  watchEffect((onCleanup) => {
    const el = toValue(target);
    if (!el) return;
    observer = new IntersectionObserver((entries, obs) => {
      isIntersecting.value = entries.some(e => e.isIntersecting);
      callback(entries, obs);
    }, options);
    observer.observe(el);
    onCleanup(() => observer?.disconnect());
  });

  return { isIntersecting };
}
```

---

## Pinia State Management

```ts
// stores/useCartStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useCartStore = defineStore('cart', () => {
  // State
  const items = ref<CartItem[]>([]);
  const coupon = ref<string | null>(null);

  // Getters (computed)
  const total = computed(() =>
    items.value.reduce((sum, i) => sum + i.price * i.qty, 0)
  );
  const itemCount = computed(() =>
    items.value.reduce((sum, i) => sum + i.qty, 0)
  );

  // Actions
  function addItem(product: Product) {
    const existing = items.value.find(i => i.id === product.id);
    if (existing) existing.qty++;
    else items.value.push({ ...product, qty: 1 });
  }

  function removeItem(id: string) {
    items.value = items.value.filter(i => i.id !== id);
  }

  async function checkout() {
    const response = await api.post('/orders', { items: items.value, coupon: coupon.value });
    items.value = [];
    coupon.value = null;
    return response.data;
  }

  // Persist with plugin: https://prazdevs.github.io/pinia-plugin-persistedstate/
  return { items, coupon, total, itemCount, addItem, removeItem, checkout };
});

// Component usage — destructure with storeToRefs for reactivity
import { storeToRefs } from 'pinia';
const cart = useCartStore();
const { items, total } = storeToRefs(cart); // reactive refs
cart.addItem(product); // actions called directly
```

---

## Nuxt 4 Patterns

```vue
<!-- pages/users/[id].vue -->
<script setup lang="ts">
// Auto-imported composables — no import needed
const route = useRoute();

// useFetch: SSR-friendly, auto-deduped, cached, typed
const { data: user, status, error, refresh } = await useFetch<User>(
  `/api/users/${route.params.id}`,
  { watch: [() => route.params.id] } // re-fetch on param change
);

// useAsyncData: custom fetching logic
const { data: stats } = await useAsyncData('user-stats', () => {
  return $fetch(`/api/users/${route.params.id}/stats`);
}, {
  transform: (data) => ({ ...data, computed: data.a + data.b }),
  getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key], // SWR pattern
});

// useLazyFetch: non-blocking (doesn't await, renders immediately)
const { data: recommendations, pending } = useLazyFetch('/api/recommendations');
</script>

<template>
  <div v-if="status === 'error'">Error: {{ error?.message }}</div>
  <div v-else-if="status === 'pending'">Loading...</div>
  <div v-else>
    <h1>{{ user?.name }}</h1>
    <button @click="refresh()">Refresh</button>
  </div>
</template>
```

```ts
// server/api/users/[id].get.ts — Nitro server route
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw createError({ statusCode: 404, message: 'User not found' });
  return user;
});

// server/api/users/index.post.ts — with validation
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, schema.parse);
  return await db.user.create({ data: body });
});
```

### Nuxt Middleware & Plugins

```ts
// middleware/auth.ts — route middleware
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession();
  if (!loggedIn.value && to.path !== '/login') {
    return navigateTo('/login');
  }
});

// plugins/api.ts — global plugin
export default defineNuxtPlugin(() => {
  const api = $fetch.create({
    baseURL: useRuntimeConfig().public.apiBase,
    onRequest({ options }) {
      const token = useCookie('token');
      if (token.value) options.headers.set('Authorization', `Bearer ${token.value}`);
    },
  });
  return { provide: { api } };
});
```

---

## Vapor Mode (Vue 3.6+ — Experimental)

```vue
<!-- Opt-in per component for maximum performance -->
<!-- No virtual DOM — compiles to direct DOM operations -->
<script setup lang="ts" vapor>
// Same Composition API, but compiled differently
const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>

<template>
  <button @click="count++">{{ count }} ({{ doubled }})</button>
</template>

<!-- Benefits: smaller bundle, faster updates, no VDOM diffing overhead -->
<!-- Use for: performance-critical components (large lists, animations) -->
<!-- Limitations: some directives/features may not be supported initially -->
```

---

## Performance Optimization

```vue
<script setup>
import { shallowRef, triggerRef, defineAsyncComponent } from 'vue';

// shallowRef: only track .value replacement, not deep mutations
const largeList = shallowRef<Item[]>([]);
largeList.value = [...largeList.value, newItem]; // triggers update

// Async components with loading/error states
const HeavyChart = defineAsyncComponent({
  loader: () => import('./HeavyChart.vue'),
  loadingComponent: ChartSkeleton,
  errorComponent: ChartError,
  delay: 200,
  timeout: 10000,
});
</script>

<template>
  <!-- v-once: render once, never update -->
  <footer v-once>{{ staticContent }}</footer>

  <!-- v-memo: skip re-render unless deps change -->
  <div v-for="item in list" :key="item.id" v-memo="[item.selected]">
    <HeavyComponent :item="item" />
  </div>

  <!-- Teleport for modals/tooltips (avoids z-index issues) -->
  <Teleport to="body">
    <Modal v-if="showModal" @close="showModal = false" />
  </Teleport>
</template>
```

---

## Testing

```ts
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { describe, it, expect, vi } from 'vitest';
import UserList from './UserList.vue';

describe('UserList', () => {
  it('renders users and handles click', async () => {
    const wrapper = mount(UserList, {
      props: { users: [{ id: '1', name: 'Alice' }] },
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn })],
      },
    });

    expect(wrapper.text()).toContain('Alice');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('select')).toHaveLength(1);
    expect(wrapper.emitted('select')![0]).toEqual(['1']);
  });

  it('shows loading state', () => {
    const wrapper = mount(UserList, { props: { users: [], loading: true } });
    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(true);
  });
});
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Mutate props directly | Emit event to parent |
| Options API mixins | Composables (explicit, typed, traceable) |
| `reactive()` for primitives | `ref()` for primitives |
| Forget `.value` in script | Use Volar for IDE warnings |
| `watch` without cleanup for async | Use `onWatcherCleanup` or AbortController |
| Vuex in new projects | Pinia (official, simpler, typed) |
| `v-if` + `v-for` on same element | Use `<template v-for>` with `v-if` inside |
| Event bus (`mitt`) for state | Pinia store or provide/inject |
| Destructure `reactive()` directly | Use `toRefs()` to maintain reactivity |
| Global state in composable module scope | Pinia store (SSR-safe, devtools) |

---

## Verification Checklist

Before considering Vue work done:
- [ ] All reactive state uses correct primitive (ref vs reactive vs shallowRef)
- [ ] Composables follow `use` prefix convention and return reactive refs
- [ ] Props are typed with `defineProps<T>()` — no runtime validation objects
- [ ] Events are typed with `defineEmits<T>()`
- [ ] v-model uses `defineModel()` (Vue 3.4+)
- [ ] No prop mutation — emit events for parent state changes
- [ ] Pinia stores use composition API style (setup stores)
- [ ] Async operations have proper cleanup (AbortController, onWatcherCleanup)
- [ ] Large lists use `v-memo` or `shallowRef` for performance
- [ ] Tests cover component behavior, not implementation details
- [ ] Nuxt: `useFetch`/`useAsyncData` used instead of raw fetch in components
- [ ] Accessibility: semantic HTML, proper ARIA, keyboard navigation
