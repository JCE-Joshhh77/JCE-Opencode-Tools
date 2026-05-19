---
name: angular
description: Angular, signals, RxJS, standalone components. Use when working on angular tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Angular
# Loaded on-demand when working with Angular, .component.ts files

## Auto-Detect

Trigger this skill when:
- File extensions: `.component.ts`, `.service.ts`, `.module.ts`, `.directive.ts`
- `package.json` contains: `@angular/core`, `@angular/cli`
- Imports from: `@angular/core`, `@angular/common`, `@angular/router`
- Directory patterns: `src/app/`, `angular.json`

---

## Decision Tree: State Management

```
Need to store data?
├── Component-local UI state? → signal()
├── Derived from other signals? → computed()
├── Side effect on signal change? → effect()
├── Shared across components (same module)? → Service with signals
├── App-wide state (auth, theme)? → Injectable service (providedIn: 'root')
├── Complex state with actions/selectors? → NgRx SignalStore
├── Server data (API responses)? → HttpClient + signal or NgRx ComponentStore
├── Form state? → Reactive Forms (FormBuilder)
└── URL-driven state? → Router params/query + toSignal()
```

## Decision Tree: Component Communication

```
How do components communicate?
├── Parent → Child? → input() signal
├── Child → Parent? → output() signal
├── Two-way binding? → model() signal
├── Deeply nested (avoid prop drilling)? → Service with inject()
├── Sibling components? → Shared service or parent mediator
├── Cross-feature modules? → Root-level service or NgRx store
└── Template reference? → viewChild() / viewChildren() signals
```

---

## Angular 19 — Standalone & Zoneless

```typescript
// Standalone components are the DEFAULT — no NgModule needed
@Component({
  selector: 'app-user-card',
  standalone: true, // implicit in Angular 19, can omit
  imports: [RouterLink, DatePipe, UserAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <app-user-avatar [src]="user().avatar" />
      <h3>{{ user().name }}</h3>
      <time>{{ user().createdAt | date:'mediumDate' }}</time>
      <a [routerLink]="['/users', user().id]">View Profile</a>
    </div>
  `,
})
export class UserCardComponent {
  user = input.required<User>();
}

// Bootstrap without NgModule — Angular 19
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideExperimentalZonelessChangeDetection(), // Zoneless mode!
    provideAnimationsAsync(),
  ],
});

// With zoneless: no zone.js import needed, smaller bundle,
// change detection driven entirely by signals and markForCheck
```

---

## Signals (Angular 19)

```typescript
import { signal, computed, effect, untracked, linkedSignal } from '@angular/core';

@Component({ /* ... */ })
export class DashboardComponent {
  // Writable signal
  count = signal(0);
  items = signal<Item[]>([]);

  // Computed signal — auto-tracks dependencies, memoized
  total = computed(() => this.items().reduce((sum, i) => sum + i.price, 0));
  isEmpty = computed(() => this.items().length === 0);

  // Signal-based inputs
  name = input<string>('default');          // optional with default
  id = input.required<string>();            // required
  label = input<string, number>(0, {        // with transform
    transform: (v: number) => `Item #${v}`,
  });

  // Signal-based outputs
  saved = output<User>();
  deleted = output<string>();

  // model() — two-way binding signal
  value = model<string>('');  // parent uses [(value)]="something"

  // viewChild / viewChildren — signal-based queries
  chart = viewChild<ElementRef>('chart');
  items = viewChildren(ItemComponent);

  // linkedSignal — derived writable signal (Angular 19)
  selectedIndex = linkedSignal(() => {
    // Resets to 0 whenever items change
    this.items();
    return 0;
  });

  // Effect — runs when tracked signals change
  constructor() {
    effect(() => {
      console.log(`Count: ${this.count()}`);
      // untracked: read without tracking
      const items = untracked(() => this.items());
    });

    // effect with cleanup
    effect((onCleanup) => {
      const sub = this.someObservable$.subscribe();
      onCleanup(() => sub.unsubscribe());
    });
  }

  increment() {
    this.count.update(c => c + 1);
    // .set() for direct assignment
    // .update() for functional update
  }
}
```

---

## Angular 17+ Control Flow

```html
<!-- @if replaces *ngIf -->
@if (user(); as u) {
  <h1>Welcome, {{ u.name }}</h1>
} @else if (loading()) {
  <app-spinner />
} @else {
  <p>Please log in</p>
}

<!-- @for replaces *ngFor — requires track expression -->
@for (item of items(); track item.id) {
  <app-item-card [item]="item" />
} @empty {
  <p>No items found</p>
}

<!-- @switch replaces ngSwitch -->
@switch (status()) {
  @case ('active') { <span class="badge green">Active</span> }
  @case ('inactive') { <span class="badge gray">Inactive</span> }
  @default { <span class="badge">Unknown</span> }
}

<!-- @defer — lazy load heavy components -->
@defer (on viewport) {
  <app-heavy-chart [data]="chartData()" />
} @placeholder {
  <div class="chart-placeholder">Chart loads when visible</div>
} @loading (minimum 500ms) {
  <app-spinner />
} @error {
  <p>Failed to load chart</p>
}

<!-- @defer triggers:
  on viewport    — element enters viewport
  on idle        — browser is idle
  on interaction — user interacts with placeholder
  on hover       — user hovers over placeholder
  on timer(5s)   — after delay
  when condition — boolean expression becomes true
  Prefetch: @defer (on interaction; prefetch on idle) -->
```

---

## Dependency Injection

```typescript
// Service with providedIn (tree-shakable singleton)
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  currentUser = signal<User | null>(null);
  isAuthenticated = computed(() => this.currentUser() !== null);
  token = signal<string | null>(null);

  async login(credentials: Credentials) {
    const res = await firstValueFrom(
      this.http.post<AuthResponse>('/api/login', credentials)
    );
    this.currentUser.set(res.user);
    this.token.set(res.token);
  }

  logout() {
    this.currentUser.set(null);
    this.token.set(null);
    this.router.navigate(['/login']);
  }
}

// inject() function — preferred over constructor injection
@Component({ /* ... */ })
export class ProfileComponent {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
}

// InjectionToken for non-class dependencies
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
// Provide: { provide: API_BASE_URL, useValue: environment.apiUrl }
// Inject: private apiUrl = inject(API_BASE_URL);

// Factory provider
export const LOGGER = new InjectionToken<Logger>('Logger', {
  providedIn: 'root',
  factory: () => inject(EnvironmentService).isProd
    ? new ProductionLogger()
    : new ConsoleLogger(),
});
```

---

## RxJS + Signals Interop

```typescript
import { toSignal, toObservable } from '@angular/core/rxjs-interop';

@Component({ /* ... */ })
export class SearchComponent {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);

  query = signal('');

  // toObservable: convert Signal → Observable (for RxJS pipelines)
  private query$ = toObservable(this.query);

  // RxJS pipeline for debounced search
  private results$ = this.query$.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    filter(q => q.length >= 2),
    switchMap(query =>
      this.http.get<Result[]>(`/api/search?q=${query}`).pipe(
        retry(2),
        catchError(() => of([])),
      )
    ),
  );

  // toSignal: convert Observable → Signal (for template)
  results = toSignal(this.results$, { initialValue: [] });

  // Resource API (Angular 19) — signal-based async data
  private userId = input.required<string>();
  userResource = resource({
    request: () => ({ id: this.userId() }),
    loader: ({ request, abortSignal }) =>
      fetch(`/api/users/${request.id}`, { signal: abortSignal }).then(r => r.json()),
  });
  // userResource.value(), userResource.status(), userResource.reload()
}
```

---

## Reactive Forms

```typescript
@Component({ /* ... */ })
export class RegistrationComponent {
  private fb = inject(NonNullableFormBuilder);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    address: this.fb.group({
      street: [''],
      city: ['', Validators.required],
      zip: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
    }),
  });

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue(); // fully typed
    this.userService.register(value).subscribe();
  }
}
```

```html
<form [formGroup]="form" (ngSubmit)="onSubmit()">
  <input formControlName="name" />
  @if (form.controls.name.errors?.['required'] && form.controls.name.touched) {
    <span class="error">Name is required</span>
  }
  <div formGroupName="address">
    <input formControlName="city" />
  </div>
  <button type="submit" [disabled]="form.invalid">Register</button>
</form>
```

---

## Routing (Standalone)

```typescript
export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'dashboard',
    canActivate: [() => inject(AuthService).isAuthenticated()],
    loadComponent: () => import('./dashboard.component').then(m => m.DashboardComponent),
    children: [
      {
        path: 'settings',
        loadComponent: () => import('./settings.component'),
        resolve: { settings: () => inject(SettingsService).load() },
      },
    ],
  },
  {
    path: 'admin',
    canMatch: [() => inject(AuthService).isAdmin()],
    loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES),
  },
  { path: '**', component: NotFoundComponent },
];
```

---

## HttpClient & Functional Interceptors

```typescript
// Functional interceptor (Angular 15+)
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();

  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(req).pipe(
    catchError(err => {
      if (err.status === 401) auth.logout();
      return throwError(() => err);
    }),
  );
};

// Retry interceptor
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    retry({ count: 2, delay: 1000 }),
  );
};

// Register: provideHttpClient(withInterceptors([authInterceptor, retryInterceptor]))
```

---

## NgRx SignalStore

```typescript
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

type TodoState = { items: Todo[]; filter: 'all' | 'active' | 'done'; loading: boolean };

export const TodoStore = signalStore(
  { providedIn: 'root' },
  withState<TodoState>({ items: [], filter: 'all', loading: false }),
  withComputed(({ items, filter }) => ({
    filteredItems: computed(() => {
      const f = filter();
      if (f === 'all') return items();
      return items().filter(i => i.status === f);
    }),
    count: computed(() => items().length),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    async loadAll() {
      patchState(store, { loading: true });
      const items = await firstValueFrom(http.get<Todo[]>('/api/todos'));
      patchState(store, { items, loading: false });
    },
    add(todo: Todo) {
      patchState(store, { items: [...store.items(), todo] });
    },
    setFilter(filter: TodoState['filter']) {
      patchState(store, { filter });
    },
  })),
);

// Usage in component
@Component({ providers: [TodoStore] }) // or inject from root
export class TodoListComponent {
  store = inject(TodoStore);
  // store.filteredItems(), store.loading(), store.loadAll()
}
```

---

## Testing

```typescript
describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('fetches users', () => {
    service.getUsers().subscribe(users => expect(users).toHaveLength(2));
    const req = httpMock.expectOne('/api/users');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: '1' }, { id: '2' }]);
  });

  afterEach(() => httpMock.verify());
});

// Component test with signal inputs
it('renders user name', () => {
  const fixture = TestBed.createComponent(UserCardComponent);
  fixture.componentRef.setInput('user', { name: 'Alice', id: '1', avatar: '' });
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Alice');
});

// Testing with harnesses (Angular Material)
it('opens dialog on click', async () => {
  const loader = TestbedHarnessEnvironment.loader(fixture);
  const button = await loader.getHarness(MatButtonHarness.with({ text: 'Open' }));
  await button.click();
  const dialog = await loader.getHarness(MatDialogHarness);
  expect(await dialog.getTitleText()).toBe('Confirm');
});
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| NgModules for new projects | Standalone components (default since 17) |
| Manual subscribe without cleanup | `takeUntilDestroyed`, `toSignal`, or `async` pipe |
| Default change detection | Always use `OnPush` (or zoneless) |
| Fat components with business logic | Extract to injectable services |
| Nested subscribes | `switchMap`, `concatMap`, `mergeMap` |
| `any` types in templates | Strict typing with typed forms and signals |
| `*ngIf` / `*ngFor` (Angular 17+) | `@if` / `@for` control flow |
| Class-based guards/resolvers | Functional guards with `inject()` |
| Importing entire RxJS | Import operators individually |
| Missing `track` in `@for` | Always provide track expression |
| `zone.js` in new projects | Zoneless with signal-based reactivity |
| Constructor injection | `inject()` function (more flexible) |

---

## Verification Checklist

Before considering Angular work done:
- [ ] All components are standalone (no NgModule declarations)
- [ ] `ChangeDetectionStrategy.OnPush` on every component
- [ ] Signals used for component state (not plain class properties)
- [ ] `@if`/`@for`/`@switch` control flow (not structural directives)
- [ ] `@for` has `track` expression on every usage
- [ ] `@defer` used for heavy below-fold components
- [ ] Services use `inject()` function (not constructor injection)
- [ ] RxJS subscriptions cleaned up (takeUntilDestroyed or toSignal)
- [ ] Functional interceptors and guards (not class-based)
- [ ] Forms use `NonNullableFormBuilder` with typed controls
- [ ] Lazy loading via `loadComponent`/`loadChildren` for routes
- [ ] Tests use `TestBed.configureTestingModule` with minimal providers
