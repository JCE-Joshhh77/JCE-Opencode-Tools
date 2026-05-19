---
name: ai-optimization
description: Token efficiency, model selection, prompt engineering. Use when working on ai-optimization tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: AI/LLM Optimization

## Auto-Detect

Trigger this skill when:
- Task mentions: token efficiency, context window, model selection, structured output, caching
- Patterns: reducing token usage, choosing models, prompt optimization, tool use design
- Context: building AI-powered features, optimizing LLM API costs, managing context windows

---

## Decision Tree: Model Selection

```
What task are you solving?
+-- Simple classification / extraction / formatting?
|   +-- GPT-4o-mini or Claude Haiku (cheapest, fastest)
+-- Standard coding, summarization, Q&A?
|   +-- GPT-4o or Claude Sonnet (best quality/cost ratio)
+-- Complex reasoning, architecture, multi-step?
|   +-- Claude Opus or o3 (maximum capability)
+-- Math, logic, formal proofs?
|   +-- o3 or Gemini 2.5 Pro (specialized reasoning)
+-- Bulk processing (1000+ items)?
|   +-- Batch API (50% cheaper) + cheapest sufficient model
+-- Privacy-sensitive / offline?
|   +-- Local model (Llama 3, Mistral, Phi-3)
+-- Need real-time streaming?
    +-- Any cloud model with streaming API + SSE
```

## Decision Tree: Context Window Strategy

```
Context approaching limit?
+-- Can summarize older messages? -> Rolling summary (compress history)
+-- Need full conversation? -> Sliding window (keep last N turns)
+-- Large document analysis? -> Chunk + map-reduce pattern
+-- Code context? -> Only include relevant files (not entire repo)
+-- RAG retrieval? -> Top-K chunks only (not full documents)
+-- Multi-turn with tools? -> Prune tool results after use
```

---

## Token Efficiency Patterns

```typescript
// Pattern 1: Structured output (fewer tokens than prose)
// BAD: "Please return the result as a JSON object with fields..."
// GOOD: Use response_format with schema

const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: `Extract entities from: "${text}"` }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'entities',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          people: { type: 'array', items: { type: 'string' } },
          orgs: { type: 'array', items: { type: 'string' } },
        },
        required: ['people', 'orgs'],
        additionalProperties: false,
      },
    },
  },
});

// Pattern 2: System prompt compression
// BAD: Long, repetitive system prompts with examples in every request
// GOOD: Cache system prompt (Anthropic prompt caching, OpenAI stored context)

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  system: [
    {
      type: 'text',
      text: longSystemPrompt, // 5000+ tokens
      cache_control: { type: 'ephemeral' }, // Cached after first use
    },
  ],
  messages: userMessages,
});

// Pattern 3: Progressive detail (don't over-generate)
const systemPrompt = `Answer concisely in 1-3 sentences.
If the user asks for more detail, expand.
Never repeat information the user already stated.`;

// Pattern 4: Diff over rewrite
// Instead of regenerating entire files, ask for targeted edits
const editPrompt = `Given this function, return ONLY the lines that need to change.
Format: line_number: new_content`;
```

---

## Context Window Management

```typescript
// Sliding window with summary compression
class ConversationManager {
  private messages: Message[] = [];
  private readonly maxTokens: number;
  private readonly summaryThreshold: number;

  constructor(maxTokens = 100_000, summaryThreshold = 0.7) {
    this.maxTokens = maxTokens;
    this.summaryThreshold = summaryThreshold; // Compress at 70% capacity
  }

  async addMessage(message: Message): Promise<void> {
    this.messages.push(message);

    const currentTokens = this.countTokens(this.messages);
    if (currentTokens > this.maxTokens * this.summaryThreshold) {
      await this.compress();
    }
  }

  private async compress(): Promise<void> {
    // Keep system prompt + last N messages intact
    const systemPrompt = this.messages[0];
    const recentMessages = this.messages.slice(-6); // Keep last 3 turns
    const oldMessages = this.messages.slice(1, -6);

    // Summarize old messages
    const summary = await this.summarize(oldMessages);

    this.messages = [
      systemPrompt,
      { role: 'system', content: `Previous conversation summary:\n${summary}` },
      ...recentMessages,
    ];
  }

  private async summarize(messages: Message[]): Promise<string> {
    const response = await llm.chat.completions.create({
      model: 'gpt-4o-mini', // Cheap model for summarization
      messages: [
        { role: 'system', content: 'Summarize this conversation in bullet points. Keep key decisions, code references, and action items.' },
        { role: 'user', content: messages.map(m => `${m.role}: ${m.content}`).join('\n') },
      ],
      max_tokens: 500,
    });
    return response.choices[0].message.content!;
  }
}

// Tool result pruning: don't keep large tool outputs in context
function pruneToolResults(messages: Message[]): Message[] {
  return messages.map(msg => {
    if (msg.role === 'tool' && msg.content.length > 2000) {
      return { ...msg, content: msg.content.slice(0, 500) + '\n[...truncated...]' };
    }
    return msg;
  });
}
```

---

## Tool Use Patterns

```typescript
// Design tools for minimal token overhead
const tools = [
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: 'Search for code patterns. Returns file paths and matching lines.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Regex or text pattern to search' },
          file_pattern: { type: 'string', description: 'Glob pattern (e.g., "*.ts")' },
        },
        required: ['query'],
      },
    },
  },
];

// Tool design principles:
// 1. Return minimal data (paths + line numbers, not full files)
// 2. Support filtering (file_pattern, limit) to reduce output
// 3. Paginate large results (return first 10, offer "next page")
// 4. Structured output (JSON, not prose) for tool results
// 5. Include "no results" case explicitly

// Parallel tool calls: batch independent operations
// The model can call multiple tools in one turn — design tools to be independent
```

---

## Caching Strategies

```typescript
// Layer 1: Exact match cache (Redis/in-memory)
class ExactCache {
  async get(prompt: string): Promise<string | null> {
    const key = createHash('sha256').update(prompt).digest('hex');
    return this.redis.get(`llm:exact:${key}`);
  }
}

// Layer 2: Semantic cache (vector similarity)
class SemanticCache {
  async get(query: string): Promise<string | null> {
    const embedding = await this.embed(query);
    const results = await this.vectorDb.search({
      vector: embedding,
      limit: 1,
      score_threshold: 0.95, // Very high similarity required
    });
    if (results.length > 0 && !this.isExpired(results[0])) {
      return results[0].payload.response;
    }
    return null;
  }
}

// Layer 3: Prompt caching (provider-level)
// - Anthropic: cache_control on system/tool messages (90% cost reduction)
// - OpenAI: automatic prompt prefix caching (50% reduction)
// - Both: cache hits only work with identical prefix

// Cost tracking
class CostTracker {
  private costs: { model: string; inputTokens: number; outputTokens: number; cost: number }[] = [];

  record(model: string, usage: { input: number; output: number }): void {
    const pricing = MODEL_PRICING[model];
    const cost = (usage.input * pricing.input + usage.output * pricing.output) / 1000;
    this.costs.push({ model, inputTokens: usage.input, outputTokens: usage.output, cost });
  }

  getDailyCost(): number {
    const today = new Date().toDateString();
    return this.costs
      .filter(c => new Date(c.timestamp).toDateString() === today)
      .reduce((sum, c) => sum + c.cost, 0);
  }
}
```

---

## Model Routing

```typescript
// Route requests to cheapest sufficient model
class ModelRouter {
  private readonly models = [
    { id: 'gpt-4o-mini', maxComplexity: 'simple', costPer1kTokens: 0.00015 },
    { id: 'gpt-4o', maxComplexity: 'moderate', costPer1kTokens: 0.0025 },
    { id: 'claude-sonnet-4-20250514', maxComplexity: 'complex', costPer1kTokens: 0.003 },
    { id: 'claude-opus-4-20250514', maxComplexity: 'expert', costPer1kTokens: 0.015 },
  ];

  async route(task: string): Promise<string> {
    // Classify task complexity with cheap model
    const complexity = await this.classifyComplexity(task);

    // Select cheapest model that handles this complexity
    const suitable = this.models.filter(m => this.canHandle(m, complexity));
    return suitable[0].id; // Cheapest first
  }

  private async classifyComplexity(task: string): Promise<Complexity> {
    // Use heuristics first (fast, free)
    if (task.length < 100 && !task.includes('explain')) return 'simple';
    if (task.includes('architect') || task.includes('design system')) return 'complex';

    // Fall back to cheap classifier
    const result = await this.classify(task);
    return result;
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Same model for all tasks | 10x cost overrun on simple tasks | Model routing by complexity |
| Full file in every message | Context fills up fast | Reference by path, include only relevant sections |
| No caching layer | Identical queries billed repeatedly | Exact + semantic cache layers |
| Verbose system prompts repeated | Wastes tokens every request | Prompt caching (provider-level) |
| Keeping all tool results in context | Context bloat after many tool calls | Prune/summarize tool results after use |
| No token budget per request | Runaway costs on complex queries | max_tokens + cost tracking + alerts |
| Generating full files instead of diffs | 10x more output tokens | Ask for targeted edits only |
| No fallback when model fails | User sees error, no recovery | Retry with different model, graceful degradation |

---

## Verification Checklist

- [ ] Model selection matches task complexity (not always the most expensive)
- [ ] System prompts use provider caching (Anthropic cache_control, OpenAI prefix)
- [ ] Context window has compression strategy before hitting limit
- [ ] Tool results pruned after consumption (not kept at full size)
- [ ] Cost tracking in place with daily/weekly budget alerts
- [ ] Semantic cache configured for repeated query patterns
- [ ] Structured output (JSON schema) used instead of free-form prose
- [ ] Token usage logged per request for optimization analysis
- [ ] Fallback model configured for rate limits / outages
- [ ] Batch API used for non-real-time bulk processing (50% savings)
