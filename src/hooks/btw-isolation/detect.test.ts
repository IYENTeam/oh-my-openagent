/// <reference path="../../../bun-test.d.ts" />

import { describe, test, expect } from "bun:test"
import { BTW_HOOK_MARKER, detectBtwInvocation, extractSideQuestion } from "./detect"

describe("detectBtwInvocation", () => {
  test("returns matched=true when BTW marker and side-question present", () => {
    //#given
    const parts = [
      {
        type: "text",
        text: `${BTW_HOOK_MARKER}\n<command-instruction>...</command-instruction>\n<side-question>\nwhat is 2+2?\n</side-question>`,
      },
    ]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.textPartIndex).toBe(0)
      expect(result.question).toBe("what is 2+2?")
    }
  })

  test("returns matched=false when marker missing", () => {
    //#given
    const parts = [{ type: "text", text: "<side-question>q</side-question>" }]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(false)
  })

  test("returns matched=false when side-question tag missing", () => {
    //#given
    const parts = [{ type: "text", text: `${BTW_HOOK_MARKER} but no question tag` }]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(false)
  })

  test("returns matched=false on empty side-question", () => {
    //#given
    const parts = [{ type: "text", text: `${BTW_HOOK_MARKER}\n<side-question>   </side-question>` }]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(false)
  })

  test("ignores non-text parts", () => {
    //#given
    const parts = [
      { type: "image", text: `${BTW_HOOK_MARKER}<side-question>q</side-question>` },
      { type: "text", text: "no marker here" },
    ]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(false)
  })

  test("returns the index of the matching text part", () => {
    //#given
    const parts = [
      { type: "text", text: "first part" },
      { type: "text", text: `${BTW_HOOK_MARKER}\n<side-question>real Q</side-question>` },
    ]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.textPartIndex).toBe(1)
      expect(result.question).toBe("real Q")
    }
  })

  test("preserves multi-line side question content verbatim (trimmed of outer whitespace)", () => {
    //#given
    const inner = "line one\nline two\n  indented line three"
    const parts = [
      { type: "text", text: `${BTW_HOOK_MARKER}<side-question>\n${inner}\n</side-question>` },
    ]

    //#when
    const result = detectBtwInvocation(parts)

    //#then
    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.question).toBe(inner)
    }
  })
})

describe("extractSideQuestion", () => {
  test("extracts content between tags", () => {
    //#given
    const text = "prefix <side-question>my Q</side-question> suffix"

    //#when
    const result = extractSideQuestion(text)

    //#then
    expect(result).toBe("my Q")
  })

  test("returns null when no opening tag", () => {
    //#given / #when / #then
    expect(extractSideQuestion("no tags here")).toBeNull()
  })

  test("returns null when no closing tag", () => {
    //#given / #when / #then
    expect(extractSideQuestion("<side-question>unterminated")).toBeNull()
  })

  test("returns null when content is empty or whitespace only", () => {
    //#given / #when / #then
    expect(extractSideQuestion("<side-question></side-question>")).toBeNull()
    expect(extractSideQuestion("<side-question>   \n\t  </side-question>")).toBeNull()
  })
})
