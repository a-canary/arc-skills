# Prototype rules (both branches)

1. **Throwaway from day one, clearly marked.** Locate prototype code next to the module/page it prototypes for, but name it so a casual reader sees it's not production. For throwaway UI routes, obey the project's existing routing convention; don't invent new top-level structure.
2. **One command to run.** Whatever the project's task runner supports (`pnpm <name>`, `python <path>`, `bun <path>`). The user starts it without thinking.
3. **No persistence by default.** State lives in memory — persistence is the thing being _checked_, not depended on. If the question explicitly involves a DB, hit a scratch DB / local file named "PROTOTYPE — wipe me".
4. **Skip the polish.** No tests, no error handling beyond runnable, no abstractions. Learn fast, then delete.
5. **Surface the state.** After every action (logic) or variant switch (UI), print/render the full relevant state so the change is visible.
6. **Delete or absorb when done.** Once the question is answered, delete the prototype or fold the validated decision into real code — don't let it rot in the repo.

## When done

The _answer_ is the only thing worth keeping. Capture it somewhere durable (commit message, ADR, issue, or a `NOTES.md` next to the prototype) along with the question it answered. If the user is around, that's a quick conversation; if not, leave the placeholder so the verdict can be filled in before deleting.
