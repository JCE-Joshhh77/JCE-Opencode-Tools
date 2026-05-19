---
name: swift-ios
description: Swift, SwiftUI, iOS development. Use when working on swift-ios tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Swift & iOS
# Loaded on-demand when working with .swift files, SwiftUI, UIKit

## Auto-Detect

Trigger this skill when:
- File extensions: `.swift`, `Package.swift`, `.xcodeproj`, `.xcworkspace`
- Frameworks: SwiftUI, UIKit, Combine, SwiftData, visionOS
- Tools: Xcode, Swift Package Manager, xcrun, xcodebuild
- Patterns: `import SwiftUI`, `@Observable`, `actor`, `async/await`

---

## Decision Tree: UI Framework

```
Which UI framework?
+-- New app, iOS 17+? -> SwiftUI (default choice)
+-- Need UIKit interop? -> SwiftUI + UIViewRepresentable
+-- Complex custom layouts? -> SwiftUI with Layout protocol
+-- visionOS / spatial computing? -> SwiftUI + RealityKit
+-- Legacy app, incremental migration? -> UIKit + SwiftUI hosting
+-- watchOS / widgets? -> SwiftUI only
```

## Decision Tree: Data Persistence

```
How to persist data?
+-- Simple key-value? -> UserDefaults / @AppStorage
+-- Structured local data (iOS 17+)? -> SwiftData
+-- Complex queries, relationships? -> SwiftData with custom FetchDescriptor
+-- Need Core Data compatibility? -> Core Data (legacy)
+-- Sync across devices? -> CloudKit + SwiftData
+-- Secure credentials? -> Keychain (via KeychainAccess)
```

## Decision Tree: Architecture

```
Which architecture?
+-- Simple app (< 10 views)? -> @Observable + SwiftUI
+-- Medium app? -> MVVM with @Observable ViewModels
+-- Large app, many teams? -> TCA (The Composable Architecture)
+-- Need testability + DI? -> Protocol-based DI + @Observable
```

---

## Swift 6 Strict Concurrency

```swift
// Swift 6 enforces complete concurrency safety at compile time
// All data shared across concurrency domains must be Sendable

// Sendable — safe to pass across actor boundaries
struct UserDTO: Sendable {  // Value types are implicitly Sendable
    let id: String
    let name: String
    let email: String
}

// Non-Sendable types cannot cross actor boundaries
// Use @unchecked Sendable only when you've manually verified safety

// Actor — thread-safe mutable state (replaces locks/queues)
actor SessionManager {
    private var sessions: [String: Session] = [:]

    func getSession(id: String) -> Session? {
        sessions[id]
    }

    func createSession(for user: UserDTO) -> Session {
        let session = Session(userId: user.id, token: UUID().uuidString)
        sessions[session.token] = session
        return session
    }

    func invalidate(token: String) {
        sessions.removeValue(forKey: token)
    }
}

// Global actor — isolate to specific execution context
@globalActor
actor DatabaseActor {
    static let shared = DatabaseActor()
}

@DatabaseActor
class DatabaseService {
    func query(_ sql: String) async throws -> [Row] {
        // Guaranteed single-threaded access
    }
}

// Structured concurrency — parent-child task relationships
func fetchDashboard(userId: String) async throws -> Dashboard {
    // Parallel execution with automatic cancellation propagation
    async let profile = api.fetchProfile(userId)
    async let orders = api.fetchOrders(userId)
    async let notifications = api.fetchNotifications(userId)

    return Dashboard(
        profile: try await profile,
        orders: try await orders,
        notifications: try await notifications
    )
}

// TaskGroup — dynamic number of concurrent tasks
func fetchAllProducts(ids: [String]) async throws -> [Product] {
    try await withThrowingTaskGroup(of: Product.self) { group in
        for id in ids {
            group.addTask { try await api.fetchProduct(id) }
        }
        return try await group.reduce(into: []) { $0.append($1) }
    }
}

// AsyncStream — bridge callback-based APIs to async/await
func locationUpdates() -> AsyncStream<CLLocation> {
    AsyncStream { continuation in
        let delegate = LocationDelegate(onUpdate: { location in
            continuation.yield(location)
        })
        continuation.onTermination = { _ in delegate.stop() }
        delegate.start()
    }
}
```

---

## SwiftUI 6 (iOS 18+)

```swift
import SwiftUI

// @Observable macro (iOS 17+) — replaces ObservableObject
@Observable
class ProfileViewModel {
    var user: User?
    var isLoading = false
    var error: String?

    private let repository: UserRepository

    init(repository: UserRepository = .live) {
        self.repository = repository
    }

    func loadUser(id: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            user = try await repository.fetch(id: id)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// View with @Observable — no @ObservedObject/@StateObject needed
struct ProfileView: View {
    @State private var viewModel = ProfileViewModel()
    let userId: String

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
            } else if let user = viewModel.user {
                UserContent(user: user)
            } else if let error = viewModel.error {
                ContentUnavailableView("Error", systemImage: "exclamationmark.triangle", description: Text(error))
            }
        }
        .task { await viewModel.loadUser(id: userId) }
        .refreshable { await viewModel.loadUser(id: userId) }
    }
}

// Custom container with new ForEach subview API (iOS 18)
struct CardStack<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 12) {
            content
        }
        .padding()
        .background(.regularMaterial, in: .rect(cornerRadius: 16))
    }
}

// Mesh gradients (iOS 18)
MeshGradient(
    width: 3, height: 3,
    points: [.init(0, 0), .init(0.5, 0), .init(1, 0),
             .init(0, 0.5), .init(0.5, 0.5), .init(1, 0.5),
             .init(0, 1), .init(0.5, 1), .init(1, 1)],
    colors: [.red, .orange, .yellow,
             .green, .blue, .purple,
             .cyan, .mint, .pink]
)

// Custom transitions and animations
struct SlideTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content
            .offset(x: phase == .willAppear ? -300 : phase == .didDisappear ? 300 : 0)
            .opacity(phase.isIdentity ? 1 : 0)
    }
}
```

---

## SwiftData (iOS 17+)

```swift
import SwiftData

// Model definition — replaces Core Data's visual editor
@Model
class Task {
    var title: String
    var isComplete: Bool
    var priority: Priority
    var createdAt: Date
    @Relationship(deleteRule: .cascade) var subtasks: [Subtask]

    init(title: String, priority: Priority = .medium) {
        self.title = title
        self.isComplete = false
        self.priority = priority
        self.createdAt = .now
        self.subtasks = []
    }
}

enum Priority: Int, Codable, CaseIterable {
    case low, medium, high, urgent
}

@Model
class Subtask {
    var title: String
    var isComplete: Bool
    var task: Task?

    init(title: String) {
        self.title = title
        self.isComplete = false
    }
}

// Container setup
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
            .modelContainer(for: [Task.self, Subtask.self])
    }
}

// Querying with predicates and sorting
struct TaskListView: View {
    @Query(
        filter: #Predicate<Task> { !$0.isComplete },
        sort: [SortDescriptor(\.priority, order: .reverse), SortDescriptor(\.createdAt)],
        animation: .default
    )
    private var tasks: [Task]

    @Environment(\.modelContext) private var context

    var body: some View {
        List(tasks) { task in
            TaskRow(task: task)
                .swipeActions {
                    Button("Complete") { task.isComplete = true }
                        .tint(.green)
                    Button("Delete", role: .destructive) { context.delete(task) }
                }
        }
    }

    func addTask(_ title: String, priority: Priority) {
        let task = Task(title: title, priority: priority)
        context.insert(task)
    }
}
```

---

## visionOS & Spatial Computing

```swift
import SwiftUI
import RealityKit

// visionOS window
struct ContentView: View {
    @State private var showImmersive = false

    var body: some View {
        NavigationStack {
            VStack {
                Text("Welcome to Spatial")
                    .font(.extraLargeTitle)
                Toggle("Show 3D View", isOn: $showImmersive)
            }
            .padding()
        }
    }
}

// Volumetric window
struct VolumetricView: View {
    var body: some View {
        RealityView { content in
            let sphere = MeshResource.generateSphere(radius: 0.1)
            let material = SimpleMaterial(color: .blue, isMetallic: true)
            let entity = ModelEntity(mesh: sphere, materials: [material])
            content.add(entity)
        }
        .gesture(TapGesture().targetedToAnyEntity().onEnded { value in
            // Handle tap on 3D entity
        })
    }
}
```

---

## Testing

```swift
import Testing
import Foundation

// Swift Testing framework (Xcode 16+) — replaces XCTest for unit tests
@Suite("UserService Tests")
struct UserServiceTests {
    let mockRepo: MockUserRepository
    let service: UserService

    init() {
        mockRepo = MockUserRepository()
        service = UserService(repository: mockRepo)
    }

    @Test("loads user successfully")
    func loadUser() async throws {
        mockRepo.stubbedUser = User(id: "1", name: "Alice", email: "a@b.com")

        let user = try await service.fetch(id: "1")

        #expect(user.name == "Alice")
        #expect(user.email == "a@b.com")
        #expect(mockRepo.fetchCallCount == 1)
    }

    @Test("throws for missing user")
    func loadMissingUser() async {
        mockRepo.stubbedUser = nil

        await #expect(throws: AppError.notFound) {
            try await service.fetch(id: "999")
        }
    }

    @Test("validates email format", arguments: ["bad", "no-at", "@", ""])
    func invalidEmails(email: String) {
        #expect(Email(email) == nil)
    }
}

// Mock with protocol
protocol UserRepository: Sendable {
    func fetch(id: String) async throws -> User
    func save(_ user: User) async throws
}

final class MockUserRepository: UserRepository, @unchecked Sendable {
    var stubbedUser: User?
    var fetchCallCount = 0

    func fetch(id: String) async throws -> User {
        fetchCallCount += 1
        guard let user = stubbedUser else { throw AppError.notFound }
        return user
    }

    func save(_ user: User) async throws { /* no-op */ }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Force unwrapping (`!`) | Runtime crash | `guard let`, `if let`, nil coalescing |
| `@StateObject` in iOS 17+ | Deprecated pattern | `@State` with `@Observable` class |
| Massive view bodies (100+ lines) | Unreadable, slow previews | Extract subviews and components |
| Blocking main thread | UI freezes | `async/await`, `Task { }` |
| Retain cycles in closures | Memory leaks | `[weak self]` or actor isolation |
| `DispatchQueue` in new code | Old concurrency model | Swift concurrency (async/await, actors) |
| No `Sendable` conformance | Data races in Swift 6 | Mark value types Sendable, use actors |
| God ViewModel (500+ lines) | Untestable, violates SRP | Split into focused services/use cases |

---

## Verification Checklist

Before considering Swift/iOS work done:
- [ ] Builds with strict concurrency checking enabled
- [ ] No force unwraps (`!`) except `IBOutlet` (UIKit legacy)
- [ ] All `@Observable` classes are `@MainActor` isolated
- [ ] Actors used for shared mutable state
- [ ] `Sendable` conformance on all types crossing boundaries
- [ ] SwiftData models have proper relationships and delete rules
- [ ] Tests pass with Swift Testing framework
- [ ] Accessibility: `.accessibilityLabel()` on all interactive elements
- [ ] Previews work for all views (`#Preview`)
- [ ] No retain cycles — `[weak self]` in escaping closures
- [ ] Memory profiled with Instruments (no leaks)
