// ═══════════════════════════════════════════════════════════════
// Response Metadata — Auto-inject _responseSize and _contextHealth
// into tool responses
// ═══════════════════════════════════════════════════════════════
// Wraps MCP tool responses to include:
//   _responseSize: character count of the response
//   _contextHealth: zone indicator based on session context usage
//
// Usage: call `withResponseSize(result)` before returning from any
// tool handler.
// ═══════════════════════════════════════════════════════════════

import { getServerSentTotal, getInteractionTotal, setServerSentTotal, setInteractionTotal, getTurnDelta, getCurrentUid, getSessionMeta, getPendingMessages, getSuppressPiggyback, getInitiator, isInitiatorExplicit, getSignals, getToolName, getContextCeiling } from "./context.js";
import { incrementServerSentTotal, resetSurfaceContext } from "./tools/sessions.js";

// Tools exempt from turnDelta compliance warning (first-call or setup tools)
const TURNDELTA_EXEMPT_TOOLS = new Set(["session"]);

interface TextContent {
  type: "text";
  text: string;
  [key: string]: unknown;
}

interface ToolResult {
  content: TextContent[];
  isError?: boolean;
  [key: string]: unknown;
}

// Default context ceiling in CHARS (used when surface registry lookup fails).
// Calibrated for 200k-token context window: 200,000 × ~3.12 chars/token ≈ 624,000.
// Larger surfaces (e.g., claude-code on Opus 4.7 1M) override this via the surface
// registry's contextWindow.ceiling (stored in TOKENS) → loaded per-request in index.ts.
const DEFAULT_CONTEXT_CEILING = 624_000;

// Zone boundaries as proportions of the ceiling — recomputed per-request from the
// active ceiling so thresholds scale correctly for 200k, 1M, or any future window.
const ZONE_GREEN_PROPORTION = 0.60;
const ZONE_YELLOW_PROPORTION = 0.75;
const ZONE_RED_PROPORTION = 0.90;
// > 90% = imminent

function computeContextZone(used: number, ceiling: number): string {
  if (used < ceiling * ZONE_GREEN_PROPORTION) return "green";
  if (used < ceiling * ZONE_YELLOW_PROPORTION) return "yellow";
  if (used < ceiling * ZONE_RED_PROPORTION) return "red";
  return "imminent";
}

/**
 * Measure the total character count of all text content blocks in a tool result.
 */
function measureContentChars(content: TextContent[]): number {
  let total = 0;
  for (const block of content) {
    if (block.text) {
      total += block.text.length;
    }
  }
  return total;
}

/**
 * Inject _responseSize and _contextHealth metadata into a tool result's content array.
 * Also injects any additional metadata fields (e.g., _estimatedFullSize, _fileSize).
 *
 * _contextHealth is included when session context tracking is available
 * (serverSentTotal + interactionTotal loaded once per request in index.ts).
 *
 * @param result - The tool result object with a `content` array
 * @param extraMeta - Optional additional metadata fields to include
 * @returns The same result object with metadata appended
 */
/**
 * How many pending-message subjects ride along in metadata. The count carries the
 * signal; the bodies do not. Full list was ~745 tokens on every single call.
 */
const PENDING_MESSAGE_PREVIEW = 2;

export function withResponseSize(
  result: ToolResult,
  extraMeta?: Record<string, number | string | boolean>
): ToolResult {
  const chars = measureContentChars(result.content);

  // Auto-increment serverSentTotal with actual tool content chars.
  // This runs at the tool-result level (not HTTP level), so it counts only
  // what enters the LLM context — not MCP protocol overhead like tools/list,
  // initialize responses, JSON-RPC framing, or SSE framing.
  try {
    const uid = getCurrentUid();
    const surface = getInitiator();
    if (uid && chars > 0) {
      incrementServerSentTotal(uid, chars, surface || undefined).catch(() => {});
    }
  } catch {
    // No UID in context (shouldn't happen in normal flow)
  }

  const meta: Record<string, any> = { _responseSize: chars };
  if (extraMeta) {
    Object.assign(meta, extraMeta);
  }

  // Include _contextHealth if we have context tracking for this request.
  // compactionEstimate = serverSentTotal + interactionTotal
  let serverSentTotal = getServerSentTotal();
  let interactionTotal = getInteractionTotal();
  if (serverSentTotal !== undefined || interactionTotal !== undefined) {
    // Use per-surface ceiling from the registry (loaded in index.ts per request).
    // Falls back to DEFAULT for surfaces without an entry.
    const registryCeiling = getContextCeiling();
    const ceiling = registryCeiling ?? DEFAULT_CONTEXT_CEILING;
    const ceilingSource = registryCeiling !== undefined ? "surface-registry" : "default";

    let sst = (serverSentTotal || 0) + chars; // Include this response's chars
    let it = interactionTotal || 0;
    let compactionEstimate = sst + it;

    // ── Overflow auto-reset ──
    // serverSentTotal is a monotonically increasing accumulator — it counts TOTAL
    // bytes sent across all tool calls, but context doesn't hold all of them.
    // When the estimate exceeds ceiling, it's drifted past reality. Reset to just
    // the current response size (the only thing we know is actually in context).
    // This prevents the "climbing into millions" problem reported in sessions where
    // Chat makes many tool calls.
    if (compactionEstimate > ceiling) {
      sst = chars; // Only this response is guaranteed to be in context
      it = 0;
      compactionEstimate = sst;

      // Update in-memory cache so subsequent calls in this request see the reset
      setServerSentTotal(sst);
      setInteractionTotal(0);

      // Reset in Firebase (fire-and-forget)
      try {
        const uid = getCurrentUid();
        const surface = getInitiator();
        const sm = getSessionMeta();
        if (sm?.id && surface) {
          resetSurfaceContext(uid, sm.id, surface).catch(() => {});
        }
      } catch {
        // Best-effort — don't block the response
      }
    }

    const healthObj: Record<string, any> = {
      compactionEstimate,
      serverSentTotal: sst,
      interactionTotal: it,
      ceiling,
      ceilingSource,
      zone: computeContextZone(compactionEstimate, ceiling),
    };

    meta._contextHealth = healthObj;
  }

  // Include _session metadata if resolved for this request
  const sessionMeta = getSessionMeta();
  if (sessionMeta) {
    const sessionInfo: Record<string, any> = { id: sessionMeta.id };
    if (sessionMeta.autoCreated) sessionInfo.autoCreated = true;
    if (sessionMeta.mismatch) sessionInfo.mismatch = true;
    if (sessionMeta.staleClosed) sessionInfo.staleClosed = sessionMeta.staleClosed;
    if (sessionMeta.existingSession) sessionInfo.existingSession = sessionMeta.existingSession;
    meta._session = sessionInfo;
  }

  // Include _initiator if resolved for this request
  const initiator = getInitiator();
  if (initiator) {
    meta._initiator = initiator;
  }

  // Include _pendingMessages if there are pending messages for any surface.
  // Suppressed for document(receive) to avoid redundant info.
  //
  // ONLY A PREVIEW. This used to embed the full message list on every response: measured
  // 2026-08-28 at 2,980 of 3,037 metadata chars — 98% of per-call overhead, ~745 tokens,
  // identical on every call, while _signals below already carries "pending-messages". On a
  // small response (get_index, stats) that was ~45% of the entire payload, and a session's
  // own _contextHealth was observed reaching zone "red" partly from re-sending it.
  //
  // The count is the signal; the bodies are not. A caller that needs them reads them
  // deliberately.
  if (!getSuppressPiggyback()) {
    const pendingMessages = getPendingMessages();
    if (pendingMessages && pendingMessages.count > 0) {
      const all = (pendingMessages as any).messages || [];
      meta._pendingMessages = {
        ...pendingMessages,
        messages: all.slice(0, PENDING_MESSAGE_PREVIEW),
        ...(all.length > PENDING_MESSAGE_PREVIEW
          ? { truncated: all.length - PENDING_MESSAGE_PREVIEW, note: "Preview only — read messages deliberately rather than from this block." }
          : {}),
      };
    }
  }

  // Include _signals if any signal codes are active for this request.
  // Computed once per request in index.ts and cached in AsyncLocalStorage.
  const signals = getSignals();
  if (signals && signals.length > 0) {
    meta._signals = signals;
  }

  // ── turnDelta compliance warning ──
  // If Chat-family surfaces send 0 or missing turnDelta, prepend a warning
  // so it's the first thing the LLM reads in the response.
  // Exempt: session tool (bootstrap/init are first calls, no count yet).
  // Only fires when initiator was EXPLICITLY provided (not inferred from createdBy),
  // to avoid false positives on tools like job(start) with createdBy="claude-chat".
  const tdWarningSurface = getInitiator();
  const tdWarningValue = getTurnDelta();
  const tdWarningTool = getToolName();
  if (
    isInitiatorExplicit() &&
    tdWarningSurface &&
    (tdWarningSurface === "claude-chat" || tdWarningSurface === "claude-cowork") &&
    (tdWarningValue === undefined || tdWarningValue === 0) &&
    tdWarningTool &&
    !TURNDELTA_EXEMPT_TOOLS.has(tdWarningTool)
  ) {
    result.content.unshift({
      type: "text" as const,
      text: "⚠️ CONTEXT TRACKING WARNING: You sent turnDelta=0 (or omitted it). Your bootstrap instructions require you to estimate characters consumed by the user's question + your response and pass that as turnDelta (or contextEstimate) on every MCP tool call. Without this, compaction prediction is blind. Count characters and include the estimate on your next call.",
    });
  }

  result.content.push({
    type: "text" as const,
    text: JSON.stringify(meta),
  });

  return result;
}
