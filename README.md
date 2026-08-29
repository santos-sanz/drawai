# DrawAI

DrawAI is an Excalidraw-quality collaborative canvas for humans and agents. A person can draw with the native editor while an agent reads the shared scene, adds editable elements, and creates new drawing tools with the person.

The product starts small on purpose and grows with the user's vocabulary:

- The editor is the official @excalidraw/excalidraw React component, so selection, freehand drawing, shapes, arrows, text, zoom, undo/redo, export, menus, and keyboard shortcuts are real editor capabilities.
- The base WebMCP surface has four strict tools: get_canvas_snapshot, draw_shape, draw_process_flow, and create_drawing_tool.
- Tool Studio turns a short description into a reusable canvas tool. Custom tools are immediately added to the live registry and are available to both the agent and the human.
- `draw_process_flow` turns an ordered list of stages into a readable, serpentine flowchart with editable nodes and connectors. It is ready for the example: “Haz un diagrama de flujo del proceso de fabricación de un envase metalico para pintura”.
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
  tool: "draw_process_flow",
  input: {
    title: "Metal paint container",
    stages: [
      { name: "Cut sheet" },
      { name: "Form body" },
      { name: "Join seam" },
      { name: "Coat and cure" },
      { name: "Fill and pack" }
    ],
    replace: true
  }
});
~~~

For an in-page integration, the same capability is exposed directly:

~~~js
const agent = window.__drawaiAgent;
await agent.connect("my-agent");
await agent.invoke("draw_process_flow", {
  title: "Metal paint container",
  stages: [{ name: "Cut sheet" }, { name: "Form body" }, { name: "Coat and cure" }]
});
~~~

The bridge rejects unknown tools, limits browser messaging to the same origin, and always executes through the same shared-canvas path used by WebMCP.

## Custom drawing actions

Tool Studio currently composes safe, editable actions:

- Sticky note
- User journey
- Highlight area
- Label element

This is intentionally a foundation rather than a closed command list: adding an action expands the same tool registry without replacing the editor.

## Hackathon

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

## License

MIT. See [LICENSE](LICENSE).
