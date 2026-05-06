export const BTW_HOOK_MARKER = "<!-- omo:btw-isolation v1 -->"

const SIDE_QUESTION_OPEN = "<side-question>"
const SIDE_QUESTION_CLOSE = "</side-question>"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }

export interface BtwDetection {
  matched: true
  textPartIndex: number
  question: string
}

export type BtwDetectionResult = BtwDetection | { matched: false }

export function detectBtwInvocation(parts: ChatMessagePart[]): BtwDetectionResult {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part?.type !== "text") continue
    const text = typeof part.text === "string" ? part.text : ""
    if (!text.includes(BTW_HOOK_MARKER)) continue

    const question = extractSideQuestion(text)
    if (question === null) continue

    return { matched: true, textPartIndex: i, question }
  }
  return { matched: false }
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
