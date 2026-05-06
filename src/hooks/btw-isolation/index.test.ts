/// <reference path="../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BTW_HOOK_MARKER, createBtwIsolationHook } from "./index"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"

type Output = {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string }>
}

function makeCtx(): PluginInput {
  return { client: {} as never, directory: "/tmp/btw-test", $: () => ({}) } as unknown as PluginInput
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
  })

  test("delegates to runIsolatedSideQuestion when /btw invocation detected", async () => {
    //#given
    let received: { parentSessionID: string; question: string } | undefined
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async (input) => {
        received = { parentSessionID: input.parentSessionID, question: input.question }
        return { ok: true, answer: "child answer", childSessionID: "ses_child" }
      },
    })
    const output = makeOutput(BTW_PROMPT("what is 2+2?"))

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    expect(received?.parentSessionID).toBe("ses_main")
    expect(received?.question).toBe("what is 2+2?")
  })

  test("replaces the user text part with sanitized side answer when child succeeds", async () => {
    //#given
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => ({
        ok: true,
        answer: "4",
        childSessionID: "ses_child",
      }),
    })
    const output = makeOutput(BTW_PROMPT("what is 2+2?"))

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    const replaced = output.parts[0].text ?? ""
    expect(replaced).toContain("Side answer (not added to main task):")
    expect(replaced).toContain("4")
    expect(replaced).not.toContain(BTW_HOOK_MARKER)
    expect(replaced).not.toContain("what is 2+2?")
  })

  test("replaces the user text part with a sanitized failure note when child fails", async () => {
    //#given
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => ({
        ok: false,
        error: "session timeout",
      }),
    })
    const output = makeOutput(BTW_PROMPT("doomed question"))

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    const replaced = output.parts[0].text ?? ""
    expect(replaced).toContain("Side question failed")
    expect(replaced).toContain("session timeout")
    expect(replaced).not.toContain(BTW_HOOK_MARKER)
    expect(replaced).not.toContain("doomed question")
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
  })

  test("preserves multi-line side question content when relayed back", async () => {
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
  })

  test("preserves opaque part metadata fields (id, sessionID, messageID) when rewriting", async () => {
    //#given - the part already carries OpenCode-internal metadata that must survive rewrite
    const hook = createBtwIsolationHook(makeCtx(), {
      runIsolatedSideQuestion: async () => ({ ok: true, answer: "ok", childSessionID: "ses_child" }),
    })
    const richPart: Record<string, unknown> = {
      type: "text",
      text: BTW_PROMPT("does metadata survive?"),
      id: "prt_123",
      sessionID: "ses_main",
      messageID: "msg_abc",
    }
    const output: Output = { message: {}, parts: [richPart as never] }

    //#when
    await hook["chat.message"]({ sessionID: "ses_main" }, output)

    //#then
    const after = output.parts[0] as Record<string, unknown>
    expect(after.id).toBe("prt_123")
    expect(after.sessionID).toBe("ses_main")
    expect(after.messageID).toBe("msg_abc")
    expect(after.type).toBe("text")
    expect(after.text).toContain("Side answer (not added to main task):")
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
})
