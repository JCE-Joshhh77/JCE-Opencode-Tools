---
name: express-nestjs
description: Express.js, NestJS, Node.js APIs. Use when working on express-nestjs tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Express.js & NestJS
# Loaded on-demand when working with Express, NestJS, Node.js APIs

## Auto-Detect

Trigger this skill when:
- `package.json` contains: `express`, `@nestjs/core`, `fastify`, `@nestjs/platform-fastify`
- File patterns: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`
- Imports from: `express`, `@nestjs/common`, `@nestjs/core`
- Directory patterns: `src/modules/`, `src/controllers/`, `src/middleware/`

---

## Decision Tree: Framework Choice

```
What are you building?
├── Simple API / microservice (< 10 endpoints)?
│   ├── Need maximum performance? → Fastify (standalone)
│   └── Team familiarity / ecosystem? → Express
├── Large enterprise application?
│   ├── Need structure, DI, modules? → NestJS
│   ├── Need high throughput? → NestJS + Fastify adapter
│   └── Need microservices? → NestJS + transport layer (gRPC, NATS, Kafka)
├── Real-time + REST hybrid?
│   └── NestJS (built-in WebSocket gateway)
└── Serverless / edge?
    └── Hono or Express (lightweight, no DI overhead)
```

## Decision Tree: NestJS Architecture

```
How to structure the feature?
├── HTTP request handling? → Controller
├── Business logic? → Service (Injectable)
├── Data access? → Repository pattern (Injectable)
├── Cross-cutting concern (logging, timing)? → Interceptor
├── Request validation? → Pipe (ValidationPipe + class-validator or Zod)
├── Auth / authorization? → Guard
├── Request transformation before handler? → Middleware
├── Response transformation? → Interceptor
├── Error formatting? → Exception Filter
└── Event-driven side effect? → EventEmitter or Queue (Bull)
```

---

# EXPRESS.JS

## Middleware Stack & Security

```typescript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';

const app = express();

// Order matters: security → logging → parsing → auth → routes → error handler
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
  maxAge: 86400,
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true }));
app.use(pinoHttp({ level: process.env.LOG_LEVEL ?? 'info' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Async wrapper — eliminates try/catch in every route
const asyncHandler = (fn: Function) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Validation middleware with Zod
import { z, ZodSchema } from 'zod';

function validate(schema: { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Record<string, any> = {};
    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      if (!result.success) errors.body = result.error.flatten().fieldErrors;
      else req.body = result.data;
    }
    if (schema.query) {
      const result = schema.query.safeParse(req.query);
      if (!result.success) errors.query = result.error.flatten().fieldErrors;
    }
    if (schema.params) {
      const result = schema.params.safeParse(req.params);
      if (!result.success) errors.params = result.error.flatten().fieldErrors;
    }
    if (Object.keys(errors).length) return res.status(400).json({ errors });
    next();
  };
}
```

## Router Organization

```typescript
// routes/posts.ts
import { Router } from 'express';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const posts = await postService.findAll(req.query);
  res.json({ data: posts });
}));

router.post('/',
  authenticate,
  validate({ body: createPostSchema }),
  asyncHandler(async (req, res) => {
    const post = await postService.create(req.body, req.user!);
    res.status(201).json({ data: post });
  })
);

router.put('/:id',
  authenticate,
  authorize('post:update'),
  validate({ body: updatePostSchema, params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const post = await postService.update(req.params.id, req.body);
    res.json({ data: post });
  })
);

export { router as postsRouter };

// app.ts
app.use('/api/posts', postsRouter);
app.use('/api/users', usersRouter);
```

## Error Handling & Graceful Shutdown

```typescript
// Custom error class
class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Centralized error handler — MUST have 4 params
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({ error: { message: 'Validation failed', details: err } });
  }

  // Unknown errors — don't leak internals
  req.log.error(err);
  res.status(500).json({ error: { message: 'Internal Server Error' } });
});

// Graceful shutdown
const server = app.listen(PORT, () => console.log(`Listening on ${PORT}`));

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await db.$disconnect();
    await redis.quit();
    process.exit(0);
  });
  setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

# NESTJS 11

## Module Structure

```typescript
// posts/posts.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([Post]), BullModule.registerQueue({ name: 'notifications' })],
  controllers: [PostsController],
  providers: [PostsService, PostsRepository],
  exports: [PostsService],
})
export class PostsModule {}

// app.module.ts — or use standalone bootstrap
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: envSchema.parse }),
    TypeOrmModule.forRootAsync({ useFactory: (config: ConfigService) => ({ /* ... */ }), inject: [ConfigService] }),
    PostsModule,
    UsersModule,
  ],
})
export class AppModule {}
```

## Controllers & DTOs

```typescript
// posts/posts.controller.ts
@Controller('posts')
@UseGuards(JwtAuthGuard)
@ApiTags('Posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'List posts with pagination' })
  @ApiOkResponse({ type: PaginatedPostsDto })
  findAll(@Query() query: PaginationDto): Promise<PaginatedPostsDto> {
    return this.postsService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: PostResponseDto })
  create(
    @Body() dto: CreatePostDto,
    @CurrentUser() user: User,
  ): Promise<PostResponseDto> {
    return this.postsService.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(PostOwnerGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    return this.postsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PostOwnerGuard)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.postsService.remove(id);
  }
}

// DTOs with class-validator
export class CreatePostDto {
  @IsString() @MinLength(3) @MaxLength(255)
  title: string;

  @IsString() @MinLength(10)
  body: string;

  @IsArray() @IsString({ each: true }) @MaxLength(5, { each: true })
  @IsOptional()
  tags?: string[];
}

// Or with Zod (NestJS 11 native support)
import { createZodDto } from 'nestjs-zod';
const CreatePostSchema = z.object({
  title: z.string().min(3).max(255),
  body: z.string().min(10),
  tags: z.array(z.string()).max(5).optional(),
});
export class CreatePostDto extends createZodDto(CreatePostSchema) {}
```

## Guards, Interceptors & Pipes

```typescript
// Auth guard
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private jwtService = inject(JwtService);
  private usersService = inject(UsersService);

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException();

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.user = await this.usersService.findById(payload.sub);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }

  private extractToken(req: Request): string | undefined {
    return req.headers.authorization?.replace('Bearer ', '');
  }
}

// Role guard with decorator
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  private reflector = inject(Reflector);

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', ctx.getHandler());
    if (!roles) return true;
    const user = ctx.switchToHttp().getRequest().user;
    return roles.some(r => user.roles.includes(r));
  }
}

// Transform interceptor — standardize response format
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T> {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const now = Date.now();
    return next.handle().pipe(
      map(data => ({
        data,
        meta: { timestamp: new Date().toISOString(), duration: `${Date.now() - now}ms` },
      })),
    );
  }
}

// Logging interceptor
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const { method, url } = req;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => this.logger.log(`${method} ${url} ${Date.now() - now}ms`)),
      catchError(err => {
        this.logger.error(`${method} ${url} ${err.status} ${Date.now() - now}ms`);
        return throwError(() => err);
      }),
    );
  }
}
```

## Fastify Adapter

```typescript
// main.ts — use Fastify for better performance
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(',') });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());

  // OpenAPI generation
  const config = new DocumentBuilder()
    .setTitle('API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(3000, '0.0.0.0');
}
bootstrap();
```

## Microservices

```typescript
// Hybrid app: HTTP + microservice transport
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Connect to NATS for inter-service communication
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: { servers: [process.env.NATS_URL] },
  });

  await app.startAllMicroservices();
  await app.listen(3000);
}

// Message patterns
@Controller()
export class OrdersController {
  @MessagePattern('orders.created')
  handleOrderCreated(@Payload() data: OrderCreatedEvent) {
    return this.ordersService.process(data);
  }

  @EventPattern('payments.completed')
  handlePaymentCompleted(@Payload() data: PaymentEvent) {
    this.ordersService.markPaid(data.orderId);
  }
}

// Emit from another service
@Injectable()
export class PaymentsService {
  constructor(@Inject('ORDERS_SERVICE') private client: ClientProxy) {}

  async processPayment(orderId: string) {
    // Request-response
    const order = await firstValueFrom(
      this.client.send('orders.get', { orderId })
    );
    // Event (fire-and-forget)
    this.client.emit('payments.completed', { orderId, amount: order.total });
  }
}
```

## OpenAPI Generation

```typescript
// Automatic OpenAPI spec from decorators
@ApiTags('Users')
@Controller('users')
export class UsersController {
  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ type: UserResponseDto, description: 'User found' })
  @ApiNotFoundResponse({ description: 'User not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }
}

// Generate OpenAPI JSON at build time for client SDK generation
// npx nest build && node -e "require('./dist/swagger').generateSpec()"
```

## Testing

```typescript
describe('PostsController', () => {
  let controller: PostsController;
  let service: PostsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [
        {
          provide: PostsService,
          useValue: {
            findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
            create: jest.fn().mockResolvedValue({ id: '1', title: 'Test' }),
          },
        },
      ],
    }).compile();

    controller = module.get(PostsController);
    service = module.get(PostsService);
  });

  it('creates a post', async () => {
    const dto = { title: 'Test Post', body: 'Content here...' };
    const user = { id: '1', email: 'test@test.com' } as User;
    const result = await controller.create(dto, user);
    expect(service.create).toHaveBeenCalledWith(dto, user);
    expect(result).toHaveProperty('id');
  });
});

// E2E test
describe('Posts (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  it('POST /posts returns 201', () => {
    return request(app.getHttpServer())
      .post('/posts')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ title: 'Test', body: 'Content that is long enough' })
      .expect(201)
      .expect(res => expect(res.body.data).toHaveProperty('id'));
  });

  afterAll(() => app.close());
});
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Express: No async error handling | `asyncHandler` wrapper or `express-async-errors` |
| Express: Business logic in routes | Extract to service layer |
| Express: Missing security middleware | Always: helmet, cors, rate-limit |
| Express: No request validation | Zod middleware on every route |
| NestJS: Circular dependencies | `forwardRef()` or restructure modules |
| NestJS: Fat controllers | Services + DTOs + Pipes |
| NestJS: Catching all exceptions globally | Use specific exception filters |
| NestJS: Sync operations in async context | Always use async/await properly |
| Both: No graceful shutdown | Handle SIGTERM/SIGINT, drain connections |
| Both: Secrets in code | ConfigService / env variables |
| Both: No request ID tracking | Add request-id middleware/interceptor |
| Both: Untyped error responses | Consistent error format (RFC 7807) |

---

## Verification Checklist

Before considering Express/NestJS work done:
- [ ] Security middleware applied (helmet, cors, rate limiting)
- [ ] All inputs validated (Zod or class-validator) before processing
- [ ] Centralized error handling with consistent response format
- [ ] Graceful shutdown handles SIGTERM/SIGINT
- [ ] Request logging with correlation IDs
- [ ] Auth guard/middleware on protected routes
- [ ] DTOs separate from domain entities
- [ ] OpenAPI/Swagger documentation generated
- [ ] Unit tests for services, integration tests for controllers
- [ ] No secrets hardcoded — all from environment/config
- [ ] Database connections pooled and properly closed on shutdown
- [ ] Response format standardized: `{ data, meta, errors }`
