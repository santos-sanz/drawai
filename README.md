# Escalero

> Start with the smallest useful tool surface. Let the workflow teach it what to become next.

Escalero is a WebMCP-native workspace for humans and agents. It starts with three semantic tools, exposes the shared state visibly, and lets a person or an agent design, update, and remove custom tools without rebuilding the app.

## Why this is a WebMCP use case

Most agent integrations start by guessing a large API surface. Escalero takes the opposite path: the current workspace is the context, and the current need determines the next tool. A human can open Tool Studio, define one clear input and one safe action, and immediately see that capability enter the live registry. An agent receives the same capability through document.modelContext.registerTool().

The result is a shared loop:

1. The human and agent read the same workspace.
2. The agent uses a small, strict tool surface to move the work forward.
3. The human designs the next capability when a repeated intent appears.
4. WebMCP registration is synchronized again, with stale registrations aborted.

## Live tools

The base surface is intentionally small:

- get_workspace_snapshot — read tasks, focus, notes, and active capabilities.
- apply_task_change — add, complete, or rename a task.
- design_tool — create, update, or delete a custom tool backed by a safe workspace action.

Custom tools use a strict one-field JSON Schema and can safely perform one of four local actions: add a task, complete the first open task, capture a note, or set the shared focus.

## Run locally

~~~bash
npm install
npm run dev
~~~

Open the local URL in Chrome with chrome://flags/#enable-webmcp-testing enabled, or use a browser with WebMCP support. Without the API, Escalero stays usable in preview mode and shows the exact runtime surface in the inspector.

Useful checks:

~~~bash
npm run typecheck
npm run build
~~~

## WebMCP implementation

The runtime prefers the current imperative API at document.modelContext.registerTool, with a compatibility fallback to navigator.modelContext. Each registry change creates an AbortController; aborting the previous controller removes stale dynamic tools before the new surface is registered. Tool callbacks read the latest React state through a ref, so the browser agent and human UI operate on the same state.

The implementation lives in:

- src/runtime.ts — feature detection, lifecycle, and stable tool names.
- src/App.tsx — semantic tool definitions, shared workspace state, and Tool Studio.
- src/styles.css — the human-facing workspace and developer inspector.

## Hackathon

Built for [The WebMCP Challenge](https://webmcp.devpost.com/). Official references:

- [WebMCP developer documentation](https://developer.chrome.com/docs/ai/webmcp)
- [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)

## License

MIT. See [LICENSE](./LICENSE).
