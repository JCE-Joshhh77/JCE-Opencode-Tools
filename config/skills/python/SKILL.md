---
name: python
description: Python ecosystem, pip, venv, typing. Use when working on python tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Python
# Loaded on-demand when working with .py, .pyi files

## Auto-Detect

Trigger this skill when:
- File extensions: `.py`, `.pyi`, `pyproject.toml`, `requirements.txt`
- Config files: `pyproject.toml`, `setup.cfg`, `uv.lock`
- Task mentions: Python, FastAPI, Django, Flask, async, typing, Pydantic

---

## Decision Tree: Project Setup

```
Starting a new Python project?
+-- Package manager?
|   +-- New project (2025+)? -> uv (fast, replaces pip/venv/pip-tools)
|   +-- Existing project with requirements.txt? -> uv pip (drop-in compatible)
|   +-- Poetry/PDM already in use? -> Keep it, but consider migrating to uv
+-- Python version?
|   +-- Need free-threaded mode? -> Python 3.13+ (no GIL)
|   +-- Need latest typing features? -> Python 3.12+ minimum
|   +-- Library targeting broad compat? -> Python 3.10+ (union syntax X | Y)
+-- Type checking?
|   +-- Strict correctness? -> pyright (faster, stricter)
|   +-- Gradual adoption? -> mypy --strict (more plugins)
+-- Linting + formatting?
|   +-- Always -> ruff (replaces flake8, isort, black, pyupgrade)
+-- Testing?
    +-- pytest (always) + pytest-cov + hypothesis (property-based)
```

## Decision Tree: Async vs Sync

```
Need concurrency?
+-- I/O-bound (HTTP, DB, files)?
|   +-- Many concurrent connections? -> async (asyncio + httpx/aiohttp)
|   +-- Simple scripts / CLI? -> sync is fine
|   +-- CPU-bound mixed with I/O? -> async + ProcessPoolExecutor
+-- CPU-bound computation?
|   +-- Python 3.13 free-threaded? -> threading (no GIL!)
|   +-- Older Python? -> multiprocessing or ProcessPoolExecutor
|   +-- Numeric/scientific? -> NumPy/Polars (releases GIL internally)
+-- Background tasks in web app?
|   +-- FastAPI? -> BackgroundTasks or Celery/ARQ
|   +-- Django? -> django-q2 or Celery
+-- Streaming / real-time?
    +-- async generators + SSE or WebSocket
```

---

## Python 3.13 — Free-Threaded Mode

```python
# Python 3.13 can run WITHOUT the GIL (experimental, opt-in)
# Install: python3.13t (free-threaded build)
# Run: python3.13t -X gil=0 script.py

# True parallelism with threads for CPU-bound work
import threading
from concurrent.futures import ThreadPoolExecutor

def cpu_intensive(data: list[int]) -> int:
    return sum(x * x for x in data)

# With free-threaded Python, these actually run in parallel
with ThreadPoolExecutor(max_workers=4) as executor:
    chunks = [data[i::4] for i in range(4)]
    results = list(executor.map(cpu_intensive, chunks))
    total = sum(results)

# Check if GIL is disabled at runtime
import sys
if hasattr(sys, '_is_gil_enabled'):
    print(f"GIL enabled: {sys._is_gil_enabled()}")
```

---

## Modern Typing (Python 3.12+)

```python
# Type parameter syntax (PEP 695) — Python 3.12+
type Vector[T: (int, float)] = list[T]
type Callback[**P, R] = Callable[P, R]

# Generic functions with new syntax
def first[T](items: Sequence[T]) -> T | None:
    return items[0] if items else None

# Generic classes
class Repository[T]:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, id: int) -> T | None: ...
    async def create(self, entity: T) -> T: ...
    async def update(self, id: int, data: dict[str, Any]) -> T: ...

# TypedDict with Required/NotRequired
from typing import TypedDict, NotRequired

class UserCreate(TypedDict):
    email: str
    name: str
    age: NotRequired[int]
    role: NotRequired[str]

# Type narrowing with TypeGuard and TypeIs (3.13)
from typing import TypeIs

def is_string_list(val: list[object]) -> TypeIs[list[str]]:
    return all(isinstance(x, str) for x in val)

# Using TypeIs narrows the type in both branches
def process(items: list[object]) -> None:
    if is_string_list(items):
        # items is list[str] here
        print(", ".join(items))
    else:
        # items is list[object] here (not list[str])
        pass

# Override decorator for safety
from typing import override

class Animal:
    def speak(self) -> str: return "..."

class Dog(Animal):
    @override  # Error if parent doesn't have this method
    def speak(self) -> str: return "Woof"
```

---

## uv Package Manager

```bash
# Install uv (replaces pip, venv, pip-tools, pipx)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create new project
uv init myproject
cd myproject

# Add dependencies (resolves and locks automatically)
uv add fastapi uvicorn[standard] pydantic-settings
uv add --dev pytest pytest-cov ruff pyright hypothesis

# Run scripts (auto-creates venv, installs deps)
uv run python main.py
uv run pytest

# Sync environment from lockfile (CI/CD)
uv sync --frozen

# Pin Python version
uv python pin 3.13

# pyproject.toml (uv-managed)
[project]
name = "myapp"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "pydantic>=2.9",
    "httpx>=0.27",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8.0",
    "ruff>=0.8",
    "pyright>=1.1",
]
```

---

## Pydantic v2 — Validation & Serialization

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import datetime

class CreateUser(BaseModel):
    model_config = {"strict": True}  # No coercion

    email: str = Field(..., pattern=r"^[\w.-]+@[\w.-]+\.\w+$")
    name: str = Field(..., min_length=1, max_length=100)
    age: int | None = Field(None, ge=13, le=150)
    role: str = Field(default="user")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()

    @model_validator(mode="after")
    def check_admin_age(self) -> "CreateUser":
        if self.role == "admin" and (self.age is None or self.age < 18):
            raise ValueError("Admins must be 18+")
        return self

# Serialization with computed fields
class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    created_at: datetime

    @computed_field
    @property
    def display_name(self) -> str:
        return f"{self.name} ({self.email})"
```

---

## Modern Async Patterns

```python
import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

# Structured concurrency with TaskGroup (Python 3.11+)
async def fetch_all_data(user_id: int) -> UserData:
    async with asyncio.TaskGroup() as tg:
        profile_task = tg.create_task(fetch_profile(user_id))
        orders_task = tg.create_task(fetch_orders(user_id))
        prefs_task = tg.create_task(fetch_preferences(user_id))
    # All tasks complete or all cancelled on first exception
    return UserData(
        profile=profile_task.result(),
        orders=orders_task.result(),
        preferences=prefs_task.result(),
    )

# Async context manager for resource management
@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    session = async_session_factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()

# Async generator for streaming
async def stream_results(query: str) -> AsyncGenerator[dict, None]:
    async with get_db_session() as session:
        result = await session.stream(text(query))
        async for row in result:
            yield dict(row._mapping)

# Timeout and cancellation
async def fetch_with_timeout(url: str, timeout: float = 5.0) -> bytes:
    async with asyncio.timeout(timeout):
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.content

# Semaphore for rate limiting
async def fetch_many(urls: list[str], max_concurrent: int = 10) -> list[bytes]:
    semaphore = asyncio.Semaphore(max_concurrent)
    async def _fetch(url: str) -> bytes:
        async with semaphore:
            return await fetch_with_timeout(url)
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(_fetch(url)) for url in urls]
    return [t.result() for t in tasks]
```

---

## Project Structure

```
myapp/
├── pyproject.toml          # Project config (uv/ruff/pyright)
├── uv.lock                 # Locked dependencies
├── src/
│   └── myapp/
│       ├── __init__.py
│       ├── main.py         # Entry point
│       ├── config.py       # Settings (pydantic-settings)
│       ├── models/         # Domain models / DB models
│       ├── services/       # Business logic
│       ├── api/            # Route handlers
│       │   ├── __init__.py
│       │   ├── deps.py     # Dependency injection
│       │   └── routes/
│       └── repositories/   # Data access layer
├── tests/
│   ├── conftest.py
│   ├── unit/
│   └── integration/
└── Dockerfile
```

---

## Testing with pytest

```python
import pytest
from hypothesis import given, strategies as st

# Fixtures with proper scoping
@pytest.fixture
async def db_session():
    async with get_test_session() as session:
        yield session
        await session.rollback()

# Parametrized tests
@pytest.mark.parametrize("email,valid", [
    ("user@example.com", True),
    ("invalid", False),
    ("", False),
    ("a@b.c", True),
])
def test_email_validation(email: str, valid: bool):
    if valid:
        user = CreateUser(email=email, name="Test")
        assert user.email == email.lower()
    else:
        with pytest.raises(ValidationError):
            CreateUser(email=email, name="Test")

# Property-based testing with Hypothesis
@given(st.text(min_size=1, max_size=100))
def test_name_roundtrip(name: str):
    user = CreateUser(email="test@example.com", name=name)
    assert user.name == name

# Async test
@pytest.mark.anyio
async def test_create_user(db_session: AsyncSession):
    repo = UserRepository(db_session)
    user = await repo.create(CreateUser(email="new@test.com", name="New"))
    assert user.id is not None
    assert user.email == "new@test.com"
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Mutable default args | Shared state between calls | Use `None` default + create inside |
| Bare `except:` | Swallows KeyboardInterrupt, SystemExit | `except Exception:` minimum |
| `import *` | Namespace pollution, unclear deps | Explicit imports |
| Global mutable state | Hard to test, race conditions | Dependency injection |
| No type hints | Bugs at runtime, poor IDE support | Type everything, run pyright |
| `requirements.txt` without pins | Non-reproducible builds | `uv lock` or pin exact versions |
| `os.path` for file operations | Verbose, error-prone | `pathlib.Path` |
| `print()` for logging | No levels, no structure | `logging` or `structlog` |
| Sync HTTP in async code | Blocks event loop | Use `httpx.AsyncClient` |
| `dict` for structured data | No validation, typo-prone | Pydantic models or dataclasses |

---

## Verification Checklist

Before considering Python work done:
- [ ] `uv run pytest` passes with no failures
- [ ] `uv run ruff check .` reports no issues
- [ ] `uv run pyright` (or mypy --strict) passes
- [ ] All public functions have type annotations
- [ ] External data validated with Pydantic at boundaries
- [ ] Async code uses TaskGroup (not bare `gather` without error handling)
- [ ] No mutable default arguments
- [ ] No bare `except:` clauses
- [ ] `uv.lock` committed and `uv sync --frozen` works in CI
- [ ] Tests cover error paths, not just happy path
