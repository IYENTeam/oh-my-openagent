import type { PluginInput } from "@opencode-ai/plugin"
import { detectBtwInvocation } from "./detect"
import {
  runIsolatedSideQuestion,
  type RunIsolatedSideQuestionInput,
  type RunIsolatedSideQuestionResult,
} from "./child-session"
import { subagentSessions } from "../../features/claude-code-session-state"
import { getSessionModel } from "../../shared/session-model-state"
import { log } from "../../shared"

export { BTW_HOOK_MARKER } from "./detect"

const SIDE_QUESTION_HEADER = "Side question (not added to main task):"
const SIDE_ANSWER_HEADER = "Side answer:"
const SIDE_FAILURE_HEADER = "Side question failed (no main-task changes were made):"

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
  noReply?: boolean
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
      // #given: a child session triggered by this very hook
      // #when: the hook fires for that child session
      // #then: bail out so the side-question itself does not recurse
      if (subagentSessions.has(input.sessionID)) {
        return
      }

      const detection = detectBtwInvocation(output.parts)
      if (!detection.matched) {
        return
      }

      const inheritedModel = input.model ?? getSessionModel(input.sessionID)

      log("[btw-isolation] /btw invocation detected, running in isolated child session", {
        sessionID: input.sessionID,
        questionLength: detection.question.length,
        primaryPartIndex: detection.primaryPartIndex,
        relatedPartCount: detection.relatedPartIndexes.length,
        totalParts: output.parts.length,
        inheritedModel: inheritedModel
          ? `${inheritedModel.providerID}/${inheritedModel.modelID}`
          : "<none>",
      })

      const result = await deps.runIsolatedSideQuestion({
        client: ctx.client,
        parentSessionID: input.sessionID,
        question: detection.question,
        defaultDirectory: ctx.directory,
        ...(inheritedModel ? { model: inheritedModel } : {}),
      })

      const replacement = result.ok
        ? `${SIDE_QUESTION_HEADER}\n${detection.question}\n\n${SIDE_ANSWER_HEADER}\n${result.answer}`
        : `${SIDE_QUESTION_HEADER}\n${detection.question}\n\n${SIDE_FAILURE_HEADER}\n${result.error}`

      sanitizePart(output.parts[detection.primaryPartIndex], replacement)
      for (const idx of detection.relatedPartIndexes) {
        sanitizePart(output.parts[idx], "")
      }

      // #given: an OpenCode build that honors `chat.message` output.noReply
      // #when: this hook completes after rewriting the parent message
      // #then: the assistant turn is skipped on the parent so no extra reply is generated
      output.noReply = true

      log("[btw-isolation] parent message rewritten with side answer; requested noReply", {
        sessionID: input.sessionID,
        ok: result.ok,
      })
    },
  }
}

function sanitizePart(part: ChatMessagePart | undefined, text: string): void {
  if (!part) return
  part.type = "text"
  part.text = text
}
