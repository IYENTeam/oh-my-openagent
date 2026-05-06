/// <reference path="../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BTW_HOOK_MARKER, createBtwIsolationHook } from "./index"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"

type Output = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; id?: string; sessionID?: string; messageID?: string }>
  noReply?: boolean
}

function makeCtx(): PluginInput {
  return { client: {}, directory: "/tmp/btw-test" } as unknown as PluginInput
}

function makeOutput(text: string): Output {
  return { message: {}, parts: [{ type: "text", text }] }
}

const BTW_PROMPT = (q: string): string =>
  `${BTW_HOOK_MARKER}\n<command-instruction>btw template body</command-instruction>\n<side-question>${q}</side-question>`

beforeEach(() => {
  _resetForTesting()
})

afterEach(() => {
  _resetForTesting()
})

describe("createBtwIsolationHook (chat.message)", () => {
  test("does nothing when invocation marker is absent", async () => {
    //#given
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => {
        throw new Error("must not be called")
      },
    })
    const output = makeOutput("Plain user message, no btw")

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(output.parts[0].text).toBe("Plain user message, no btw")
    expect(output.noReply).toBeUndefined()
  })

  test("rewrites the parent message with the side answer and sets noReply on success", async () => {
    //#given
    let received: { parentSessionID: string; question: string } | undefined
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async (input) => {
        received = { parentSessionID: input.parentSessionID, question: input.question }
        return { ok: true, answer: "4", childSessionID: "ses_child" }
      },
    })
    const output = makeOutput(BTW_PROMPT("what is 2+2?"))

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(received?.parentSessionID).toBe("ses_main")
    expect(received?.question).toBe("what is 2+2?")
    expect(output.parts[0].text).toBe(
      "Side question (not added to main task):\nwhat is 2+2?\n\nSide answer:\n4",
    )
    expect(output.noReply).toBe(true)
  })

  test("rewrites the parent message with a failure note and still sets noReply on child failure", async () => {
    //#given
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => ({ ok: false, error: "session timeout" }),
    })
    const output = makeOutput(BTW_PROMPT("doomed question"))

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(output.parts[0].text).toBe(
      "Side question (not added to main task):\ndoomed question\n\nSide question failed (no main-task changes were made):\nsession timeout",
    )
    expect(output.noReply).toBe(true)
  })

  test("skips processing when current session is a subagent (re-entrance guard)", async () => {
    //#given
    subagentSessions.add("ses_child_active")
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => {
        throw new Error("must not run inside subagent session")
      },
    })
    const output = makeOutput(BTW_PROMPT("recursive?"))
    const original = output.parts[0].text

    //#when
    await hook["chat.message"]({ sessionID: "ses_child_active" }, output)

    //#then
    expect(output.parts[0].text).toBe(original)
    expect(output.noReply).toBeUndefined()
  })

  test("preserves multi-line side question content when relayed to the child", async () => {
    //#given
    let received: string | undefined
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async (input) => {
        received = input.question
        return { ok: true, answer: "ok", childSessionID: "ses_child" }
      },
    })
    const inner = "first line\nsecond line"
    const output = makeOutput(`${BTW_HOOK_MARKER}<side-question>\n${inner}\n</side-question>`)

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(received).toBe(inner)
    expect(output.noReply).toBe(true)
  })

  test("inherits the parent message model into the child session prompt", async () => {
    //#given
    let receivedModel: { providerID: string; modelID: string } | undefined
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async (input) => {
        receivedModel = input.model
        return { ok: true, answer: "ok", childSessionID: "ses_child" }
      },
    })
    const output = makeOutput(BTW_PROMPT("inherits?"))

    //#when
    await hook["chat.message"](
      {
        sessionID: "ses_main",
        model: { providerID: "closedrouter", modelID: "claude-opus-4-7" },
      },
      output,
    )

    //#then
    expect(receivedModel).toEqual({ providerID: "closedrouter", modelID: "claude-opus-4-7" })
  })

  test("preserves opaque part metadata when rewriting the primary part", async () => {
    //#given
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => ({ ok: true, answer: "ok", childSessionID: "ses_child" }),
    })
    const output: Output = {
      message: {},
      parts: [
        {
          type: "text",
          text: BTW_PROMPT("metadata?"),
          id: "prt_abc",
          sessionID: "ses_main",
          messageID: "msg_xyz",
        },
      ],
    }

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(output.parts[0].id).toBe("prt_abc")
    expect(output.parts[0].sessionID).toBe("ses_main")
    expect(output.parts[0].messageID).toBe("msg_xyz")
    expect(output.parts[0].text).toBe(
      "Side question (not added to main task):\nmetadata?\n\nSide answer:\nok",
    )
    expect(output.noReply).toBe(true)
  })

  test("sanitizes split slash command expansions across multiple parts", async () => {
    //#given - OpenCode auto-slash-command may emit BTW_HOOK_MARKER + template body in one part and the question in another
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => ({ ok: true, answer: "42", childSessionID: "ses_child" }),
    })
    const output: Output = {
      message: {},
      parts: [
        {
          type: "text",
          text: `${BTW_HOOK_MARKER}\n<command-instruction>full template body</command-instruction>`,
        },
        { type: "text", text: "<side-question>real Q</side-question>" },
      ],
    }

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(output.parts[0].text).toBe(
      "Side question (not added to main task):\nreal Q\n\nSide answer:\n42",
    )
    expect(output.parts[1].text).toBe("")
    expect(output.noReply).toBe(true)
  })
})
