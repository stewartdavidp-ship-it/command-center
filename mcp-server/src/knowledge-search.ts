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

/**
 * Accept an array parameter given EITHER as a real array or as a JSON-encoded string.
 *
 * Three params (gaps, sources, crossRefs) were typed as JSON strings while six others in
 * the same tool were typed as real arrays. Callers cannot keep two conventions straight in
 * one call: one session mis-serialised a string-typed param seven times in a single
 * session — the seventh while writing the correction to its own note about that footgun.
 * Knowing about the trap did not prevent falling into it, which is what makes this a schema
 * defect rather than a documentation one.
 *
 * Returns { ok, value, error }. Accepting both shapes removes the whole class; it does not
 * guess at malformed input, which would trade a loud failure for a silent wrong write.
 */
export function coerceArrayParam(
  raw: unknown,
  fieldName: string
): { ok: true; value: any[] | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (Array.isArray(raw)) return { ok: true, value: raw };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: true, value: [] };
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { ok: false, error: `${fieldName} parsed as ${typeof parsed}, not an array. Pass a real array (preferred) or a JSON array string.` };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: `${fieldName} is a string but not valid JSON. Pass a real array instead — that is now accepted and avoids escaping entirely.` };
    }
  }
  return { ok: false, error: `${fieldName} must be an array (preferred) or a JSON array string; got ${typeof raw}.` };
}

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
 * Per-object tokenization cache.
 *
 * Every scorer entry point re-tokenized the same records. buildIdf tokenizes all N entries,
 * then scoreEntry tokenizes each one again — and check_gaps scores every gap against every
 * entry, so 93 gaps over 318 nodes meant ~30,000 scoreEntry calls each re-splitting the
 * same strings. Measured: check_gaps at 2.7s.
 *
 * Keyed on the record object itself and held weakly, so it lives exactly as long as the
 * Firebase snapshot objects for one request and cannot leak between requests or users.
 */
const TOKEN_CACHE = new WeakMap<object, { q: Set<string>; f: Set<string>; tag: Set<string>; tagsLower: string[] }>();

function entryTokens(entry: ScorableEntry) {
  if (typeof entry !== "object" || entry === null) {
    return { q: new Set<string>(), f: new Set<string>(), tag: new Set<string>(), tagsLower: [] as string[] };
  }
  let hit = TOKEN_CACHE.get(entry as object);
  if (!hit) {
    const tagsLower = (entry.tags || []).map((t) => String(t).toLowerCase());
    hit = {
      q: new Set(tokenize(entry.question || "")),
      f: new Set(tokenize(entry.keyFinding || "")),
      tag: new Set(tagsLower.flatMap((t) => tokenize(t))),
      tagsLower,
    };
    TOKEN_CACHE.set(entry as object, hit);
  }
  return hit;
}

const TREE_CACHE = new WeakMap<object, Set<string>>();

function treeTokens(tree: ScorableTree) {
  if (typeof tree !== "object" || tree === null) return new Set<string>();
  let hit = TREE_CACHE.get(tree as object);
  if (!hit) {
    hit = new Set([...tokenize(tree.name || ""), ...tokenize(tree.description || "")]);
    TREE_CACHE.set(tree as object, hit);
  }
  return hit;
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
  /**
   * Query terms that scored via this node's TAGS (at question weight).
   *
   * Reported because its absence was actively misleading: `matchingTags` and `matchCount`
   * only reflect EXACT tag matches, which are always empty on a query-only search. A
   * session read that as "tags contributed nothing" and concluded its tags were "close to
   * decorative" — when on its own best result four query terms had scored through tags.
   */
  termsFromTags: string[];
}

/**
 * Ranking penalty applied to a match from a tree past its own freshness window.
 *
 * Staleness was surfaced as a flag but not priced into the score, so stale nodes competed
 * on equal footing via generic terms. Observed 2026-08-28: a query about a mobile base64
 * bug returned the correct node at 0.637 and an unrelated 179-day-stale node at 0.527 —
 * a 0.11 margin — plus three more stale hits above the floor.
 *
 * Deliberately mild. A stale finding is still often the right one; it should lose ties, not
 * disappear. At 0.8 the case above cleanly separates without burying anything.
 */
export const STALE_RANK_PENALTY = 0.8;

/**
 * Rank penalty scaled by HOW FAR past its window a finding is, not merely whether it is.
 *
 * The boolean version landed unevenly across trees for reasons unrelated to how stale a
 * finding actually is: staleness is measured against each tree's own freshnessPeriodDays,
 * and the ops tree runs 30 days while research trees run 90+. A 31-day-old platform
 * measurement — one day overdue — took the same 0.8 hit as a 400-day-old market analysis.
 *
 * Now: no penalty until overdue, then a gentle slope, floored so a stale finding is demoted
 * rather than erased. It is often still the right answer.
 *
 *   31d / 30d window  (1.03x) -> 0.995   barely overdue, barely touched
 *   60d / 30d window  (2.0x)  -> 0.85
 *   179d / 60d window (2.98x) -> 0.70
 *   180d / 30d window (6.0x)  -> 0.65    floored
 */
const STALE_SLOPE = 0.15;
const STALE_MIN_FACTOR = 0.65;

export function staleRankFactor(
  staleDays: number | null | undefined,
  freshnessPeriodDays: number | null | undefined
): number {
  if (staleDays === null || staleDays === undefined) return 1;
  const window = freshnessPeriodDays && freshnessPeriodDays > 0 ? freshnessPeriodDays : 90;
  const ratio = staleDays / window;
  if (ratio <= 1) return 1;
  return Math.max(STALE_MIN_FACTOR, 1 - STALE_SLOPE * (ratio - 1));
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
    // Shares the per-request token cache with scoreEntry — previously this pass and the
    // scoring pass each tokenized all N entries independently.
    const c = entryTokens(entry);
    const terms = new Set([...c.q, ...c.f, ...c.tag]);
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
  const cached = entryTokens(entry);
  const entryTags = cached.tagsLower;

  // ── Exact tag matches (unchanged semantics from the original implementation) ──
  const matchingTags = searchTagsLower.filter((st) => entryTags.includes(st));
  let score = matchingTags.length * WEIGHT_TAG_EXACT;

  // ── Free-text scoring ──
  const matchedTerms: string[] = [];
  const termsFromTags: string[] = [];

  if (queryTokens.length > 0) {
    const questionTokens = cached.q;
    const findingTokens = cached.f;
    // Tags participate in text scoring too, so a query term reaches a node whose tag says
    // it even when the caller passed no exact tags.
    const tagTokens = cached.tag;
    const treeTokensSet = treeTokens(tree);

    // Dedupe query terms so a repeated word cannot inflate the score.
    for (const term of new Set(queryTokens)) {
      let termScore = 0;
      if (questionTokens.has(term)) termScore += WEIGHT_QUESTION;
      if (findingTokens.has(term)) termScore += WEIGHT_KEY_FINDING;
      if (tagTokens.has(term)) { termScore += WEIGHT_QUESTION; termsFromTags.push(term); }
      if (treeTokensSet.has(term)) termScore += WEIGHT_TREE_CONTEXT;

      if (termScore > 0) {
        // Rare terms carry the signal; ubiquitous ones ("work", "use") are damped toward
        // nothing. Absent an IDF map, fall back to unweighted scoring.
        score += termScore * (idf?.get(term) ?? 1);
        matchedTerms.push(term);
      }
    }
  }

  if (score === 0) return { score: 0, matchingTags: [], matchedTerms: [], termsFromTags: [] };

  // Normalize by the number of distinct signals the caller supplied.
  const signalCount = new Set(queryTokens).size + searchTagsLower.length;
  const normalized = signalCount > 0 ? score / signalCount : 0;

  return {
    score: Math.round(normalized * 1000) / 1000,
    matchingTags,
    matchedTerms,
    termsFromTags,
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
