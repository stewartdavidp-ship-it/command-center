/**
 * Lexical relevance scoring for knowledge-node retrieval.
 *
 * Why this exists: search_tags used to match exact tags only, which coupled retrieval to
 * whatever tag vocabulary a past session happened to choose. A session asking the same
 * question in different words found nothing — silently, since a miss produces no error.
 *
 * The index entries already carry `question` and `keyFinding`. This module scores against
 * that text so a natural-language query finds the node that answers it.
 *
 * Deliberately lexical, not embedding-based: the corpus is ~230 nodes, and term overlap
 * over a set that size beats the cost of an embedding key, a re-embed backfill, and vector
 * storage. `scoreEntry` is the single scoring boundary — an embedding pass can be added as
 * a second ranking stage behind it without touching the tool surface.
 */

/** Words carrying no retrieval signal. Small on purpose — over-pruning loses real terms. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these",
  "those", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on",
  "at", "by", "for", "with", "about", "into", "over", "from", "up", "down", "out",
  "do", "does", "did", "doing", "how", "what", "when", "where", "which", "who", "whom",
  "why", "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "i", "we", "you", "it", "its", "our", "their", "them", "they", "he", "she", "his",
  "her", "as", "so", "not", "no", "any", "all", "some", "more", "most", "much", "many",
  "us", "me", "my", "your", "have", "has", "had", "get", "got",
]);

/**
 * Light suffix stripping so morphological variants collide.
 * Not a real stemmer (no Porter) — that would be overkill and produces surprising
 * collisions on short technical terms. This handles the common case: onboarding→onboard,
 * imported→import, channels→channel.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Split free text into scoreable terms: lowercase, break on non-alphanumeric, drop
 * stopwords and 1-character fragments, then stem.
 *
 * Hyphenated tags ("channel-integration") split into their parts, which is what we want —
 * a query for "integration" should reach a node tagged "channel-integration".
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Field weights. An exact tag hit still dominates, which preserves the ranking intent of
 * the original tag-only search: callers passing tags and no query get the same ordering
 * they got before.
 */
const WEIGHT_TAG_EXACT = 3.0;
const WEIGHT_QUESTION = 2.0;
const WEIGHT_KEY_FINDING = 1.0;
const WEIGHT_TREE_CONTEXT = 0.5;

/**
 * Minimum normalized score to be considered a match. Tuned so a single incidental term
 * overlap ("data", "api") does not surface an unrelated node, while a genuine two-term
 * question match clears comfortably.
 */
export const SCORE_FLOOR = 0.35;

/**
 * Score at or above which a match counts as a real answer rather than an incidental
 * word overlap.
 *
 * This exists for the instrumentation, not the ranking. Weak matches are still returned —
 * false positives are cheap here and false negatives are the documented failure mode. But
 * if a search returns only weak rows, the corpus did NOT answer the question, and that has
 * to be logged as a miss. Otherwise one stray term overlap masks a genuine gap and the
 * miss log silently under-reports.
 *
 * Calibrated against the real 309-node corpus after IDF weighting compressed scores. A
 * known-good query tops out around 0.86; a topically adjacent but wrong match — a query
 * about agentic *attacks* against a node on agentic *coding* — lands at 0.62 and is
 * correctly recorded as a miss.
 *
 * LIMITATION: that separation is comfortable but not guaranteed. Lexical scoring has no
 * notion of topic, so a rare shared term between unrelated subjects can score like a real
 * hit. The miss log reliably catches ABSENCE; it can under-report WRONGNESS. When reviewing
 * it, a question whose top match was merely on-topic will not appear.
 */
export const STRONG_MATCH_SCORE = 0.7;

export interface ScorableEntry {
  question?: string;
  keyFinding?: string;
  tags?: string[];
}

export interface ScorableTree {
  name?: string;
  description?: string;
}

export interface ScoreResult {
  score: number;
  matchingTags: string[];
  matchedTerms: string[];
}

/**
 * Inverse document frequency over the searched corpus.
 *
 * Without this, every common word scores like a rare one. In practice that means "work" —
 * unavoidable in both queries ("how should X work") and node questions ("How does Linear
 * work?") — drags in a dozen unrelated nodes on every search. Hand-extending the stopword
 * list is guesswork that goes stale as the corpus grows; measuring term rarity against the
 * actual corpus is self-maintaining.
 *
 * Built from the same index entries the search already has in memory — no extra reads.
 */
export type IdfMap = Map<string, number>;

export function buildIdf(entries: ScorableEntry[]): IdfMap {
  const N = Math.max(1, entries.length);
  const df = new Map<string, number>();

  for (const entry of entries) {
    // Count each term once per node: document frequency, not term frequency.
    const terms = new Set([
      ...tokenize(entry.question || ""),
      ...tokenize(entry.keyFinding || ""),
      ...(entry.tags || []).flatMap((t) => tokenize(String(t))),
    ]);
    for (const t of terms) df.set(t, (df.get(t) || 0) + 1);
  }

  // Normalize so a term appearing in exactly one node scores ~1.0 and a term appearing in
  // every node scores ~0.12 — keeping scores in the same range the thresholds were tuned
  // against, while collapsing the contribution of ubiquitous words.
  const ceiling = Math.log(1 + N);
  const idf: IdfMap = new Map();
  for (const [term, count] of df) {
    idf.set(term, Math.log(1 + N / count) / ceiling);
  }
  return idf;
}

/**
 * Score one index entry against a query.
 *
 * @param queryTokens    tokenize()'d free-text query (may be empty)
 * @param searchTagsLower lowercased exact tags to match (may be empty)
 * @param entry          the node index entry
 * @param tree           owning tree, for weak contextual signal from its name/description
 *
 * Returns score 0 when nothing matched. Callers apply SCORE_FLOOR.
 *
 * Scoring is normalized by the number of query signals so that scores are comparable
 * across queries of different lengths — otherwise a long query would out-score a short
 * precise one purely on term count, and a single fixed floor could not serve both.
 */
export function scoreEntry(
  queryTokens: string[],
  searchTagsLower: string[],
  entry: ScorableEntry,
  tree: ScorableTree = {},
  idf?: IdfMap
): ScoreResult {
  const entryTags: string[] = (entry.tags || []).map((t) => String(t).toLowerCase());

  // ── Exact tag matches (unchanged semantics from the original implementation) ──
  const matchingTags = searchTagsLower.filter((st) => entryTags.includes(st));
  let score = matchingTags.length * WEIGHT_TAG_EXACT;

  // ── Free-text scoring ──
  const matchedTerms: string[] = [];

  if (queryTokens.length > 0) {
    const questionTokens = new Set(tokenize(entry.question || ""));
    const findingTokens = new Set(tokenize(entry.keyFinding || ""));
    // Tags participate in text scoring too, so a query term reaches a node whose tag says
    // it even when the caller passed no exact tags.
    const tagTokens = new Set(entryTags.flatMap((t) => tokenize(t)));
    const treeTokens = new Set([
      ...tokenize(tree.name || ""),
      ...tokenize(tree.description || ""),
    ]);

    // Dedupe query terms so a repeated word cannot inflate the score.
    for (const term of new Set(queryTokens)) {
      let termScore = 0;
      if (questionTokens.has(term)) termScore += WEIGHT_QUESTION;
      if (findingTokens.has(term)) termScore += WEIGHT_KEY_FINDING;
      if (tagTokens.has(term)) termScore += WEIGHT_QUESTION;
      if (treeTokens.has(term)) termScore += WEIGHT_TREE_CONTEXT;

      if (termScore > 0) {
        // Rare terms carry the signal; ubiquitous ones ("work", "use") are damped toward
        // nothing. Absent an IDF map, fall back to unweighted scoring.
        score += termScore * (idf?.get(term) ?? 1);
        matchedTerms.push(term);
      }
    }
  }

  if (score === 0) return { score: 0, matchingTags: [], matchedTerms: [] };

  // Normalize by the number of distinct signals the caller supplied.
  const signalCount = new Set(queryTokens).size + searchTagsLower.length;
  const normalized = signalCount > 0 ? score / signalCount : 0;

  return {
    score: Math.round(normalized * 1000) / 1000,
    matchingTags,
    matchedTerms,
  };
}

/**
 * Score at which an open gap is treated as possibly already answered by an existing node.
 *
 * Set deliberately above STRONG_MATCH_SCORE. The asymmetry matters: a false negative here
 * just leaves a gap open for a human to read, while a false positive tells someone that
 * work is already done when it isn't. This flag therefore only ever RECOMMENDS review — it
 * never resolves a gap.
 *
 * Why this exists: a stale gap is strictly worse than a stale node. A stale node says
 * "this might be outdated"; a stale gap actively directs a session to redo finished work.
 * Observed 2026-08-28 — a fantasy-draft tree's top gap still claimed rankings were
 * provisional pending scoring confirmation four days after that confirmation landed.
 */
export const GAP_ANSWERED_SCORE = 1.2;

/** Max keyFinding characters rendered into a routing-table line. */
const SUMMARY_FINDING_CHARS = 100;

/**
 * Render one node as a single routing-table line.
 *
 * Must be exactly one line. `keyFinding` is auto-generated on create as a raw 120-char
 * slice of node content, so it frequently carries newlines and markdown — which turned a
 * 309-node table into 169KB of multi-line text. Collapse whitespace and cap length.
 */
export function summaryLine(
  treeName: string,
  entry: { question?: string; keyFinding?: string; tags?: string[] },
  opts: { findingChars?: number; maxTags?: number } = {}
): string {
  const findingChars = opts.findingChars ?? SUMMARY_FINDING_CHARS;
  const maxTags = opts.maxTags ?? 0; // 0 = no limit
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();

  const question = flat(entry.question || "(no question)");

  let tagsStr = "";
  const allTags = entry.tags || [];
  if (allTags.length > 0) {
    const shown = maxTags > 0 ? allTags.slice(0, maxTags) : allTags;
    const overflow = allTags.length - shown.length;
    tagsStr = ` [${shown.join(", ")}${overflow > 0 ? `, +${overflow}` : ""}]`;
  }

  let finding = "";
  if (entry.keyFinding && findingChars > 0) {
    const f = flat(entry.keyFinding);
    finding = ` — ${f.length > findingChars ? f.slice(0, findingChars) + "…" : f}`;
  }

  return `${flat(treeName)} > ${question}${tagsStr}${finding}`;
}

/**
 * Days since a tree was last verified, and whether that exceeds its own freshness window.
 * Surfaced per-result because nobody reads a separate health advisory mid-task.
 */
export function computeStaleness(
  lastVerified: string | null | undefined,
  freshnessPeriodDays: number | null | undefined,
  now: Date = new Date()
): { staleDays: number | null; stale: boolean } {
  if (!lastVerified) return { staleDays: null, stale: false };

  const verifiedAt = new Date(lastVerified);
  if (isNaN(verifiedAt.getTime())) return { staleDays: null, stale: false };

  // Clamp at 0 — a future-dated or same-day verification is not "-1 days stale".
  const staleDays = Math.max(0, Math.floor((now.getTime() - verifiedAt.getTime()) / 86400000));
  const window = freshnessPeriodDays ?? 90;

  return { staleDays, stale: staleDays > window };
}
