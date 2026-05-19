---
name: ai-llm-engineering
description: RAG, embeddings, vector DB, prompt engineering, LLM evaluation. Use when working on ai-llm-engineering tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: AI/LLM Engineering

## Auto-Detect

Trigger this skill when:
- Task mentions: RAG, embeddings, vector database, LLM, prompt engineering, fine-tuning, AI
- Files: `prompts/`, `embeddings/`, `*.prompt`, `rag/`, `chains/`
- Patterns: retrieval augmented generation, semantic search, chat completion
- Dependencies: `openai`, `@anthropic-ai/sdk`, `langchain`, `@pinecone-database/pinecone`, `@qdrant/js-client-rest`

---

## Decision Tree: RAG Architecture

```
What retrieval quality do you need?
├── Basic Q&A over docs (< 1000 pages)?
│   └── Naive RAG: chunk → embed → retrieve → generate
├── High accuracy, complex queries?
│   └── Advanced RAG: query rewriting + hybrid search + reranking
├── Multi-hop reasoning across documents?
│   └── Agentic RAG: iterative retrieval with LLM-driven query planning
├── Structured + unstructured data?
│   └── Graph RAG: knowledge graph + vector search combined
└── Real-time data (< 1 hour freshness)?
    └── Streaming RAG: webhook ingestion + incremental indexing
```

## Decision Tree: Vector Database

```
├── Already using PostgreSQL? → pgvector (simplest ops, good to ~5M vectors)
├── Need managed + serverless? → Pinecone (zero ops, auto-scaling)
├── Need self-hosted + high performance? → Qdrant (Rust, fast, rich filtering)
├── Need hybrid search (vector + BM25)? → Weaviate or Elasticsearch 8+
├── Need multi-modal (image + text)? → Weaviate or Milvus
├── Budget-constrained, < 100K docs? → SQLite-vss or ChromaDB (local)
└── Enterprise, multi-tenant at scale? → Pinecone (namespaces) or Qdrant (collections)
```

## Decision Tree: Chunking Strategy

```
What content type?
├── Prose (articles, docs)?
│   └── Semantic chunking: split at paragraph/section boundaries, 512-1024 tokens
├── Code?
│   └── AST-aware chunking: split at function/class boundaries
├── Structured (tables, JSON)?
│   └── Record-level chunking: one chunk per logical record
├── Conversations/transcripts?
│   └── Speaker-turn chunking: group by speaker + topic shift
└── Mixed content (markdown with code)?
    └── Hierarchical: parent chunk (section) + child chunks (paragraphs)
```

---

## RAG Pipeline Implementation

```typescript
import { OpenAI } from 'openai';
import { QdrantClient } from '@qdrant/js-client-rest';

interface RAGConfig {
  chunkSize: number;        // 512-1024 tokens
  chunkOverlap: number;     // 10-20% of chunk size
  topK: number;             // 5-10 results
  scoreThreshold: number;   // 0.7-0.8 minimum similarity
  rerankModel?: string;     // Cohere rerank or cross-encoder
}

class RAGPipeline {
  constructor(
    private readonly llm: OpenAI,
    private readonly vectorDb: QdrantClient,
    private readonly config: RAGConfig
  ) {}

  // Semantic chunking with sentence boundary respect
  chunkDocument(text: string, metadata: DocMetadata): Chunk[] {
    const chunks: Chunk[] = [];
    const paragraphs = text.split(/\n\n+/);
    let current: string[] = [];
    let currentTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = this.countTokens(para);

      if (currentTokens + paraTokens > this.config.chunkSize && current.length > 0) {
        chunks.push({
          text: current.join('\n\n'),
          tokens: currentTokens,
          metadata: { ...metadata, chunkIndex: chunks.length },
        });
        // Overlap: keep last paragraph
        const overlap = current.slice(-1);
        current = overlap;
        currentTokens = this.countTokens(overlap.join('\n\n'));
      }
      current.push(para);
      currentTokens += paraTokens;
    }

    if (current.length > 0) {
      chunks.push({ text: current.join('\n\n'), tokens: currentTokens, metadata });
    }
    return chunks;
  }

  // Batch embedding with rate limiting
  async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const results: EmbeddedChunk[] = [];
    const batchSize = 100; // API limit

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const response = await this.llm.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch.map(c => c.text),
        dimensions: 1024, // Matryoshka: reduce dims for speed/cost
      });
      for (let j = 0; j < batch.length; j++) {
        results.push({ ...batch[j], embedding: response.data[j].embedding });
      }
    }
    return results;
  }

  // Advanced retrieval: query expansion + hybrid search
  async retrieve(query: string): Promise<RetrievedChunk[]> {
    // Step 1: Query expansion (generate sub-queries)
    const expandedQueries = await this.expandQuery(query);

    // Step 2: Retrieve from all queries
    const allResults: RetrievedChunk[] = [];
    for (const q of [query, ...expandedQueries]) {
      const embedding = await this.embedQuery(q);
      const results = await this.vectorDb.search('documents', {
        vector: embedding,
        limit: this.config.topK,
        score_threshold: this.config.scoreThreshold,
        with_payload: true,
      });
      allResults.push(...results);
    }

    // Step 3: Deduplicate + rerank
    const unique = this.deduplicateByContent(allResults);
    return this.rerank(query, unique).slice(0, this.config.topK);
  }

  // Generation with citation tracking
  async generate(query: string, context: RetrievedChunk[]): Promise<RAGResponse> {
    const contextText = context
      .map((c, i) => `[${i + 1}] ${c.payload.text}`)
      .join('\n\n');

    const response = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Answer based ONLY on provided context. Cite sources as [N].
If context is insufficient, say "I don't have enough information to answer this."
Never fabricate information not present in the sources.`,
        },
        { role: 'user', content: `Context:\n${contextText}\n\nQuestion: ${query}` },
      ],
      temperature: 0.1,
    });

    return {
      answer: response.choices[0].message.content!,
      sources: context.map(c => c.payload.metadata),
      model: 'gpt-4o',
    };
  }
}
```

---

## Prompt Engineering Patterns

```typescript
// Pattern 1: Structured output with schema enforcement
const structuredPrompt = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: `Extract entities from: "${text}"` }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'entities',
      schema: {
        type: 'object',
        properties: {
          people: { type: 'array', items: { type: 'string' } },
          organizations: { type: 'array', items: { type: 'string' } },
          locations: { type: 'array', items: { type: 'string' } },
        },
        required: ['people', 'organizations', 'locations'],
      },
    },
  },
};

// Pattern 2: Chain of Thought with verification
const cotPrompt = `Solve step by step. After your solution, verify by checking:
1. Does the answer satisfy all constraints?
2. Are there edge cases I missed?

Problem: {problem}`;

// Pattern 3: Few-shot with negative examples
const classificationPrompt = `Classify support tickets. Include confidence score.

CORRECT examples:
Input: "I can't log in" → {"category": "auth", "priority": "high", "confidence": 0.95}
Input: "How do I export?" → {"category": "feature_question", "priority": "low", "confidence": 0.9}

INCORRECT (don't do this):
Input: "I can't log in" → {"category": "general"} // Too vague, missing fields

Now classify: "{ticket}"`;

// Pattern 4: Self-consistency (majority vote over N samples)
async function selfConsistency(prompt: string, n = 5): Promise<string> {
  const responses = await Promise.all(
    Array.from({ length: n }, () =>
      llm.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      })
    )
  );
  const answers = responses.map(r => extractFinalAnswer(r.choices[0].message.content!));
  return majorityVote(answers);
}
```

---

## Evaluation Framework (RAGAS-style)

```typescript
interface RAGEvalMetrics {
  faithfulness: number;      // Answer grounded in context (no hallucination)
  answerRelevancy: number;   // Answer addresses the question
  contextRecall: number;     // Retrieval found relevant docs
  contextPrecision: number;  // Retrieved docs are actually useful
}

class RAGEvaluator {
  async evaluate(testCase: EvalTestCase): Promise<RAGEvalMetrics> {
    const [faithfulness, relevancy, recall, precision] = await Promise.all([
      this.measureFaithfulness(testCase.answer, testCase.contexts),
      this.measureRelevancy(testCase.answer, testCase.question),
      this.measureRecall(testCase.groundTruth, testCase.contexts),
      this.measurePrecision(testCase.question, testCase.contexts),
    ]);
    return { faithfulness, answerRelevancy: relevancy, contextRecall: recall, contextPrecision: precision };
  }

  // Faithfulness: decompose answer into claims, verify each against context
  private async measureFaithfulness(answer: string, contexts: string[]): Promise<number> {
    const claims = await this.extractClaims(answer);
    const verified = await Promise.all(
      claims.map(claim => this.isClaimSupported(claim, contexts))
    );
    return verified.filter(Boolean).length / claims.length;
  }

  // Run eval suite and track regressions
  async runSuite(testCases: EvalTestCase[]): Promise<EvalReport> {
    const results = await Promise.all(testCases.map(tc => this.evaluate(tc)));
    return {
      averages: this.computeAverages(results),
      failures: results.filter(r => r.faithfulness < 0.8 || r.contextRecall < 0.7),
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## Guardrails

```typescript
class LLMGuardrails {
  async validateInput(input: string): Promise<GuardrailResult> {
    const checks = await Promise.all([
      this.detectPromptInjection(input),
      this.detectPII(input),
      this.checkTokenLimit(input, 4096),
    ]);
    return { passed: checks.every(c => c.passed), violations: checks.filter(c => !c.passed) };
  }

  async validateOutput(output: string, context: { sources: string[] }): Promise<GuardrailResult> {
    const checks = await Promise.all([
      this.detectHallucination(output, context.sources),
      this.detectPIILeakage(output),
      this.detectToxicity(output),
    ]);
    return { passed: checks.every(c => c.passed), violations: checks.filter(c => !c.passed) };
  }

  private async detectPromptInjection(input: string): Promise<Check> {
    const patterns = [
      /ignore (all )?(previous|above) instructions/i,
      /you are now/i,
      /\[INST\]|<\|im_start\|>/i,
    ];
    if (patterns.some(p => p.test(input))) {
      const score = await this.classifyInjection(input); // ML classifier
      return { passed: score < 0.8, reason: 'Potential prompt injection', score };
    }
    return { passed: true };
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Stuffing full documents into context | Token waste, dilutes relevance | Chunk + retrieve only relevant sections |
| No evaluation before production | Unknown quality, silent failures | Automated eval suite (RAGAS/DeepEval) |
| Single chunking strategy for all content | Code split mid-function, tables broken | Content-aware chunking (AST, semantic) |
| Ignoring token costs at scale | Bills explode 10-100x | Model routing + semantic caching |
| No output validation | Hallucinations reach users | Guardrails + citation verification |
| Fine-tuning before exhausting prompting | Expensive, slow iteration, overfitting | Few-shot → CoT → self-consistency first |
| Same embedding model for all content | Suboptimal retrieval | Task-specific models (code vs prose) |
| No reranking after retrieval | Top-K includes irrelevant results | Cross-encoder reranker (Cohere, BGE) |

---

## Verification Checklist

- [ ] Chunking respects content boundaries (no mid-sentence splits)
- [ ] Embedding dimensions match vector DB index configuration
- [ ] Retrieval returns relevant results for 10+ test queries
- [ ] Faithfulness score > 0.85 on eval suite
- [ ] Context recall > 0.75 on eval suite
- [ ] Guardrails block prompt injection attempts
- [ ] Output never contains PII from training data
- [ ] Semantic cache hit rate > 30% for repeated query patterns
- [ ] Token costs tracked and within budget per request
- [ ] Fallback behavior defined when retrieval returns no results
