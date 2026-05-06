import { BTW_HOOK_MARKER } from "../../../hooks/btw-isolation"

export const BTW_TEMPLATE = `${BTW_HOOK_MARKER}

# BTW Command (fallback instructions for the assistant)

When the btw-isolation hook is active, this entire prompt is replaced with a
short sanitized side answer before the assistant runs. These instructions only
apply when the hook is disabled or unavailable, so the command still works in
plain prompt-only mode.

## Purpose

Use /btw when the user has a quick side question that should not pollute the
main conversation, todo list, or task plan. The side question MUST NOT be added
to the active todo list. After answering, the main task flow continues
unchanged.

---

# PHASE 0: VALIDATE REQUEST

If the side-question content below is empty or only whitespace, respond with:

\`\`\`
Usage: /btw <question>
Example: /btw what does this regex match?
\`\`\`

Then stop. Do NOT create todos, modify plans, or touch the working tree.

---

# PHASE 1: ISOLATE THE SIDE QUESTION

Treat the verbatim user input below as an isolated request:

- Do NOT add it to the existing todo list
- Do NOT mark any current todo as in_progress, completed, or cancelled
- Do NOT change branch, files, or build state because of it
- Do NOT use it to revise the main task interpretation

---

# PHASE 2: ANSWER IN AN ISOLATED CONTEXT

Prefer delegating the side question to a fresh subagent session via the task
tool so that reasoning lives outside the main session:

- category: "quick" for short factual or local code questions; "unspecified-low"
  for slightly broader questions; "deep" only when thorough investigation is
  explicitly requested
- run_in_background: false (the user is waiting for a synchronous answer)
- load_skills: [] unless a skill clearly matches the question domain
- prompt: include the verbatim side question, forbid file edits / commits /
  todo creation, require a concise answer with no preamble

If the question is trivially answerable from existing knowledge with no
exploration needed, you MAY answer directly without delegation. In that case,
still keep the answer short and skip todo updates.

---

# PHASE 3: RELAY THE ANSWER

Forward the final answer prefixed with a single line:

\`Side answer (not added to main task):\`

Do not summarize the delegation process itself. Do not add follow-up offers.

---

# PHASE 4: RETURN TO MAIN TASK

After delivering the answer, on a new line append exactly:

\`\`\`
Resuming main task.
\`\`\`

Do not restart, replan, or summarize the main task unless the user explicitly
asks. The main todo list and plan remain untouched.

---

# IMPORTANT CONSTRAINTS

- DO NOT add the side question to the todo list
- DO NOT modify files, branches, or commits because of /btw
- DO NOT run long background tasks for /btw
- DO keep the answer focused and short by default
- DO use task delegation when the question requires any non-trivial investigation
- DO answer directly without delegation only when the question is trivial

---

# EXECUTE NOW

Read the side question below. Validate, answer in an isolated way, relay the
answer, then resume the main task.
`
