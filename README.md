# DrawAI

DrawAI is a minimal shared canvas for humans and agents. A person can draw with the native editor while an agent reads the scene, composes meaning, and extends the live tool registry.

The canvas has no seeded business example or hardcoded domain vocabulary. The agent owns the semantics; the browser owns the safe rendering boundary:

- The editor is the official @excalidraw/excalidraw React component, so selection, freehand drawing, shapes, arrows, text, zoom, undo/redo, export, menus, and keyboard shortcuts are real editor capabilities.
- The base WebMCP surface has four strict tools: `get_canvas_snapshot`, `draw_shape`, `compose_canvas`, and `create_drawing_tool`.
- `compose_canvas` accepts agent-provided nodes and relationships. The client validates the graph, computes a generic layout, and renders editable Excalidraw elements; it does not decide what the nodes mean.
- Layout computation uses a WebGPU compute shader when the browser exposes an adapter and falls back to a deterministic CPU implementation otherwise.
- Tool Studio turns an agent instruction into a reusable graph-capable tool. Custom tools are immediately added to the live registry and are available to both the agent and the human.
- A local scene and tool registry are autosaved in the browser for fast iteration.

## Run locally

~~~bash
npm install
npm run dev
~~~

Then open the local Vite URL. Production checks:

~~~bash
npm run typecheck
npm run build
~~~

## WebMCP implementation

DrawAI detects the current browser capability in this order:

1. document.modelContext.registerTool
2. navigator.modelContext.registerTool as a compatibility fallback
3. Offline preview mode when neither API is available

Every registered tool includes a strict JSON Schema and an AbortSignal. The registration surface is rebuilt when a custom tool is created, updated, or deleted. Tool execution uses the same ExcalidrawImperativeAPI.updateScene path as the human editor, which keeps agent and human changes in one scene.

`compose_canvas` is deliberately generic. An external agent can turn a request such as a manufacturing workflow, a product architecture, or a personal plan into its own graph, then send that graph to DrawAI. DrawAI does not contain fixtures for any of those domains.

The current WebMCP API is a proposed web standard and may require a browser preview or an injected modelContext implementation. DrawAI remains fully usable without it.

## Agent bridge

DrawAI also includes a concrete connection layer for agents that can communicate with the page. It is useful while WebMCP support is still arriving in browsers and remains available alongside the native `modelContext` registry.

- Public page API: `window.__drawaiAgent`
- Broadcast transport: `drawai-agent-v1`
- Same-origin browser transport: `window.postMessage`
- Message flow: `drawai:hello`, `drawai:list_tools`, `drawai:invoke`, and correlated `drawai:response` messages

An agent can discover the live registry and draw into the same scene:

~~~js
const channel = new BroadcastChannel("drawai-agent-v1");
const requestId = crypto.randomUUID();

channel.onmessage = ({ data }) => {
  if (data.requestId === requestId) console.log(data);
};

channel.postMessage({
  type: "drawai:invoke",
  requestId,
  agentId: "factory-planner",
  tool: "compose_canvas",
  input: {
    title: "Agent-provided canvas",
    nodes: [
      { id: "a", label: "First idea" },
      { id: "b", label: "Next idea", description: "The agent supplies this context." }
    ],
    edges: [{ source: "a", target: "b", label: "leads to" }],
    replace: true
  }
});
~~~

For an in-page integration, the same capability is exposed directly:

~~~js
const agent = window.__drawaiAgent;
await agent.connect("my-agent");
await agent.invoke("compose_canvas", {
  title: "Agent-provided canvas",
  nodes: [{ id: "a", label: "First idea" }, { id: "b", label: "Next idea" }],
  edges: [{ source: "a", target: "b" }]
});
~~~

The bridge rejects unknown tools, limits browser messaging to the same origin, and always executes through the same shared-canvas path used by WebMCP.

## Custom tools

Custom tools are metadata plus an agent instruction. Their input contract is the same graph shape as `compose_canvas`, so the agent can extend DrawAI with domain-specific capabilities without adding a hardcoded action catalog to the client. The instruction is exposed in the live WebMCP schema to help the agent choose the right tool.

## Hackathon

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

## License

MIT. See [LICENSE](LICENSE).
