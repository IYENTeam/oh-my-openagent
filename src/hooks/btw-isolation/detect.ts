export const BTW_HOOK_MARKER = "<!-- omo:btw-isolation v1 -->"

const SIDE_QUESTION_OPEN = "<side-question>"
const SIDE_QUESTION_CLOSE = "</side-question>"
const COMMAND_INSTRUCTION_OPEN = "<command-instruction>"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }

export interface BtwDetection {
  matched: true
  primaryPartIndex: number
  question: string
  relatedPartIndexes: number[]
}

export type BtwDetectionResult = BtwDetection | { matched: false }

export function detectBtwInvocation(parts: ChatMessagePart[]): BtwDetectionResult {
  let primaryPartIndex = -1
  let question: string | null = null
  const relatedPartIndexes: number[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part?.type !== "text") continue
    const text = typeof part.text === "string" ? part.text : ""

    const hasMarker = text.includes(BTW_HOOK_MARKER)
    const hasCommandInstruction = text.includes(COMMAND_INSTRUCTION_OPEN)
    const hasSideQuestion = text.includes(SIDE_QUESTION_OPEN)

    if (!hasMarker && !hasCommandInstruction && !hasSideQuestion) continue

    if (hasSideQuestion && question === null) {
      const extracted = extractSideQuestion(text)
      if (extracted !== null) {
        question = extracted
      }
    }

    if (primaryPartIndex === -1 && hasMarker) {
      primaryPartIndex = i
    } else {
      relatedPartIndexes.push(i)
    }
  }

  if (primaryPartIndex === -1 && question !== null) {
    primaryPartIndex = relatedPartIndexes.shift() ?? -1
  }

  if (primaryPartIndex === -1 || question === null) {
    return { matched: false }
  }

  return { matched: true, primaryPartIndex, question, relatedPartIndexes }
}

export function extractSideQuestion(text: string): string | null {
  const openIdx = text.indexOf(SIDE_QUESTION_OPEN)
  if (openIdx === -1) return null
  const contentStart = openIdx + SIDE_QUESTION_OPEN.length
  const closeIdx = text.indexOf(SIDE_QUESTION_CLOSE, contentStart)
  if (closeIdx === -1) return null
  const raw = text.slice(contentStart, closeIdx).trim()
  return raw.length > 0 ? raw : null
}
