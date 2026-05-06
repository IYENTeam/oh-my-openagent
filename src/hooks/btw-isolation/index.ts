import type { PluginInput } from "@opencode-ai/plugin"
import { detectBtwInvocation } from "./detect"
import { runIsolatedSideQuestion, type RunIsolatedSideQuestionInput, type RunIsolatedSideQuestionResult } from "./child-session"
import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared"

export { BTW_HOOK_MARKER } from "./detect"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }

type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
  variant?: string
}

type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: ChatMessagePart[]
}

export interface BtwIsolationDeps {
  runIsolatedSideQuestion: (
    input: RunIsolatedSideQuestionInput,
  ) => Promise<RunIsolatedSideQuestionResult>
}

const defaultDeps: BtwIsolationDeps = {
  runIsolatedSideQuestion,
}

export function createBtwIsolationHook(
  ctx: PluginInput,
  deps: BtwIsolationDeps = defaultDeps,
) {
  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput,
    ): Promise<void> => {
      if (subagentSessions.has(input.sessionID)) {
        return
      }

      const detection = detectBtwInvocation(output.parts)
      if (!detection.matched) {
        return
      }

      log("[btw-isolation] /btw invocation detected, running in isolated child session", {
        sessionID: input.sessionID,
        questionLength: detection.question.length,
      })

      const result = await deps.runIsolatedSideQuestion({
        client: ctx.client,
        parentSessionID: input.sessionID,
        question: detection.question,
        defaultDirectory: ctx.directory,
      })

      const replacement = formatParentReplacement(result)
      replaceParentText(output, detection.textPartIndex, replacement)
    },
  }
}

function formatParentReplacement(result: RunIsolatedSideQuestionResult): string {
  if (result.ok) {
    return [
      "Side answer (not added to main task):",
      result.answer,
      "",
      "Resuming main task.",
    ].join("\n")
  }
  return [
    "Side question failed (no main-task changes were made).",
    `Reason: ${result.error}`,
    "",
    "Resuming main task.",
  ].join("\n")
}

function replaceParentText(
  output: ChatMessageOutput,
  textPartIndex: number,
  replacement: string,
): void {
  output.parts[textPartIndex] = { type: "text", text: replacement }
}
