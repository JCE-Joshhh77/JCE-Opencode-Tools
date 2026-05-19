---
name: django-fastapi
description: Django, DRF, FastAPI, Pydantic. Use when working on django-fastapi tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Django & FastAPI
# Loaded on-demand when working with Django, FastAPI, DRF

## Auto-Detect

Trigger this skill when:
- File extensions: `.py` with Django/FastAPI imports
- `requirements.txt` or `pyproject.toml` contains: `django`, `fastapi`, `djangorestframework`
- Imports from: `django`, `rest_framework`, `fastapi`, `pydantic`
- Directory patterns: `manage.py`, `urls.py`, `views.py`, `routers/`

---

## Decision Tree: Framework Choice

```
What are you building?
├── Full-stack web app (admin, ORM, templates, auth)?
│   └── Django (batteries-included, mature ecosystem)
├── REST API with complex business logic?
│   ├── Need Django ORM + admin? → Django REST Framework
│   └── Need async + high performance? → FastAPI
├── Microservice / lightweight API?
│   └── FastAPI (async-first, auto-docs, Pydantic validation)
├── Real-time / WebSocket?
│   ├── Django Channels (ASGI)
│   └── FastAPI WebSocket (native)
├── ML model serving / data pipeline API?
│   └── FastAPI (async, Pydantic, easy typing)
└── Legacy Django project adding API?
    └── DRF (integrates with existing models/auth)
```

## Decision Tree: Django Data Access

```
How to query data?
├── Simple lookup by PK/field? → .get() / .filter()
├── Need related objects (FK)? → select_related() (JOIN)
├── Need related objects (M2M/reverse FK)? → prefetch_related()
├── Need aggregation? → .annotate() / .aggregate() with F/Q
├── Need DB-level update? → .update() with F() objects
├── Need complex WHERE? → Q() objects with | and &
├── Need raw SQL? → .raw() or connection.cursor() (last resort)
└── Need pagination? → Paginator or DRF pagination classes
```

---

# DJANGO 5.1+

## Models & QuerySet Optimization

```python
from django.db import models
from django.db.models import F, Q, Count, Avg, Prefetch
from django.db.models.functions import Now, TruncMonth

class Post(models.Model):
    title = models.CharField(max_length=255, db_index=True)
    slug = models.SlugField(unique=True)
    body = models.TextField()
    author = models.ForeignKey('auth.User', on_delete=models.CASCADE, related_name='posts')
    tags = models.ManyToManyField('Tag', blank=True)
    published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['published', '-published_at']),
            models.Index(fields=['author', '-created_at']),
        ]
        constraints = [
            models.CheckConstraint(
                check=Q(published=False) | Q(published_at__isnull=False),
                name='published_requires_date',
            ),
        ]

    # Django 5.1: GeneratedField (computed columns stored in DB)
    word_count = models.GeneratedField(
        expression=models.Func(F('body'), function='array_length', template="array_length(string_to_array(%(expressions)s, ' '), 1)"),
        output_field=models.IntegerField(),
        db_persist=True,
    )


# QuerySet optimization patterns
class PostManager(models.Manager):
    def published(self):
        return self.filter(published=True).select_related('author')

    def with_stats(self):
        return self.annotate(
            comment_count=Count('comments'),
            avg_rating=Avg('ratings__score'),
        )

    def trending(self, days=7):
        cutoff = Now() - models.DurationField().get_prep_value(timedelta(days=days))
        return (
            self.published()
            .filter(published_at__gte=cutoff)
            .annotate(engagement=Count('comments') + Count('likes'))
            .order_by('-engagement')
        )


# Efficient querying
posts = (
    Post.objects
    .select_related('author')                    # FK JOIN (single query)
    .prefetch_related(
        'tags',                                   # M2M (separate query)
        Prefetch('comments',                      # Custom prefetch
            queryset=Comment.objects.select_related('user').order_by('-created_at')[:5],
            to_attr='recent_comments',
        ),
    )
    .filter(Q(title__icontains='django') | Q(body__icontains='django'))
    .filter(published=True)
    .only('id', 'title', 'slug', 'author__username')  # Defer unused fields
    .order_by('-published_at')
)

# Bulk operations (avoid N+1)
Post.objects.filter(author=user).update(published=False)  # Single UPDATE
Post.objects.bulk_create([Post(title=t) for t in titles], batch_size=1000)
Post.objects.bulk_update(posts, ['title', 'body'], batch_size=500)
```

## Django REST Framework

```python
from rest_framework import serializers, viewsets, permissions, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

class PostSerializer(serializers.ModelSerializer):
    author = serializers.StringRelatedField(read_only=True)
    comment_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Post
        fields = ['id', 'title', 'slug', 'body', 'author', 'tags', 'comment_count', 'created_at']
        read_only_fields = ['slug']

    def validate_title(self, value):
        qs = Post.objects.filter(title=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Title must be unique.")
        return value

    def create(self, validated_data):
        tags = validated_data.pop('tags', [])
        post = Post.objects.create(
            author=self.context['request'].user,
            **validated_data,
        )
        post.tags.set(tags)
        return post


class PostViewSet(viewsets.ModelViewSet):
    serializer_class = PostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['published', 'author']
    search_fields = ['title', 'body']
    ordering_fields = ['created_at', 'published_at']
    ordering = ['-created_at']

    def get_queryset(self):
        return (
            Post.objects
            .select_related('author')
            .prefetch_related('tags')
            .annotate(comment_count=Count('comments'))
        )

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def publish(self, request, pk=None):
        post = self.get_object()
        post.published = True
        post.published_at = timezone.now()
        post.save(update_fields=['published', 'published_at'])
        return Response(self.get_serializer(post).data)
```

## Django 5.1 — ASGI & Async Views

```python
# settings.py — ASGI configuration
ASGI_APPLICATION = 'myproject.asgi.application'

# Async view (Django 4.1+)
from django.http import JsonResponse
from asgiref.sync import sync_to_async

async def async_post_list(request):
    # Django 5.1: async ORM support
    posts = [p async for p in Post.objects.filter(published=True)[:20]]
    return JsonResponse({'data': [{'id': p.id, 'title': p.title} for p in posts]})

# Async class-based view
from django.views import View

class AsyncPostView(View):
    async def get(self, request, pk):
        post = await Post.objects.select_related('author').aget(pk=pk)
        return JsonResponse({'title': post.title, 'author': post.author.username})
```

## Signals, Celery & Testing

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from celery import shared_task

@receiver(post_save, sender=Post)
def on_post_published(sender, instance, created, **kwargs):
    if not created and instance.published:
        notify_subscribers.delay(instance.pk)

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def notify_subscribers(self, post_id):
    try:
        post = Post.objects.select_related('author').get(pk=post_id)
        subscribers = post.author.subscribers.values_list('email', flat=True)
        send_mass_mail([(f'New post: {post.title}', post.body[:200], None, [email]) for email in subscribers])
    except Post.DoesNotExist:
        return
    except Exception as exc:
        raise self.retry(exc=exc)

# Testing
from rest_framework.test import APITestCase
from model_bakery import baker

class PostAPITest(APITestCase):
    def setUp(self):
        self.user = baker.make('auth.User')
        self.client.force_authenticate(user=self.user)

    def test_create_post(self):
        response = self.client.post('/api/posts/', {
            'title': 'Test Post',
            'body': 'Content that is long enough for validation',
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['author'], str(self.user))

    def test_unauthorized_publish(self):
        post = baker.make(Post, author=baker.make('auth.User'))
        response = self.client.post(f'/api/posts/{post.pk}/publish/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
```

---

# FASTAPI 0.115+

## Pydantic v2 Models & Validation

```python
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict
from datetime import datetime
from enum import Enum

class PostStatus(str, Enum):
    draft = "draft"
    published = "published"
    archived = "archived"

class PostCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=255, examples=["My First Post"])
    body: str = Field(..., min_length=50)
    tags: list[str] = Field(default_factory=list, max_length=5)
    status: PostStatus = PostStatus.draft

    @field_validator('title')
    @classmethod
    def title_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Title cannot be blank')
        return v.strip()

    @field_validator('tags')
    @classmethod
    def tags_lowercase(cls, v: list[str]) -> list[str]:
        return [tag.lower().strip() for tag in v]

    @model_validator(mode='after')
    def published_needs_content(self) -> 'PostCreate':
        if self.status == PostStatus.published and len(self.body) < 100:
            raise ValueError('Published posts need at least 100 characters')
        return self

class PostResponse(BaseModel):
    id: int
    title: str
    author_id: int
    status: PostStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)  # Pydantic v2 ORM mode

class PaginatedResponse[T](BaseModel):  # Python 3.12+ generic syntax
    data: list[T]
    total: int
    page: int
    page_size: int
    has_next: bool
```

## Dependency Injection & Async Patterns

```python
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from typing import Annotated
from collections.abc import AsyncGenerator

# Async database session
engine = create_async_engine(settings.DATABASE_URL, pool_size=20, max_overflow=10)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

# Auth dependency chain
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# Type aliases for cleaner signatures
CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]

app = FastAPI(title="Posts API", version="1.0.0")

@app.post("/posts/", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
async def create_post(
    post: PostCreate,
    background_tasks: BackgroundTasks,
    db: DbSession,
    user: CurrentUser,
):
    db_post = Post(**post.model_dump(), author_id=user.id)
    db.add(db_post)
    await db.flush()
    await db.refresh(db_post)
    background_tasks.add_task(send_notification, user.id, db_post.id)
    return db_post

@app.get("/posts/", response_model=PaginatedResponse[PostResponse])
async def list_posts(
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    status_filter: PostStatus | None = None,
):
    query = select(Post).order_by(Post.created_at.desc())
    if status_filter:
        query = query.where(Post.status == status_filter)

    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    posts = await db.scalars(query.offset((page - 1) * page_size).limit(page_size))

    return PaginatedResponse(
        data=posts.all(),
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )
```

## SQLAlchemy 2.0 Async & Alembic

```python
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String, ForeignKey, Index
from datetime import datetime

class Base(DeclarativeBase):
    pass

class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column()
    status: Mapped[str] = mapped_column(String(20), default="draft")
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    author: Mapped["User"] = relationship(back_populates="posts", lazy="selectin")
    tags: Mapped[list["Tag"]] = relationship(secondary="post_tags", lazy="selectin")

    __table_args__ = (
        Index("ix_posts_status_created", "status", "created_at"),
    )

# Alembic async migration
# alembic revision --autogenerate -m "add posts table"
# alembic upgrade head
```

## Middleware, Error Handling & Lifespan

```python
from contextlib import asynccontextmanager
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    redis = await aioredis.from_url(settings.REDIS_URL)
    app.state.redis = redis
    yield
    # Shutdown
    await redis.close()
    await engine.dispose()

app = FastAPI(lifespan=lifespan)

app.add_middleware(CORSMiddleware, allow_origins=settings.ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def add_request_context(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{duration:.3f}s"
    return response

# Global exception handler
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"message": exc.detail, "code": exc.status_code}},
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": {"message": "Internal server error"}},
    )
```

## Testing FastAPI

```python
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

@pytest.fixture
async def auth_client(client: AsyncClient, test_user: User):
    token = create_access_token({"sub": str(test_user.id)})
    client.headers["Authorization"] = f"Bearer {token}"
    return client

@pytest.mark.anyio
async def test_create_post(auth_client: AsyncClient):
    response = await auth_client.post("/posts/", json={
        "title": "Test Post",
        "body": "x" * 100,
        "tags": ["python", "fastapi"],
    })
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Post"
    assert data["status"] == "draft"

@pytest.mark.anyio
async def test_list_posts_pagination(client: AsyncClient):
    response = await client.get("/posts/?page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "total" in data
    assert data["page"] == 1

@pytest.mark.anyio
async def test_validation_error(auth_client: AsyncClient):
    response = await auth_client.post("/posts/", json={"title": "ab", "body": "short"})
    assert response.status_code == 422
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Django: Filter in Python | QuerySet `.filter()`, `F()`, `Q()` |
| Django: No `select_related`/`prefetch_related` | Profile with `django-debug-toolbar` |
| Django: N+1 in serializers | Override `get_queryset()` with joins |
| Django: Fat views | Extract to services/managers |
| FastAPI: Blocking sync in async endpoint | `async def` + async I/O or `run_in_executor` |
| FastAPI: No `response_model` | Always declare — validates output + OpenAPI |
| FastAPI: Global mutable state | Use `app.state` or dependency injection |
| FastAPI: No lifespan management | Use `lifespan` context manager for startup/shutdown |
| Both: No input validation | Pydantic/serializer validation on every endpoint |
| Both: Secrets in code | Environment variables via `pydantic-settings` or `django-environ` |
| Both: No pagination | Always paginate list endpoints |
| Both: Raw SQL without parameterization | ORM or parameterized queries only |

---

## Verification Checklist

Before considering Django/FastAPI work done:
- [ ] All queries optimized (select_related, prefetch_related, indexes)
- [ ] Input validated at API boundary (serializers / Pydantic models)
- [ ] Response models defined (no raw dicts leaking internal fields)
- [ ] Auth/permissions on all non-public endpoints
- [ ] Async endpoints don't call blocking I/O
- [ ] Database migrations generated and tested
- [ ] Error responses follow consistent format
- [ ] Background tasks for slow operations (email, notifications)
- [ ] Tests cover happy path, validation errors, and auth failures
- [ ] No N+1 queries (verified with debug toolbar or query logging)
- [ ] Pagination on all list endpoints
- [ ] CORS, rate limiting, and security headers configured
