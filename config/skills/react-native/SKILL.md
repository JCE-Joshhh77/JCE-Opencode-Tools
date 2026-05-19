---
name: react-native
description: React Native, Expo, mobile apps. Use when working on react-native tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: React Native
# Loaded on-demand when working with React Native, Expo, mobile apps

## Auto-Detect

Trigger this skill when:
- Files: `app.json` with `"expo"`, `metro.config.js`, `react-native.config.js`
- Dependencies: `react-native`, `expo`, `@react-navigation/*`
- File patterns: `*.native.tsx`, `app/(tabs)/`, `expo-router`
- Tools: EAS CLI, Metro bundler, Expo Dev Client

---

## Decision Tree: Project Setup

```
Starting a new mobile app?
+-- Need native modules / custom native code?
|   +-- Yes, but want Expo DX? -> Expo Dev Client (managed + native)
|   +-- Full native control? -> Bare React Native (rare)
+-- Standard app (camera, maps, auth)?
|   +-- Expo managed workflow (default choice)
+-- Need OTA updates?
|   +-- EAS Update (Expo) or CodePush (bare)
+-- Targeting web too?
    +-- Expo Router + React Native Web
```

## Decision Tree: Navigation

```
Which navigation approach?
+-- File-based routing (like Next.js)? -> Expo Router v4
+-- Imperative, full control? -> React Navigation 7
+-- Deep linking required? -> Expo Router (built-in) or RN linking config
+-- Tab + Stack combo? -> Expo Router with (tabs) directory
```

## Decision Tree: State & Data

```
How to manage state?
+-- Server data (API)? -> TanStack Query + fetch/axios
+-- Global UI state? -> Zustand (lightweight, no provider)
+-- Form state? -> React Hook Form
+-- Persistent local data? -> MMKV (sync) or WatermelonDB (relational)
+-- Auth tokens? -> expo-secure-store
```

---

## React Native 0.76 (New Architecture)

```tsx
// New Architecture is now DEFAULT in RN 0.76+
// - Fabric: new rendering system (concurrent features)
// - TurboModules: lazy-loaded native modules
// - Codegen: type-safe bridge from TypeScript specs

// Fabric-compatible component
import { View, Text, StyleSheet } from 'react-native';

interface CardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Card({ title, subtitle, children }: CardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3, // Android shadow
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 12 },
});
```

---

## Expo Router v4

```tsx
// app/_layout.tsx — root layout
import { Stack } from 'expo-router';
import { ThemeProvider } from '@/providers/theme';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}

// app/(tabs)/_layout.tsx — tab navigation
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#007AFF' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

// app/(tabs)/index.tsx — screen component
import { Link } from 'expo-router';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Welcome</Text>
      <Link href="/product/123" asChild>
        <Pressable style={styles.button}>
          <Text>View Product</Text>
        </Pressable>
      </Link>
    </View>
  );
}

// app/product/[id].tsx — dynamic route
import { useLocalSearchParams } from 'expo-router';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // fetch product by id...
}

// Type-safe navigation
import { router } from 'expo-router';
router.push('/product/123');
router.replace('/(auth)/login');
router.back();
```

---

## Reanimated 3 (Animations)

```tsx
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Swipeable card with spring physics
function SwipeableCard({ onDismiss }: { onDismiss: () => void }) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > 150) {
        translateX.value = withTiming(e.translationX > 0 ? 500 : -500, {}, () => {
          runOnJS(onDismiss)();
        });
        opacity.value = withTiming(0);
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { rotate: `${interpolate(translateX.value, [-200, 200], [-15, 15], Extrapolation.CLAMP)}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animatedStyle]}>
        <Text>Swipe to dismiss</Text>
      </Animated.View>
    </GestureDetector>
  );
}

// Shared element transitions (Expo Router)
import { SharedTransition } from 'react-native-reanimated';

// In list screen
<Animated.Image
  sharedTransitionTag={`product-${item.id}`}
  source={{ uri: item.image }}
/>

// In detail screen — same tag, automatic transition
<Animated.Image
  sharedTransitionTag={`product-${id}`}
  source={{ uri: product.image }}
/>
```

---

## Performance Patterns

```tsx
import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo } from 'react';

// FlashList — 5x faster than FlatList for large lists
function ProductList({ products }: { products: Product[] }) {
  const renderItem = useCallback(({ item }: { item: Product }) => (
    <ProductCard product={item} />
  ), []);

  return (
    <FlashList
      data={products}
      renderItem={renderItem}
      estimatedItemSize={120}
      keyExtractor={(item) => item.id}
    />
  );
}

// Image optimization with expo-image
import { Image } from 'expo-image';

<Image
  source={{ uri: imageUrl }}
  style={styles.image}
  contentFit="cover"
  placeholder={blurhash}        // Blurhash placeholder
  transition={200}              // Fade-in animation
  cachePolicy="memory-disk"     // Aggressive caching
/>

// Avoid re-renders — stable references
function ParentComponent() {
  // Memoize callbacks passed to children
  const handlePress = useCallback((id: string) => {
    router.push(`/product/${id}`);
  }, []);

  // Memoize expensive computations
  const sortedProducts = useMemo(
    () => products.sort((a, b) => b.rating - a.rating),
    [products]
  );

  return <ProductList products={sortedProducts} onPress={handlePress} />;
}
```

---

## EAS Build & Updates

```json
// eas.json — build profiles
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview"
    },
    "production": {
      "channel": "production",
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "team@example.com", "ascAppId": "123456789" },
      "android": { "serviceAccountKeyPath": "./google-sa.json", "track": "internal" }
    }
  }
}
```

```bash
# Development build (includes dev client)
eas build --platform ios --profile development

# Production build
eas build --platform all --profile production

# OTA update (no store review needed for JS changes)
eas update --branch production --message "Fix checkout crash"

# Submit to stores
eas submit --platform all --profile production
```

---

## Testing

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

// Component test
test('displays product details', () => {
  render(<ProductCard product={mockProduct} />);
  expect(screen.getByText('Widget')).toBeTruthy();
  expect(screen.getByText('$29.99')).toBeTruthy();
});

// Interaction test
test('add to cart button calls handler', () => {
  const onAdd = jest.fn();
  render(<ProductCard product={mockProduct} onAddToCart={onAdd} />);
  fireEvent.press(screen.getByRole('button', { name: /add to cart/i }));
  expect(onAdd).toHaveBeenCalledWith(mockProduct.id);
});

// Navigation test with Expo Router
test('navigates to product detail', async () => {
  const { getByText } = renderRouter(
    { index: () => <ProductList />, 'product/[id]': () => <ProductDetail /> },
    { initialUrl: '/' }
  );
  fireEvent.press(getByText('Widget'));
  await waitFor(() => expect(getByText('Product Details')).toBeTruthy());
});
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Inline styles in lists | New object every render, no caching | `StyleSheet.create` outside component |
| `FlatList` for 1000+ items | Slow, high memory | `FlashList` with `estimatedItemSize` |
| Animations on JS thread | Janky 30fps animations | Reanimated worklets (UI thread) |
| `AsyncStorage` for large data | Slow, blocks JS thread | MMKV (sync) or SQLite |
| No error boundaries | White screen on crash | Wrap screens with error boundaries |
| Fetching in `useEffect` without cleanup | Memory leaks, race conditions | TanStack Query or AbortController |
| Platform-specific code in one file | Unreadable conditionals | `.ios.tsx` / `.android.tsx` files |
| No Hermes engine | Slower startup, higher memory | Hermes is default — don't disable it |

---

## Verification Checklist

Before considering React Native work done:
- [ ] Runs on both iOS and Android (test both)
- [ ] Expo prebuild succeeds: `npx expo prebuild --clean`
- [ ] No yellow box warnings in development
- [ ] FlashList used for lists > 50 items
- [ ] Animations run on UI thread (Reanimated worklets)
- [ ] Images use `expo-image` with caching and placeholders
- [ ] Deep links work: `npx uri-scheme open myapp://path`
- [ ] EAS build succeeds for all profiles
- [ ] Tests pass: `jest --passWithNoTests`
- [ ] Accessibility: labels on all interactive elements
- [ ] Performance: no JS thread drops below 50fps in profiler
