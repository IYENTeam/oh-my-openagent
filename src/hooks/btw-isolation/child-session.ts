import type { OpencodeClient } from "../../tools/delegate-task/types"
import { createSyncSession } from "../../tools/delegate-task/sync-session-creator"
import { fetchSyncResult } from "../../tools/delegate-task/sync-result-fetcher"
import { isSessionComplete } from "../../tools/delegate-task/sync-session-poller"
import { subagentSessions } from "../../features/claude-code-session-state"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { log } from "../../shared"

const POLL_INTERVAL_MS = 500
const DEFAULT_TIMEOUT_MS = 120_000
const SIDE_QUESTION_AGENT = "general"

const SIDE_QUESTION_SYSTEM_PROMPT = [
  "You are answering an isolated side question on behalf of the user's main session.",
  "The main session will receive ONLY your final assistant message; intermediate reasoning and tool output stay in this child session.",
  "Constraints:",
  "- Do not modify files, do not commit, do not edit any working state.",
  "- Read-only investigation is acceptable when the question genuinely requires it.",
  "- Answer concisely. Prefer 1-3 sentences first, then up to 5 short bullet points only if useful.",
  "- No preamble, no apologies, no follow-up offers, no flattery.",
].join("\n")

export interface RunIsolatedSideQuestionInput {
  client: OpencodeClient
  parentSessionID: string
  question: string
  defaultDirectory: string
  timeoutMs?: number
}

export type RunIsolatedSideQuestionResult =
  | { ok: true; answer: string; childSessionID: string }
  | { ok: false; error: string; childSessionID?: string }

export async function runIsolatedSideQuestion(
  input: RunIsolatedSideQuestionInput,
): Promise<RunIsolatedSideQuestionResult> {
  const createResult = await createSyncSession(input.client, {
    parentSessionID: input.parentSessionID,
    agentToUse: SIDE_QUESTION_AGENT,
    description: "btw side question",
    defaultDirectory: input.defaultDirectory,
  })

  if (!createResult.ok) {
    return { ok: false, error: createResult.error }
  }

  const childSessionID = createResult.sessionID
  subagentSessions.add(childSessionID)

  try {
    const promptResult = await input.client.session.prompt({
      path: { id: childSessionID },
      body: {
        agent: SIDE_QUESTION_AGENT,
        system: SIDE_QUESTION_SYSTEM_PROMPT,
        parts: [createInternalAgentTextPart(input.question)],
      },
    } as Parameters<typeof input.client.session.prompt>[0])

    const promptError = (promptResult as { error?: unknown }).error
    if (promptError) {
      return {
        ok: false,
        error: `child session prompt failed: ${String(promptError)}`,
        childSessionID,
      }
    }

    const completed = await waitForChildCompletion(
      input.client,
      childSessionID,
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    if (!completed.ok) {
      return { ok: false, error: completed.error, childSessionID }
    }

    const fetched = await fetchSyncResult(input.client, childSessionID)
    if (!fetched.ok) {
      return { ok: false, error: fetched.error, childSessionID }
    }

    const answer = fetched.textContent.trim()
    if (answer.length === 0) {
      return { ok: false, error: "child session returned empty answer", childSessionID }
    }

    return { ok: true, answer, childSessionID }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      childSessionID,
    }
  } finally {
    subagentSessions.delete(childSessionID)
    void deleteChildSession(input.client, childSessionID)
  }
}

async function waitForChildCompletion(
  client: OpencodeClient,
  sessionID: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_INTERVAL_MS)
    let messagesResult: unknown
    try {
      messagesResult = await client.session.messages({ path: { id: sessionID } })
    } catch (error) {
      log("[btw-isolation] poll error, retrying", { sessionID, error: String(error) })
      continue
    }
    const data = (messagesResult as { data?: unknown })?.data ?? messagesResult
    const messages = Array.isArray(data) ? data : []
    if (isSessionComplete(messages as never)) {
      return { ok: true }
    }
  }
  abortChildSession(client, sessionID)
  return { ok: false, error: `side question timed out after ${timeoutMs}ms` }
}

function abortChildSession(client: OpencodeClient, sessionID: string): void {
  void client.session
    .abort({ path: { id: sessionID } })
    .catch((error: unknown) => {
      log("[btw-isolation] abort failed", { sessionID, error: String(error) })
    })
}

async function deleteChildSession(client: OpencodeClient, sessionID: string): Promise<void> {
  const sessionApi = client.session as { delete?: (args: { path: { id: string } }) => Promise<unknown> }
  if (typeof sessionApi.delete !== "function") {
    return
  }
  try {
    await sessionApi.delete({ path: { id: sessionID } })
  } catch (error) {
    log("[btw-isolation] delete child session failed", { sessionID, error: String(error) })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
