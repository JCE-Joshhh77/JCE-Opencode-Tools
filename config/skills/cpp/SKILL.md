---
name: cpp
description: C/C++, CMake, modern C++. Use when working on cpp tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: C / C++
# Loaded on-demand when working with .c, .cpp, .h, .hpp files

## Auto-Detect

Trigger this skill when:
- File extensions: `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx`
- Build files: `CMakeLists.txt`, `CMakePresets.json`, `Makefile`, `meson.build`
- Tools: CMake, Conan, vcpkg, clang-tidy, clang-format
- Patterns: `#include`, `std::`, `namespace`

---

## Decision Tree: C++ Standard

```
Which standard to target?
+-- New project, full control? -> C++23 (modules, std::expected, std::print)
+-- Cross-platform library? -> C++20 (concepts, ranges, coroutines)
+-- Embedded / constrained? -> C++17 (optional, variant, string_view)
+-- Legacy codebase? -> Match existing, modernize incrementally
```

## Decision Tree: Build System

```
Which build system?
+-- Industry standard, broad support? -> CMake (with presets)
+-- Simpler syntax, faster? -> Meson
+-- Header-only library? -> CMake interface library
+-- Package management?
    +-- System-level, binary caching? -> Conan 2
    +-- Microsoft ecosystem, vcpkg.json manifest? -> vcpkg
    +-- Single dependency? -> CMake FetchContent
```

## Decision Tree: Error Handling

```
How to handle errors?
+-- Expected failure (file not found, parse error)? -> std::expected<T, E>
+-- Precondition violation (programmer bug)? -> assert / contract (C++26)
+-- Resource acquisition? -> RAII (constructor throws or returns expected)
+-- Performance-critical hot path? -> Error codes (no exceptions)
+-- Library boundary? -> std::expected (no exception ABI issues)
```

---

## C++23 Patterns

```cpp
#include <expected>
#include <print>
#include <ranges>
#include <string_view>
#include <generator>  // C++23 std::generator

// std::expected — Result type (replaces exceptions for expected failures)
enum class ParseError { InvalidFormat, OutOfRange, Empty };

std::expected<int, ParseError> parse_int(std::string_view sv) {
    if (sv.empty()) return std::unexpected(ParseError::Empty);
    int result{};
    auto [ptr, ec] = std::from_chars(sv.data(), sv.data() + sv.size(), result);
    if (ec == std::errc::invalid_argument) return std::unexpected(ParseError::InvalidFormat);
    if (ec == std::errc::result_out_of_range) return std::unexpected(ParseError::OutOfRange);
    return result;
}

// Monadic operations on expected
auto process(std::string_view input) {
    return parse_int(input)
        .transform([](int n) { return n * 2; })
        .transform_error([](ParseError e) { return format_error(e); });
}

// std::print — type-safe formatted output (replaces printf/iostream)
std::print("Hello, {}! You have {} messages.\n", user.name, count);
std::println("Point({}, {})", x, y);  // with newline

// std::generator — stackless coroutine generator
std::generator<int> fibonacci() {
    int a = 0, b = 1;
    while (true) {
        co_yield a;
        auto next = a + b;
        a = b;
        b = next;
    }
}

// Usage with ranges
for (auto n : fibonacci() | std::views::take(20)) {
    std::println("{}", n);
}

// Deducing this (C++23) — CRTP replacement
struct Widget {
    template<typename Self>
    auto&& get_name(this Self&& self) {
        return std::forward<Self>(self).name_;
    }
private:
    std::string name_;
};

// Multidimensional subscript operator
template<typename T>
class Matrix {
    std::vector<T> data_;
    size_t cols_;
public:
    T& operator[](size_t row, size_t col) { return data_[row * cols_ + col]; }
    const T& operator[](size_t row, size_t col) const { return data_[row * cols_ + col]; }
};
```

---

## C++20 Modules

```cpp
// math.cppm — module interface unit
export module math;

export namespace math {
    constexpr double pi = 3.14159265358979323846;

    template<std::floating_point T>
    constexpr T clamp(T value, T lo, T hi) {
        return std::max(lo, std::min(value, hi));
    }

    class Vector3 {
    public:
        float x{}, y{}, z{};
        constexpr float length() const { return std::sqrt(x*x + y*y + z*z); }
        constexpr Vector3 normalized() const;
    };
}

// main.cpp — consuming module
import math;
import std;  // C++23: import entire standard library

int main() {
    auto v = math::Vector3{1.0f, 2.0f, 3.0f};
    std::println("Length: {}", v.length());
}
```

---

## Concepts & Ranges (C++20/23)

```cpp
#include <concepts>
#include <ranges>

// Custom concept — constrain template parameters
template<typename T>
concept Serializable = requires(T t, std::ostream& os) {
    { t.serialize(os) } -> std::same_as<void>;
    { T::deserialize(std::declval<std::istream&>()) } -> std::same_as<T>;
};

template<typename C>
concept Container = requires(C c) {
    typename C::value_type;
    { c.begin() } -> std::input_iterator;
    { c.end() } -> std::sentinel_for<decltype(c.begin())>;
    { c.size() } -> std::convertible_to<size_t>;
};

// Ranges — composable, lazy pipelines
auto active_user_emails(const std::vector<User>& users) {
    return users
        | std::views::filter(&User::is_active)
        | std::views::transform(&User::email)
        | std::views::take(100)
        | std::ranges::to<std::vector>();  // C++23 materialize
}

// Range adaptors with projection
std::ranges::sort(users, std::less{}, &User::last_name);
auto it = std::ranges::find(users, target_email, &User::email);
```

---

## RAII & Smart Pointers

```cpp
// unique_ptr — sole ownership, zero overhead
auto connection = std::make_unique<DbConnection>(config);

// shared_ptr — shared ownership (use sparingly)
auto cache = std::make_shared<LRUCache<std::string, Data>>(capacity);

// Custom deleter for C resources
auto file = std::unique_ptr<FILE, decltype(&fclose)>(
    fopen("data.bin", "rb"), &fclose);

// RAII scope guard (C++23 or custom)
class ScopeGuard {
    std::function<void()> cleanup_;
public:
    explicit ScopeGuard(std::function<void()> fn) : cleanup_(std::move(fn)) {}
    ~ScopeGuard() { if (cleanup_) cleanup_(); }
    ScopeGuard(const ScopeGuard&) = delete;
    void dismiss() { cleanup_ = nullptr; }
};

// Usage
void process() {
    auto* resource = acquire_resource();
    ScopeGuard guard([&] { release_resource(resource); });
    // ... work with resource, guard releases on any exit path
}
```

---

## CMake Modern Patterns

```cmake
cmake_minimum_required(VERSION 3.25)
project(myapp VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Library target
add_library(mylib STATIC
    src/core/engine.cpp
    src/core/parser.cpp
)
target_include_directories(mylib PUBLIC include)
target_compile_features(mylib PUBLIC cxx_std_23)

# Executable
add_executable(myapp src/main.cpp)
target_link_libraries(myapp PRIVATE mylib)

# FetchContent for dependencies
include(FetchContent)
FetchContent_Declare(fmt
    GIT_REPOSITORY https://github.com/fmtlib/fmt
    GIT_TAG 11.0.0
)
FetchContent_Declare(googletest
    GIT_REPOSITORY https://github.com/google/googletest
    GIT_TAG v1.15.0
)
FetchContent_MakeAvailable(fmt googletest)
target_link_libraries(mylib PRIVATE fmt::fmt)

# Compiler warnings (strict)
target_compile_options(mylib PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic -Werror>
    $<$<CXX_COMPILER_ID:MSVC>:/W4 /WX>
)

# Sanitizers for debug builds
add_compile_options($<$<CONFIG:Debug>:-fsanitize=address,undefined>)
add_link_options($<$<CONFIG:Debug>:-fsanitize=address,undefined>)

# Testing
enable_testing()
add_executable(tests tests/test_parser.cpp tests/test_engine.cpp)
target_link_libraries(tests PRIVATE mylib GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(tests)
```

```json
// CMakePresets.json — reproducible builds
{
  "version": 6,
  "configurePresets": [
    {
      "name": "dev",
      "binaryDir": "build/dev",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug",
        "CMAKE_EXPORT_COMPILE_COMMANDS": "ON"
      }
    },
    {
      "name": "release",
      "binaryDir": "build/release",
      "cacheVariables": { "CMAKE_BUILD_TYPE": "Release" }
    }
  ],
  "buildPresets": [
    { "name": "dev", "configurePreset": "dev" },
    { "name": "release", "configurePreset": "release" }
  ],
  "testPresets": [
    { "name": "dev", "configurePreset": "dev", "output": { "outputOnFailure": true } }
  ]
}
```

---

## Testing (GoogleTest)

```cpp
#include <gtest/gtest.h>

TEST(ParserTest, ParsesValidInteger) {
    auto result = parse_int("42");
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result.value(), 42);
}

TEST(ParserTest, ReturnsErrorForEmpty) {
    auto result = parse_int("");
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error(), ParseError::Empty);
}

// Parameterized tests
class FibonacciTest : public testing::TestWithParam<std::pair<int, int>> {};

TEST_P(FibonacciTest, ReturnsCorrectValue) {
    auto [input, expected] = GetParam();
    EXPECT_EQ(fib(input), expected);
}

INSTANTIATE_TEST_SUITE_P(Values, FibonacciTest, testing::Values(
    std::pair{0, 0}, std::pair{1, 1}, std::pair{10, 55}
));
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Raw `new`/`delete` | Memory leaks, double-free | `make_unique` / `make_shared` exclusively |
| `reinterpret_cast` | Undefined behavior | `std::bit_cast` (C++20) or redesign |
| Exceptions in destructors | `std::terminate` called | Mark destructors `noexcept`, handle errors before dtor |
| `using namespace std;` in headers | Name collisions for all includers | Qualify names or `using` in .cpp only |
| C-style casts `(int)x` | No compile-time checking | `static_cast`, `dynamic_cast` explicitly |
| `std::endl` in loops | Flushes buffer every iteration (slow) | Use `'\n'` or `std::print` |
| Returning raw pointers for ownership | Unclear ownership semantics | Return `unique_ptr` or `expected` |
| No sanitizers in CI | Memory bugs found in production | ASan + UBSan in debug CI builds |

---

## Verification Checklist

Before considering C++ work done:
- [ ] Builds clean: `cmake --preset dev && cmake --build --preset dev`
- [ ] Zero warnings with `-Wall -Wextra -Wpedantic -Werror`
- [ ] Tests pass: `ctest --preset dev`
- [ ] ASan + UBSan clean (no runtime errors in debug)
- [ ] `clang-tidy` passes with project checks
- [ ] No raw `new`/`delete` — smart pointers only
- [ ] `std::expected` used for fallible operations (not exceptions)
- [ ] `constexpr` applied where possible
- [ ] Move semantics correct (Rule of 5 or Rule of 0)
- [ ] `noexcept` on move constructors and destructors
