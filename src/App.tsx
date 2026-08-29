import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawImperativeAPI, AppState } from "@excalidraw/excalidraw/types";
import type {
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import {
  Cable,
  Code2,
  GitBranch,
  Radio,
  Sparkles,
  X,
} from "lucide-react";
import "@excalidraw/excalidraw/index.css";
import {
  makeToolName,
  registerToolSurface,
  type JsonSchema,
  type RuntimeMode,
  type WebMCPToolDefinition,
} from "./runtime";
import { DRAWAI_AGENT_PROTOCOL, DrawAIAgentBridge } from "./agentBridge";
import { computeGraphLayout, type GraphEdgeInput, type LayoutMode } from "./clientCompute";
import type { AgentEvent, DrawingTool } from "./types";

const SCENE_KEY = "drawai-scene-v2";
const TOOLS_KEY = "drawai-tools-v2";

const BASE_TOOL_META: Array<
  Pick<WebMCPToolDefinition, "name" | "title" | "description" | "inputSchema" | "annotations">
> = [
  {
    name: "compose_canvas",
    title: "Compose a canvas",
    description:
      "Render an agent-planned graph on the shared canvas. The agent supplies the meaning, nodes, and relationships; DrawAI validates and lays them out locally.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional canvas title." },
        nodes: {
          type: "array",
          minItems: 1,
          maxItems: 128,
          description: "Semantic nodes selected and ordered by the agent.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable node id." },
              label: { type: "string", description: "Human-readable node label." },
              description: { type: "string", description: "Optional supporting detail." },
              kind: { type: "string", description: "Optional semantic category." },
            },
            required: ["id", "label"],
            additionalProperties: false,
          },
        },
        edges: {
          type: "array",
          maxItems: 256,
          description: "Semantic relationships selected by the agent.",
          items: {
            type: "object",
            properties: {
              source: { type: "string", description: "Source node id." },
              target: { type: "string", description: "Target node id." },
              label: { type: "string", description: "Optional relationship label." },
            },
            required: ["source", "target"],
            additionalProperties: false,
          },
        },
        layout: { type: "string", enum: ["auto", "flow", "tree", "grid"], description: "Local layout strategy." },
        x: { type: "number", description: "Canvas x coordinate." },
        y: { type: "number", description: "Canvas y coordinate." },
        replace: { type: "boolean", description: "Replace the current scene when true; defaults to appending." },
      },
      required: ["nodes"],
      additionalProperties: false,
    },
    annotations: { untrustedContentHint: true },
  },
  {
    name: "get_canvas_snapshot",
    title: "Inspect canvas",
    description:
      "Read the current shared drawing as a compact snapshot with element counts, text, and selected elements.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "draw_shape",
    title: "Draw a shape",
    description:
      "Add a typed shape to the shared canvas. Use this for rectangles, ellipses, diamonds, arrows, lines, text, or sticky notes.",
    inputSchema: {
      type: "object",
      properties: {
        shape: {
          type: "string",
          enum: ["rectangle", "ellipse", "diamond", "arrow", "line", "text", "sticky"],
          description: "The Excalidraw shape to add.",
        },
        text: { type: "string", description: "Optional label or text content." },
        x: { type: "number", description: "Canvas x coordinate." },
        y: { type: "number", description: "Canvas y coordinate." },
        width: { type: "number", description: "Shape width." },
        height: { type: "number", description: "Shape height." },
        color: { type: "string", description: "Optional stroke color in hex format." },
      },
      required: ["shape"],
      additionalProperties: false,
    },
    annotations: { untrustedContentHint: true },
  },
  {
    name: "create_drawing_tool",
    title: "Create a drawing tool",
    description:
      "Create, update, or delete a reusable drawing tool. New tools become available to both the agent and the human.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "update", "delete"] },
        id: { type: "string", description: "Existing tool id for update or delete." },
        name: { type: "string", description: "Tool name, normalized to snake_case." },
        title: { type: "string", description: "Human-readable tool title." },
        description: { type: "string", description: "What the tool does." },
        instruction: { type: "string", description: "Instruction that tells an agent how to use this specialized capability." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { untrustedContentHint: true },
  },
];

type ToolFormState = {
  name: string;
  title: string;
  description: string;
  instruction: string;
};

const EMPTY_TOOL_FORM: ToolFormState = {
  name: "",
  title: "",
  description: "",
  instruction: "Ask the agent to supply a graph for this capability.",
};

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return prefix + "-" + crypto.randomUUID();
  }
  return prefix + "-" + Math.random().toString(36).slice(2);
}

function clockTime(): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

function loadScene(): OrderedExcalidrawElement[] {
  try {
    const stored = localStorage.getItem(SCENE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as { elements?: OrderedExcalidrawElement[] };
    return Array.isArray(parsed.elements) ? parsed.elements : [];
  } catch {
    return [];
  }
}

function loadDrawingTools(): DrawingTool[] {
  try {
    const stored = localStorage.getItem(TOOLS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as DrawingTool[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numeric(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getInputText(input: Record<string, unknown>, fallback: string): string {
  return stringValue(input.text ?? input.input ?? input.label ?? input.title, fallback);
}

function shapeSkeletons(input: Record<string, unknown>): ExcalidrawElementSkeleton[] {
  const shape = stringValue(input.shape, "rectangle");
  const x = numeric(input.x, 330);
  const y = numeric(input.y, 230);
  const width = Math.max(80, numeric(input.width, 220));
  const height = Math.max(56, numeric(input.height, 120));
  const color = stringValue(input.color, "#4c3a80");
  const text = getInputText(input, "");

  if (shape === "text") {
    return [
      {
        type: "text",
        x,
        y,
        text,
        width: Math.max(260, width),
        height: 34,
        fontSize: 22,
        strokeColor: color,
      },
    ];
  }

  if (shape === "arrow" || shape === "line") {
    return [
      {
        type: shape,
        x,
        y,
        points: [
          [0, 0],
          [Math.max(120, width), 0],
        ],
        strokeColor: color,
        strokeWidth: 2,
        ...(shape === "arrow" ? { endArrowhead: "arrow" } : {}),
      } as ExcalidrawElementSkeleton,
    ];
  }

  if (shape === "sticky") {
    if (!text) return [];
    return [
      {
        type: "rectangle",
        x,
        y,
        width,
        height,
        strokeColor: "#a36a16",
        backgroundColor: "#fff3bf",
        fillStyle: "solid",
        roundness: { type: 3 },
      },
      {
        type: "text",
        x: x + 20,
        y: y + 22,
        text,
        width: width - 40,
        height: 32,
        fontSize: 20,
        strokeColor: "#5e481e",
      },
    ] as ExcalidrawElementSkeleton[];
  }

  return [
    {
      type: shape as "rectangle" | "ellipse" | "diamond",
      x,
      y,
      width,
      height,
      strokeColor: color,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      roundness: { type: 3 },
      ...(text ? { label: { text, fontSize: 20 } } : {}),
    } as ExcalidrawElementSkeleton,
  ];
}

type CanvasComposition = {
  skeletons: ExcalidrawElementSkeleton[];
  engine: "webgpu" | "cpu";
  nodeCount: number;
  edgeCount: number;
};

async function composeCanvasSkeletons(input: Record<string, unknown>): Promise<CanvasComposition> {
  const layoutMode = stringValue(input.layout, "auto") as LayoutMode;
  const layout = await computeGraphLayout({
    nodes: input.nodes,
    edges: input.edges,
    mode: ["auto", "flow", "tree", "grid"].includes(layoutMode) ? layoutMode : "auto",
    x: numeric(input.x, 72),
    y: numeric(input.y, 112),
  });
  const palette = [
    ["#5b3f8f", "#eee7ff"],
    ["#167d72", "#dff5ed"],
    ["#b86a22", "#fff0d3"],
    ["#35689a", "#e5effb"],
  ];
  const elements: ExcalidrawElementSkeleton[] = [];
  const title = stringValue(input.title);
  if (title) {
    const minX = Math.min(...layout.nodes.map((node) => node.x));
    const maxX = Math.max(...layout.nodes.map((node) => node.x + node.width));
    elements.push({
      type: "rectangle",
      x: minX,
      y: Math.max(24, Math.min(...layout.nodes.map((node) => node.y)) - 76),
      width: maxX - minX,
      height: 56,
      strokeColor: "#30294d",
      backgroundColor: "#e9e1ff",
      fillStyle: "solid",
      roundness: { type: 3 },
      label: { text: title.slice(0, 180), fontSize: 21 },
    } as ExcalidrawElementSkeleton);
  }

  layout.nodes.forEach((node, index) => {
    const [strokeColor, backgroundColor] = palette[index % palette.length];
    const text = node.description ? node.label + "\n" + node.description : node.label;
    elements.push({
      type: "rectangle",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      strokeColor,
      backgroundColor,
      fillStyle: "solid",
      roundness: { type: 3 },
      label: { text, fontSize: node.description ? 14 : 17 },
    } as ExcalidrawElementSkeleton);
  });

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  layout.edges.forEach((edge: GraphEdgeInput) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return;
    let startX = source.x + source.width / 2;
    let startY = source.y + source.height;
    let endX = target.x + target.width / 2;
    let endY = target.y;
    if (target.x > source.x + source.width / 2) {
      startX = source.x + source.width;
      startY = source.y + source.height / 2;
      endX = target.x;
      endY = target.y + target.height / 2;
    } else if (target.y < source.y) {
      startX = source.x;
      startY = source.y + source.height / 2;
      endX = target.x + target.width;
      endY = target.y + target.height / 2;
    }
    elements.push({
      type: "arrow",
      x: startX,
      y: startY,
      points: [
        [0, 0],
        [endX - startX, endY - startY],
      ],
      strokeColor: "#554a72",
      strokeWidth: 2,
      endArrowhead: "arrow",
    } as ExcalidrawElementSkeleton);
    if (edge.label) {
      elements.push({
        type: "text",
        x: (startX + endX) / 2 - 30,
        y: (startY + endY) / 2 - 16,
        text: edge.label,
        width: 120,
        height: 24,
        fontSize: 13,
        strokeColor: "#554a72",
      } as ExcalidrawElementSkeleton);
    }
  });
  return { skeletons: elements, engine: layout.engine, nodeCount: layout.nodes.length, edgeCount: layout.edges.length };
}

function toolInputSchema(tool: DrawingTool): JsonSchema {
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional canvas title." },
      nodes: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        description: tool.instruction,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            description: { type: "string" },
            kind: { type: "string" },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
      edges: {
        type: "array",
        maxItems: 256,
        items: {
          type: "object",
          properties: {
            source: { type: "string" },
            target: { type: "string" },
            label: { type: "string" },
          },
          required: ["source", "target"],
          additionalProperties: false,
        },
      },
      layout: { type: "string", enum: ["auto", "flow", "tree", "grid"] },
      x: { type: "number" },
      y: { type: "number" },
      replace: { type: "boolean" },
    },
    required: ["nodes"],
    additionalProperties: false,
  };
}

function App() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bridgeRef = useRef<DrawAIAgentBridge | null>(null);
  const initialElementsRef = useRef<OrderedExcalidrawElement[]>(loadScene());
  const sceneElementsRef = useRef<readonly OrderedExcalidrawElement[]>(initialElementsRef.current);
  const selectedIdsRef = useRef<string[]>([]);
  const [sceneElements, setSceneElements] = useState<readonly OrderedExcalidrawElement[]>(
    initialElementsRef.current,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drawingTools, setDrawingTools] = useState<DrawingTool[]>(loadDrawingTools);
  const drawingToolsRef = useRef(drawingTools);
  const [panelOpen, setPanelOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [toolForm, setToolForm] = useState<ToolFormState>(EMPTY_TOOL_FORM);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("offline");
  const [layoutEngine, setLayoutEngine] = useState<"webgpu" | "cpu" | "idle">("idle");
  const [agentCount, setAgentCount] = useState(0);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([
    {
      id: makeId("event"),
      actor: "system",
      label: "Canvas ready",
      detail: "Human and agent actions share the same Excalidraw scene.",
      time: clockTime(),
    },
  ]);

  useEffect(() => {
    drawingToolsRef.current = drawingTools;
    localStorage.setItem(TOOLS_KEY, JSON.stringify(drawingTools));
  }, [drawingTools]);

  const addEvent = useCallback((actor: AgentEvent["actor"], label: string, detail: string) => {
    setEvents((current) => [
      {
        id: makeId("event"),
        actor,
        label,
        detail,
        time: clockTime(),
      },
      ...current,
    ].slice(0, 8));
  }, []);

  const handleChange = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
    sceneElementsRef.current = elements;
    selectedIdsRef.current = Object.keys(appState.selectedElementIds || {});
    setSceneElements(elements);
    setSelectedIds(selectedIdsRef.current);
    localStorage.setItem(SCENE_KEY, JSON.stringify({ elements }));
  }, []);

  const addToScene = useCallback(
    (skeletons: ExcalidrawElementSkeleton[], actor: AgentEvent["actor"], label: string, detail: string, replace = false) => {
      const api = apiRef.current;
      if (!api || skeletons.length === 0) {
        addEvent("system", "Canvas is still loading", "Try again when the editor is visible.");
        return { ok: false, added: 0 };
      }
      const created = convertToExcalidrawElements(skeletons, { regenerateIds: true });
      const nextElements = [...(replace ? [] : api.getSceneElements()), ...created];
      api.updateScene({ elements: nextElements });
      sceneElementsRef.current = nextElements;
      setSceneElements(nextElements);
      addEvent(actor, label, detail);
      return { ok: true, added: created.length };
    },
    [addEvent],
  );

  const saveTool = useCallback(
    (input: Record<string, unknown>) => {
      const operation = stringValue(input.operation, "create");
      const existingId = stringValue(input.id);
      if (operation === "delete") {
        const exists = drawingToolsRef.current.some((tool) => tool.id === existingId);
        setDrawingTools((current) => current.filter((tool) => tool.id !== existingId));
        addEvent("agent", "Drawing tool removed", existingId ? "The shared registry was updated." : "No tool id was provided.");
        return { ok: exists, operation, id: existingId };
      }

      const name = makeToolName(stringValue(input.name, stringValue(input.title, "new drawing tool")));
      const title = stringValue(input.title, name.replace(/_/g, " "));
      const nextTool: DrawingTool = {
        id: existingId || makeId("tool"),
        name,
        title,
        description: stringValue(input.description, "A reusable tool for the shared canvas."),
        instruction: stringValue(input.instruction, "Ask the agent to supply a graph for this capability."),
        createdAt: new Date().toISOString(),
      };
      setDrawingTools((current) => {
        const index = current.findIndex((tool) => tool.id === nextTool.id || tool.name === nextTool.name);
        if (index === -1) return [...current, nextTool];
        const copy = [...current];
        copy[index] = { ...copy[index], ...nextTool };
        return copy;
      });
      addEvent(
        "agent",
        operation === "update" ? "Drawing tool updated" : "New drawing tool created",
        nextTool.title + " is now available to both sides.",
      );
      return { ok: true, operation, tool: nextTool };
    },
    [addEvent],
  );

  const runCustomTool = useCallback(
    async (tool: DrawingTool, input: Record<string, unknown>) => {
      try {
        const composition = await composeCanvasSkeletons(input);
        setLayoutEngine(composition.engine);
        const result = addToScene(
          composition.skeletons,
          "agent",
          "Agent ran " + tool.title,
          composition.nodeCount + " nodes · " + composition.edgeCount + " relationships · " + composition.engine + " layout.",
          input.replace === true,
        );
        return { ok: result.ok, tool: tool.name, added: result.added, layoutEngine: composition.engine };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "The custom composition could not be created.";
        addEvent("system", "Custom composition rejected", detail);
        return { ok: false, tool: tool.name, error: detail };
      }
    },
    [addEvent, addToScene],
  );

  const executeRegisteredTool = useCallback(
    async (rawInput: Record<string, unknown>) => {
      const input = { ...rawInput };
      const toolName = stringValue(input.__toolName);
      delete input.__toolName;

      if (toolName === "get_canvas_snapshot") {
        const textElements = sceneElementsRef.current.filter((element) => element.type === "text");
        return {
          ok: true,
          elementCount: sceneElementsRef.current.length,
          textCount: textElements.length,
          selectedElementCount: selectedIdsRef.current.length,
          text: textElements
            .map((element) => ("text" in element ? element.text : ""))
            .filter(Boolean)
            .slice(-24),
          customTools: drawingToolsRef.current.map((tool) => tool.name),
        };
      }

      if (toolName === "draw_shape") {
        const shape = stringValue(input.shape, "rectangle");
        if ((shape === "text" || shape === "sticky") && !getInputText(input, "")) {
          return { ok: false, shape, error: "Text and sticky shapes require text from the agent." };
        }
        const result = addToScene(
          shapeSkeletons(input),
          "agent",
          "Agent drew a " + shape,
          "The new element is part of the same editable canvas.",
        );
        return { ok: result.ok, shape, added: result.added };
      }

      if (toolName === "compose_canvas") {
        try {
          const composition = await composeCanvasSkeletons(input);
          setLayoutEngine(composition.engine);
          const result = addToScene(
            composition.skeletons,
            "agent",
            "Agent composed the canvas",
            composition.nodeCount + " nodes · " + composition.edgeCount + " relationships · " + composition.engine + " layout.",
            input.replace === true,
          );
          return {
            ok: result.ok,
            added: result.added,
            nodeCount: composition.nodeCount,
            edgeCount: composition.edgeCount,
            layoutEngine: composition.engine,
          };
        } catch (error) {
          const detail = error instanceof Error ? error.message : "The graph could not be composed.";
          addEvent("system", "Composition rejected", detail);
          return { ok: false, error: detail };
        }
      }

      if (toolName === "create_drawing_tool") {
        return saveTool(input);
      }

      const customTool = drawingToolsRef.current.find((tool) => tool.name === toolName);
      if (customTool) return runCustomTool(customTool, input);

      return { ok: false, error: "Unknown DrawAI tool: " + toolName };
    },
    [addToScene, saveTool, runCustomTool],
  );

  const webmcpTools = useMemo<WebMCPToolDefinition[]>(
    () => [
      ...BASE_TOOL_META.map((tool) => ({
        ...tool,
        execute: async () => ({ ok: true }),
      })),
      ...drawingTools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toolInputSchema(tool),
        annotations: { untrustedContentHint: true },
        execute: async () => ({ ok: true }),
      })),
    ],
    [drawingTools],
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    registerToolSurface(webmcpTools, executeRegisteredTool, (event) => {
      setRuntimeMode(event.mode);
      addEvent("system", event.mode === "offline" ? "Preview mode" : "WebMCP registry synced", event.message);
    }).then((dispose) => {
      cleanup = dispose;
    });
    return () => cleanup?.();
  }, [addEvent, executeRegisteredTool, webmcpTools]);

  useEffect(() => {
    const bridge = new DrawAIAgentBridge();
    bridgeRef.current = bridge;
    const cleanup = bridge.start(webmcpTools, executeRegisteredTool, {
      onAgentConnected: (agentId, transport) => {
        setAgentCount(bridge.connectedAgentCount());
        addEvent("agent", "Agent connected", agentId + " · " + transport + " transport");
      },
      onAgentRequest: (tool) => addEvent("agent", "Agent invoked " + tool, "Request received through the DrawAI bridge."),
      onAgentError: (message) => addEvent("system", "Agent request failed", message),
    });
    return () => {
      cleanup();
      bridgeRef.current = null;
      setAgentCount(0);
    };
  }, [addEvent, executeRegisteredTool]);

  useEffect(() => {
    bridgeRef.current?.update(webmcpTools, executeRegisteredTool);
  }, [executeRegisteredTool, webmcpTools]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && studioOpen) setStudioOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [studioOpen]);

  useEffect(() => {
    const debugWindow = window as Window & {
      __drawaiState?: {
        sceneCount: number;
        customTools: string[];
        textElements: Array<{ text: string; width: number; height: number }>;
        runtimeMode: RuntimeMode;
        layoutEngine: "webgpu" | "cpu" | "idle";
        agentCount: number;
        agentProtocol: string;
        openStudio: () => void;
      };
    };
    debugWindow.__drawaiState = {
      sceneCount: sceneElements.length,
      customTools: drawingTools.map((tool) => tool.name),
      textElements: sceneElements
        .filter((element) => element.type === "text")
        .map((element) => ({ text: element.text, width: element.width, height: element.height })),
      runtimeMode,
      layoutEngine,
      agentCount,
      agentProtocol: DRAWAI_AGENT_PROTOCOL,
      openStudio: () => setStudioOpen(true),
    };
    return () => {
      delete debugWindow.__drawaiState;
    };
  }, [agentCount, drawingTools, layoutEngine, runtimeMode, sceneElements.length]);

  const openNewTool = useCallback(() => {
    setEditingToolId(null);
    setToolForm(EMPTY_TOOL_FORM);
    setStudioOpen(true);
  }, []);

  const submitTool = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      saveTool({
        operation: editingToolId ? "update" : "create",
        id: editingToolId || undefined,
        ...toolForm,
      });
      setStudioOpen(false);
      setEditingToolId(null);
      setToolForm(EMPTY_TOOL_FORM);
    },
    [editingToolId, saveTool, toolForm],
  );

  const runtimeLabel =
    runtimeMode === "native" ? "WebMCP connected" : runtimeMode === "fallback" ? "WebMCP fallback" : "Preview mode";
  const initialData = useMemo(
    () => ({
      elements: initialElementsRef.current,
      appState: { viewBackgroundColor: "#f6f2ea" as const },
    }),
    [],
  );
  const handleExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);
  const renderTopRightUI = useCallback(
    () => (
      <button
        className="drawai-inline-trigger"
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        aria-label={panelOpen ? "Close DrawAI copilot" : "Open DrawAI copilot"}
        title="Toggle DrawAI copilot"
      >
        <Sparkles size={14} />
        DrawAI
      </button>
    ),
    [panelOpen],
  );
  const renderCustomStats = useCallback(
    (elements: readonly NonDeletedExcalidrawElement[]) => (
      <span className="drawai-stats">
        {elements.length} elements · {drawingTools.length} custom tools
      </span>
    ),
    [drawingTools.length],
  );

  return (
    <main className={"drawai-app " + (panelOpen ? "panel-open" : "panel-closed")}>
      <div className="drawai-canvas">
        <Excalidraw
          name="drawai"
          theme="light"
          initialData={initialData}
          excalidrawAPI={handleExcalidrawApi}
          onChange={handleChange}
          renderTopRightUI={renderTopRightUI}
          renderCustomStats={renderCustomStats}
        />
      </div>

      <div className="drawai-brand-dock" aria-label="DrawAI identity">
        <div className="brand-glyph"><GitBranch size={18} strokeWidth={2.4} /></div>
        <div className="brand-lockup">
          <strong>DRAWAI</strong>
          <span>AGENT CANVAS · 01</span>
        </div>
        <span className="brand-live"><span /> LIVE</span>
      </div>

      <nav className="drawai-rail" aria-label="DrawAI shortcuts">
        <button type="button" onClick={() => setBridgeOpen(true)} aria-label="Open agent bridge" title="Agent bridge">
          <Cable size={17} />
        </button>
        <span className="rail-divider" />
        <span className="rail-index">01</span>
      </nav>

      {!panelOpen && (
        <button className="drawai-floating-trigger" type="button" onClick={() => setPanelOpen(true)}>
          <Sparkles size={16} />
          Open DrawAI
        </button>
      )}

      {panelOpen && (
        <aside className="drawai-panel drawai-mini-panel" aria-label="DrawAI agent surface">
          <div className="mini-panel-header">
            <div>
              <span className="section-kicker">AGENT SURFACE</span>
              <h1>DrawAI</h1>
            </div>
            <button className="icon-button" type="button" onClick={() => setPanelOpen(false)} aria-label="Close DrawAI surface">
              <X size={16} />
            </button>
          </div>
          <div className={"mini-status " + runtimeMode}>
            <span className="status-dot" />
            <span>{runtimeLabel}</span>
            <span className="runtime-count">{webmcpTools.length} tools</span>
          </div>
          <div className="mini-metrics">
            <span><strong>{sceneElements.length}</strong> elements</span>
            <span><strong>{agentCount}</strong> agents</span>
            <span><strong>{drawingTools.length}</strong> custom</span>
          </div>
          <div className="mini-compute"><span className="compute-dot" /> client compute · {layoutEngine === "idle" ? "ready" : layoutEngine}</div>
          <div className="mini-actions">
            <button type="button" onClick={() => setBridgeOpen(true)}><Cable size={13} /> Bridge</button>
            <button type="button" onClick={openNewTool}><Code2 size={13} /> New tool</button>
          </div>
          <div className="mini-event">
            <Radio size={13} />
            <span>{events[0]?.label || "Ready for an agent"}</span>
          </div>
        </aside>
      )}

      {studioOpen && (
        <div className="studio-layer" role="dialog" aria-modal="true" aria-label="Drawing tool studio">
          <form className="tool-studio" onSubmit={submitTool}>
            <div className="studio-header">
              <div>
                <span className="section-kicker">TOOL STUDIO</span>
                <h2>{editingToolId ? "Tune a shared tool" : "Create a shared tool"}</h2>
                <p>Give the agent and your canvas a reusable move.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setStudioOpen(false)} aria-label="Close tool studio">
                <X size={18} />
              </button>
            </div>
            <label>
              Tool name
              <input
                value={toolForm.name}
                onChange={(event) => setToolForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. mark_risk"
                required
              />
              <span className="field-hint">Published as {makeToolName(toolForm.name || "new_tool")}</span>
            </label>
            <label>
              Display title
              <input
                value={toolForm.title}
                onChange={(event) => setToolForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Mark a risk"
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={toolForm.description}
                onChange={(event) => setToolForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="What should this tool do?"
                rows={2}
                required
              />
            </label>
            <label>
              Agent instruction
              <input
                value={toolForm.instruction}
                onChange={(event) => setToolForm((current) => ({ ...current, instruction: event.target.value }))}
                placeholder="What should the agent compose?"
                required
              />
            </label>
            <div className="schema-preview">
              <div><Code2 size={14} /> WebMCP schema</div>
              <code>{"{ nodes: Node[], edges?: Edge[], layout?: LayoutMode }"}</code>
            </div>
            <div className="studio-actions">
              <button type="button" className="secondary-button" onClick={() => setStudioOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button"><Sparkles size={15} /> {editingToolId ? "Save changes" : "Create tool"}</button>
            </div>
          </form>
        </div>
      )}

      {bridgeOpen && (
        <div className="bridge-layer" role="dialog" aria-modal="true" aria-label="DrawAI agent bridge">
          <div className="bridge-dialog">
            <div className="studio-header">
              <div>
                <span className="section-kicker">AGENT BRIDGE · {DRAWAI_AGENT_PROTOCOL}</span>
                <h2>Connect an agent</h2>
                <p>Give any same-origin agent a live, shared canvas surface.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setBridgeOpen(false)} aria-label="Close agent bridge">
                <X size={18} />
              </button>
            </div>
            <div className="bridge-steps">
              <div><span>01</span><strong>Discover</strong><p>Listen on the <code>drawai-agent-v1</code> BroadcastChannel or send a same-origin <code>postMessage</code>.</p></div>
              <div><span>02</span><strong>Inspect</strong><p>Send <code>drawai:hello</code> or <code>drawai:list_tools</code> to receive the live registry.</p></div>
              <div><span>03</span><strong>Compose</strong><p>Invoke <code>compose_canvas</code> with the graph the agent has reasoned about. DrawAI only validates and lays it out locally.</p></div>
            </div>
            <pre className="bridge-code"><code>{'const agent = window.__drawaiAgent;\nawait agent.connect("my-agent");\nawait agent.invoke("compose_canvas", {\n  title: "Agent-provided canvas",\n  nodes: [{ id: "a", label: "First idea" }, { id: "b", label: "Next idea" }],\n  edges: [{ source: "a", target: "b" }]\n});'}</code></pre>
            <div className="bridge-dialog-footer">
              <span><span className="bridge-live-dot" /> {agentCount} connected in this tab</span>
              <button type="button" className="primary-button" onClick={() => window.__drawaiAgent?.connect("studio-preview")}>
                <Cable size={14} /> Test page agent
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
