/**
 * Retrieval evaluation harness — Recall@K, MRR, NDCG@K computed directly
 * against the hybrid-search pipeline (same dense+BM25+RRF path as
 * apps/api/src/routes/chat.ts), plus an optional end-to-end citation-accuracy
 * pass that hits the live /chat/completions endpoint.
 *
 * Usage:
 *   cp scripts/golden-qa.example.json scripts/golden-qa.json
 *   # ... fill in real document ids from your own ingested documents ...
 *   pnpm tsx scripts/evaluate-retrieval.ts
 *
 * For citation accuracy too (needs the API running + a valid bearer token):
 *   EVAL_API_URL=http://localhost:3001/api/v1 EVAL_API_TOKEN=... pnpm tsx scripts/evaluate-retrieval.ts
 */
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ChunkRepository } from '../packages/database/src/index.js';
import { NvidiaEmbeddingProvider } from '../packages/providers/src/index.js';

dotenv.config();

interface GoldenQuery {
  query: string;
  relevantDocumentIds: string[];
}

interface RetrievedItem {
  chunk: { id: string; documentId: string };
  document: { id: string };
}

const K = 10;

function reciprocalRankFusion(listA: RetrievedItem[], listB: RetrievedItem[], k = 60) {
  const scores = new Map<string, number>();
  const byId = new Map<string, RetrievedItem>();
  for (const list of [listA, listB]) {
    list.forEach((item, rank) => {
      if (!byId.has(item.chunk.id)) byId.set(item.chunk.id, item);
      scores.set(item.chunk.id, (scores.get(item.chunk.id) || 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => byId.get(id)!);
}

function recallAtK(ranked: RetrievedItem[], relevantDocIds: Set<string>, k: number): number {
  const topK = ranked.slice(0, k);
  return topK.some(r => relevantDocIds.has(r.document.id)) ? 1 : 0;
}

function reciprocalRank(ranked: RetrievedItem[], relevantDocIds: Set<string>): number {
  const index = ranked.findIndex(r => relevantDocIds.has(r.document.id));
  return index === -1 ? 0 : 1 / (index + 1);
}

function ndcgAtK(ranked: RetrievedItem[], relevantDocIds: Set<string>, k: number): number {
  const topK = ranked.slice(0, k);
  let dcg = 0;
  topK.forEach((r, i) => {
    const relevance = relevantDocIds.has(r.document.id) ? 1 : 0;
    dcg += relevance / Math.log2(i + 2);
  });
  // Ideal DCG: all relevant docs (capped by how many distinct ones exist / k) ranked first
  const idealHits = Math.min(relevantDocIds.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

async function evaluateRetrieval(queries: GoldenQuery[], orgId: string) {
  const chunkRepo = new ChunkRepository();
  const embedder = new NvidiaEmbeddingProvider();

  const results: { query: string; recall: number; mrr: number; ndcg: number }[] = [];

  for (const q of queries) {
    const relevantDocIds = new Set(q.relevantDocumentIds);
    const queryEmbedding = await embedder.embedQuery(q.query);

    const [dense, fullText] = await Promise.all([
      chunkRepo.searchSimilar(orgId, queryEmbedding, 20, 0.0),
      chunkRepo.searchFullText(orgId, q.query, 20),
    ]);
    const ranked = reciprocalRankFusion(dense as any, fullText as any);

    results.push({
      query: q.query,
      recall: recallAtK(ranked, relevantDocIds, K),
      mrr: reciprocalRank(ranked, relevantDocIds),
      ndcg: ndcgAtK(ranked, relevantDocIds, K),
    });
  }

  return results;
}

async function evaluateCitationAccuracy(queries: GoldenQuery[]): Promise<number | null> {
  const apiUrl = process.env.EVAL_API_URL;
  const token = process.env.EVAL_API_TOKEN;
  if (!apiUrl || !token) {
    console.log('\n(Skipping citation accuracy — set EVAL_API_URL and EVAL_API_TOKEN to run it against a live API.)');
    return null;
  }

  let correct = 0;
  for (const q of queries) {
    const relevantDocIds = new Set(q.relevantDocumentIds);
    const res = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: q.query }], stream: false }),
    });
    if (!res.ok) {
      console.warn(`  [citation-accuracy] request failed for "${q.query}": ${res.status}`);
      continue;
    }
    const data = (await res.json()) as { citations?: Array<{ documentId: string }> };
    const citedDocIds = (data.citations || []).map(c => c.documentId);
    if (citedDocIds.some(id => relevantDocIds.has(id))) correct += 1;
  }
  return queries.length === 0 ? 0 : correct / queries.length;
}

async function main() {
  const orgId = process.env.EVAL_ORG_ID;
  if (!orgId) {
    console.error('Set EVAL_ORG_ID to the org whose documents the golden dataset belongs to.');
    process.exit(1);
  }

  const datasetPath = path.resolve(process.cwd(), 'scripts/golden-qa.json');
  const examplePath = path.resolve(process.cwd(), 'scripts/golden-qa.example.json');
  const useExample = !fs.existsSync(datasetPath);
  const loadedPath = useExample ? examplePath : datasetPath;
  if (useExample) {
    console.warn(`scripts/golden-qa.json not found — running against the placeholder example dataset instead.\nResults below are meaningless until you copy it and fill in real document ids.\n`);
  }

  const { queries } = JSON.parse(fs.readFileSync(loadedPath, 'utf-8')) as { queries: GoldenQuery[] };

  const retrievalResults = await evaluateRetrieval(queries, orgId);
  const n = retrievalResults.length || 1;
  const avgRecall = retrievalResults.reduce((s, r) => s + r.recall, 0) / n;
  const avgMrr = retrievalResults.reduce((s, r) => s + r.mrr, 0) / n;
  const avgNdcg = retrievalResults.reduce((s, r) => s + r.ndcg, 0) / n;

  console.log(`\n=== Retrieval metrics (n=${retrievalResults.length}, K=${K}) ===`);
  console.log(`Recall@${K}: ${avgRecall.toFixed(3)}`);
  console.log(`MRR:        ${avgMrr.toFixed(3)}`);
  console.log(`NDCG@${K}:   ${avgNdcg.toFixed(3)}`);

  console.log(`\nPer-query:`);
  for (const r of retrievalResults) {
    console.log(`  recall=${r.recall} mrr=${r.mrr.toFixed(3)} ndcg=${r.ndcg.toFixed(3)}  "${r.query}"`);
  }

  const citationAccuracy = await evaluateCitationAccuracy(queries);
  if (citationAccuracy !== null) {
    console.log(`\n=== Citation accuracy (end-to-end, n=${queries.length}) ===`);
    console.log(`Accuracy: ${citationAccuracy.toFixed(3)}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
