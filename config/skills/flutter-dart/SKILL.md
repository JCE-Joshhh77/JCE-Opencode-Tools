---
name: flutter-dart
description: Flutter, Dart, widgets, Riverpod. Use when working on flutter-dart tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Flutter & Dart
# Loaded on-demand when working with .dart files, Flutter, widgets

## Auto-Detect

Trigger this skill when:
- File extensions: `.dart`, `pubspec.yaml`, `analysis_options.yaml`
- Frameworks: Flutter, Riverpod, Bloc, GetX
- Tools: `flutter` CLI, `dart` CLI, `build_runner`
- Patterns: `Widget`, `StatelessWidget`, `StatefulWidget`, `ConsumerWidget`

---

## Decision Tree: State Management

```
What state do you need?
+-- Local widget state (counter, toggle)?
|   +-- StatefulWidget + setState (simple)
|   +-- Hooks (flutter_hooks) for reusable logic
+-- Shared app state?
|   +-- Riverpod 3 (recommended — compile-safe, testable)
|   +-- Bloc (enterprise, event-driven, verbose)
|   +-- Provider (legacy — migrate to Riverpod)
+-- Server/async data?
|   +-- Riverpod AsyncNotifier / FutureProvider
|   +-- Bloc + Repository pattern
+-- Form state?
|   +-- flutter_form_builder or reactive_forms
+-- Navigation state?
    +-- GoRouter (declarative, deep linking)
    +-- auto_route (code generation)
```

## Decision Tree: Architecture

```
How to structure the app?
+-- Small app (< 10 screens)? -> Feature folders + Riverpod
+-- Medium app? -> Clean Architecture (data/domain/presentation)
+-- Large team? -> Feature-first modules + dependency injection
+-- Need offline-first? -> Repository pattern + local DB (Drift/Isar)
```

---

## Flutter 3.27 / Dart 3.6 Patterns

```dart
// Dart 3.6 — sealed classes for exhaustive pattern matching
sealed class Result<T> {
  const Result();
}

class Success<T> extends Result<T> {
  final T value;
  const Success(this.value);
}

class Failure<T> extends Result<T> {
  final AppError error;
  const Failure(this.error);
}

// Exhaustive switch — compiler enforces all cases handled
Widget buildResult(Result<User> result) => switch (result) {
  Success(:final value) => UserCard(user: value),
  Failure(:final error) => ErrorWidget(error: error),
};

// Records — lightweight tuples with named fields
typedef UserWithPosts = ({User user, List<Post> posts});

Future<UserWithPosts> fetchUserData(String id) async {
  final (user, posts) = await (
    userRepo.find(id),
    postRepo.findByUser(id),
  ).wait;  // Parallel futures
  return (user: user, posts: posts);
}

// Pattern matching in if-case
if (json case {'user': {'name': String name, 'age': int age}}) {
  print('$name is $age years old');
}

// Extension types — zero-cost wrappers (Dart 3.3+)
extension type UserId(String value) {
  UserId.generate() : this(const Uuid().v4());
  bool get isValid => value.isNotEmpty;
}

extension type Email(String value) {
  bool get isValid => value.contains('@');
}

// Class modifiers
final class AppConfig {  // Cannot be extended or implemented
  final String apiUrl;
  final Duration timeout;
  const AppConfig({required this.apiUrl, this.timeout = const Duration(seconds: 30)});
}

interface class Repository<T> {  // Can only be implemented, not extended
  Future<T?> find(String id);
  Future<T> save(T entity);
  Future<void> delete(String id);
}
```

---

## Riverpod 3

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'providers.g.dart';

// Code-generated providers (Riverpod 3 — annotation-based)
@riverpod
class AuthNotifier extends _$AuthNotifier {
  @override
  AuthState build() => const AuthState.unauthenticated();

  Future<void> login(String email, String password) async {
    state = const AuthState.loading();
    try {
      final user = await ref.read(authRepositoryProvider).login(email, password);
      state = AuthState.authenticated(user);
    } catch (e) {
      state = AuthState.error(e.toString());
    }
  }

  void logout() {
    ref.read(authRepositoryProvider).logout();
    state = const AuthState.unauthenticated();
  }
}

// Async provider with auto-dispose and caching
@riverpod
Future<List<Product>> products(Ref ref, {String? category}) async {
  final repo = ref.read(productRepositoryProvider);
  // Auto-cancels when provider is disposed
  final link = ref.keepAlive();
  // Cache for 5 minutes
  final timer = Timer(const Duration(minutes: 5), link.close);
  ref.onDispose(timer.cancel);

  return repo.fetchProducts(category: category);
}

// Consuming in widgets
class ProductListScreen extends ConsumerWidget {
  const ProductListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final productsAsync = ref.watch(productsProvider());

    return productsAsync.when(
      data: (products) => ListView.builder(
        itemCount: products.length,
        itemBuilder: (_, i) => ProductTile(product: products[i]),
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, stack) => ErrorWidget(message: err.toString()),
    );
  }
}
```

---

## Impeller Renderer & Performance

```dart
// Impeller is the DEFAULT renderer in Flutter 3.27
// No shader compilation jank — all shaders pre-compiled

// Performance best practices
class OptimizedList extends StatelessWidget {
  const OptimizedList({super.key, required this.items});
  final List<Item> items;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: items.length,
      // Provide exact item extent for better scroll performance
      itemExtent: 72.0,
      itemBuilder: (context, index) => _ItemTile(item: items[index]),
    );
  }
}

// RepaintBoundary — isolate expensive repaints
class ExpensiveChart extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(painter: ChartPainter(data: data)),
    );
  }
}

// const constructors — prevent unnecessary rebuilds
class AppTheme {
  static const primaryButton = ButtonStyle(
    backgroundColor: WidgetStatePropertyAll(Colors.blue),
    foregroundColor: WidgetStatePropertyAll(Colors.white),
    padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 24, vertical: 12)),
  );
}

// Avoid rebuilding entire tree — push state down
// BAD: setState high in tree
// GOOD: Riverpod select() for granular rebuilds
final userName = ref.watch(userProvider.select((u) => u.name));
```

---

## Platform Channels & Deep Linking

```dart
// Method channel — call native code
import 'package:flutter/services.dart';

class NativeBridge {
  static const _channel = MethodChannel('com.example.app/native');

  static Future<String> getBatteryLevel() async {
    try {
      final result = await _channel.invokeMethod<int>('getBatteryLevel');
      return '$result%';
    } on PlatformException catch (e) {
      return 'Failed: ${e.message}';
    }
  }

  // Event channel — stream from native
  static const _eventChannel = EventChannel('com.example.app/sensors');

  static Stream<double> get accelerometerStream =>
      _eventChannel.receiveBroadcastStream().map((event) => event as double);
}

// Deep linking with GoRouter
final router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
    GoRoute(
      path: '/product/:id',
      builder: (_, state) => ProductScreen(id: state.pathParameters['id']!),
    ),
    ShellRoute(
      builder: (_, __, child) => ScaffoldWithNav(child: child),
      routes: [
        GoRoute(path: '/home', builder: (_, __) => const HomeTab()),
        GoRoute(path: '/search', builder: (_, __) => const SearchTab()),
        GoRoute(path: '/profile', builder: (_, __) => const ProfileTab()),
      ],
    ),
  ],
  redirect: (context, state) {
    final isLoggedIn = /* check auth */;
    if (!isLoggedIn && !state.matchedLocation.startsWith('/auth')) {
      return '/auth/login';
    }
    return null;
  },
);
```

---

## Testing

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';

// Unit test
test('UserId validates non-empty', () {
  expect(() => UserId(''), throwsA(isA<AssertionError>()));
  expect(UserId('abc').value, 'abc');
});

// Widget test with Riverpod overrides
testWidgets('shows products when loaded', (tester) async {
  final mockProducts = [Product(id: '1', name: 'Widget', price: 9.99)];

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        productsProvider().overrideWith((_) async => mockProducts),
      ],
      child: const MaterialApp(home: ProductListScreen()),
    ),
  );

  await tester.pumpAndSettle();
  expect(find.text('Widget'), findsOneWidget);
  expect(find.text('\$9.99'), findsOneWidget);
});

// Integration test
testWidgets('add to cart flow', (tester) async {
  await tester.pumpWidget(const MyApp());
  await tester.pumpAndSettle();

  await tester.tap(find.text('Widget'));
  await tester.pumpAndSettle();

  await tester.tap(find.byIcon(Icons.add_shopping_cart));
  await tester.pumpAndSettle();

  expect(find.text('1 item in cart'), findsOneWidget);
});

// Golden test (visual regression)
testWidgets('ProductCard matches golden', (tester) async {
  await tester.pumpWidget(
    MaterialApp(home: ProductCard(product: mockProduct)),
  );
  await expectLater(
    find.byType(ProductCard),
    matchesGoldenFile('goldens/product_card.png'),
  );
});
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| `setState` high in widget tree | Rebuilds entire subtree | Push state down, use Riverpod select |
| No `const` constructors | Unnecessary widget rebuilds | Add `const` everywhere possible |
| `ListView(children: [...])` | Builds all items upfront | `ListView.builder` for dynamic lists |
| Business logic in widgets | Untestable, tightly coupled | Notifiers/Blocs with repository pattern |
| `BuildContext` in async gaps | Context may be invalid after await | Check `mounted` or use ref callbacks |
| Nested `FutureBuilder` | Callback hell, no caching | Riverpod `AsyncNotifier` |
| No error handling on futures | Silent failures | `.catchError` or try/catch with user feedback |
| Hardcoded colors/sizes | Inconsistent UI, hard to theme | `Theme.of(context)` + design tokens |

---

## Verification Checklist

Before considering Flutter work done:
- [ ] `flutter analyze` passes with no issues
- [ ] `dart fix --apply` applied
- [ ] `flutter test` passes — all tests green
- [ ] Golden tests updated if UI changed
- [ ] `const` used on all possible constructors
- [ ] Riverpod providers are code-generated (`build_runner`)
- [ ] No `BuildContext` used across async gaps
- [ ] `ListView.builder` for all dynamic lists
- [ ] Deep links tested: `flutter run --route /product/123`
- [ ] Performance profiled: no jank in profile mode
- [ ] Accessibility: `Semantics` widgets on custom components
