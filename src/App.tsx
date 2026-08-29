import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawImperativeAPI, AppState } from "@excalidraw/excalidraw/types";
import type {
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleDashed,
  Code2,
  LayoutTemplate,
  MousePointer2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
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
import type { AgentEvent, DrawingTool, DrawingToolAction } from "./types";

const SCENE_KEY = "drawai-scene-v1";
const TOOLS_KEY = "drawai-tools-v1";

const INITIAL_SKELETONS = [
  {
    type: "rectangle",
    x: 140,
    y: 190,
    width: 240,
    height: 118,
    strokeColor: "#4c3a80",
    backgroundColor: "#f0ebff",
    fillStyle: "solid",
    roundness: { type: 3 },
    label: { text: "DrawAI", fontSize: 24 },
  },
  {
    type: "rectangle",
    x: 420,
    y: 190,
    width: 240,
    height: 118,
    strokeColor: "#207f72",
    backgroundColor: "#e7f7f2",
    fillStyle: "solid",
    roundness: { type: 3 },
    label: { text: "Human intent", fontSize: 22 },
  },
  {
    type: "rectangle",
    x: 700,
    y: 190,
    width: 240,
    height: 118,
    strokeColor: "#9f5b17",
    backgroundColor: "#fff3da",
    fillStyle: "solid",
    roundness: { type: 3 },
    label: { text: "Agent action", fontSize: 22 },
  },
  {
    type: "rectangle",
    x: 420,
    y: 435,
    width: 240,
    height: 118,
    strokeColor: "#315c91",
    backgroundColor: "#e9f1ff",
    fillStyle: "solid",
    roundness: { type: 3 },
    label: { text: "Shared canvas", fontSize: 22 },
  },
  {
    type: "arrow",
    x: 380,
    y: 249,
    points: [
      [0, 0],
      [40, 0],
    ],
    strokeColor: "#6b5b95",
    strokeWidth: 2,
    endArrowhead: "arrow",
  },
  {
    type: "arrow",
    x: 660,
    y: 249,
    points: [
      [0, 0],
      [40, 0],
    ],
    strokeColor: "#6b5b95",
    strokeWidth: 2,
    endArrowhead: "arrow",
  },
  {
    type: "arrow",
    x: 540,
    y: 308,
    points: [
      [0, 0],
      [0, 127],
    ],
    strokeColor: "#6b5b95",
    strokeWidth: 2,
    endArrowhead: "arrow",
  },
  {
    type: "text",
    x: 175,
    y: 370,
    text: "Together.",
    width: 380,
    height: 30,
    fontSize: 20,
    strokeColor: "#5f6368",
  },
] as ExcalidrawElementSkeleton[];

const INITIAL_ELEMENTS = convertToExcalidrawElements(INITIAL_SKELETONS, {
  regenerateIds: true,
});

const BASE_TOOL_META: Array<
  Pick<WebMCPToolDefinition, "name" | "title" | "description" | "inputSchema" | "annotations">
> = [
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
        inputLabel: { type: "string", description: "What input the tool asks for." },
        action: {
          type: "string",
          enum: ["sticky_note", "user_journey", "highlight_area", "label_element"],
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { untrustedContentHint: true },
  },
];

const ACTION_LABELS: Record<DrawingToolAction, string> = {
  sticky_note: "Sticky note",
  user_journey: "User journey",
  highlight_area: "Highlight area",
  label_element: "Label element",
};

type ToolFormState = {
  name: string;
  title: string;
  description: string;
  inputLabel: string;
  action: DrawingToolAction;
};

const EMPTY_TOOL_FORM: ToolFormState = {
  name: "",
  title: "",
  description: "",
  inputLabel: "What should the tool add?",
  action: "sticky_note",
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
    if (!stored) return INITIAL_ELEMENTS;
    const parsed = JSON.parse(stored) as { elements?: OrderedExcalidrawElement[] };
    return Array.isArray(parsed.elements) ? parsed.elements : INITIAL_ELEMENTS;
  } catch {
    return INITIAL_ELEMENTS;
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
        text: text || "New idea",
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
        text: text || "New note",
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

function actionSkeletons(action: DrawingToolAction, input: Record<string, unknown>): ExcalidrawElementSkeleton[] {
  const x = numeric(input.x, action === "user_journey" ? 280 : 420);
  const y = numeric(input.y, action === "user_journey" ? 620 : 390);
  const text = getInputText(input, action === "user_journey" ? "New journey" : "New idea");

  if (action === "sticky_note") {
    return shapeSkeletons({
      shape: "sticky",
      x,
      y,
      width: numeric(input.width, 240),
      height: numeric(input.height, 130),
      text,
    });
  }

  if (action === "highlight_area") {
    return [
      {
        type: "rectangle",
        x,
        y,
        width: Math.max(180, numeric(input.width, 420)),
        height: Math.max(130, numeric(input.height, 190)),
        strokeColor: "#d0643a",
        backgroundColor: "#fff7f2",
        fillStyle: "solid",
        strokeStyle: "dashed",
        strokeWidth: 3,
        roundness: { type: 3 },
      },
      {
        type: "text",
        x: x + 18,
        y: y + 18,
        text,
        width: Math.max(280, numeric(input.width, 420) - 36),
        height: 30,
        fontSize: 18,
        strokeColor: "#a64e31",
      },
    ] as ExcalidrawElementSkeleton[];
  }

  if (action === "label_element") {
    return [
      {
        type: "text",
        x,
        y,
        text,
        width: 380,
        height: 34,
        fontSize: 22,
        strokeColor: "#315c91",
      },
    ];
  }

  const nodeWidth = 190;
  const nodeHeight = 92;
  const labels = [text, "Explore", "Commit"];
  const colors = [
    ["#4c3a80", "#f0ebff"],
    ["#207f72", "#e7f7f2"],
    ["#9f5b17", "#fff3da"],
  ];
  const elements: ExcalidrawElementSkeleton[] = [];
  labels.forEach((label, index) => {
    const nodeX = x + index * 260;
    elements.push({
      type: "rectangle",
      x: nodeX,
      y,
      width: nodeWidth,
      height: nodeHeight,
      strokeColor: colors[index][0],
      backgroundColor: colors[index][1],
      fillStyle: "solid",
      roundness: { type: 3 },
      label: { text: label, fontSize: 19 },
    } as ExcalidrawElementSkeleton);
    if (index < labels.length - 1) {
      elements.push({
        type: "arrow",
        x: nodeX + nodeWidth,
        y: y + nodeHeight / 2,
        points: [
          [0, 0],
          [70, 0],
        ],
        strokeColor: "#6b5b95",
        strokeWidth: 2,
        endArrowhead: "arrow",
      } as ExcalidrawElementSkeleton);
    }
  });
  return elements;
}

function initialToolForm(tool: DrawingTool | null): ToolFormState {
  if (!tool) return EMPTY_TOOL_FORM;
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputLabel: tool.inputLabel,
    action: tool.action,
  };
}

function toolInputSchema(tool: DrawingTool): JsonSchema {
  return {
    type: "object",
    properties: {
      input: { type: "string", description: tool.inputLabel },
      x: { type: "number", description: "Canvas x coordinate." },
      y: { type: "number", description: "Canvas y coordinate." },
    },
    required: ["input"],
    additionalProperties: false,
  };
}

function App() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
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
  const [prompt, setPrompt] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("offline");
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
    (skeletons: ExcalidrawElementSkeleton[], actor: AgentEvent["actor"], label: string, detail: string) => {
      const api = apiRef.current;
      if (!api || skeletons.length === 0) {
        addEvent("system", "Canvas is still loading", "Try again when the editor is visible.");
        return { ok: false, added: 0 };
      }
      const created = convertToExcalidrawElements(skeletons, { regenerateIds: true });
      const nextElements = [...api.getSceneElements(), ...created];
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
      const action = stringValue(input.action, "sticky_note") as DrawingToolAction;
      const nextTool: DrawingTool = {
        id: existingId || makeId("tool"),
        name,
        title,
        description: stringValue(input.description, "A reusable tool for the shared canvas."),
        inputLabel: stringValue(input.inputLabel, "What should the tool add?"),
        action: ACTION_LABELS[action] ? action : "sticky_note",
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
    (tool: DrawingTool, input: Record<string, unknown>) => {
      const text = getInputText(input, tool.title);
      const result = addToScene(
        actionSkeletons(tool.action, { ...input, input: text }),
        "agent",
        "Ran " + tool.title,
        "The agent used the shared " + ACTION_LABELS[tool.action].toLowerCase() + " action.",
      );
      return { ok: result.ok, tool: tool.name, added: result.added };
    },
    [addToScene],
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
        const result = addToScene(
          shapeSkeletons(input),
          "agent",
          "Agent drew a " + shape,
          "The new element is part of the same editable canvas.",
        );
        return { ok: result.ok, shape, added: result.added };
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
      openStudio: () => setStudioOpen(true),
    };
    return () => {
      delete debugWindow.__drawaiState;
    };
  }, [drawingTools, runtimeMode, sceneElements.length]);

  const runPrompt = useCallback(
    (value: string) => {
      const request = value.trim();
      if (!request) return;
      const lower = request.toLowerCase();
      setPrompt("");

      if (lower.includes("journey") || lower.includes("flow") || lower.includes("flujo")) {
        const result = addToScene(
          actionSkeletons("user_journey", { input: request, x: 260, y: 610 }),
          "agent",
          "Agent mapped a user journey",
          "Three editable steps were added to the shared canvas.",
        );
        addEvent("human", "Prompt understood", result.ok ? "Flow added from your request." : "The canvas was not ready yet.");
        return;
      }

      if (lower.includes("sticky") || lower.includes("note") || lower.includes("nota")) {
        const result = addToScene(
          shapeSkeletons({ shape: "sticky", input: request, x: 500, y: 610 }),
          "agent",
          "Agent added a sticky note",
          "The note is editable with the regular Excalidraw tools.",
        );
        addEvent("human", "Prompt understood", result.ok ? "Sticky note added." : "The canvas was not ready yet.");
        return;
      }

      if (lower.includes("clear") || lower.includes("delete") || lower.includes("borrar")) {
        const api = apiRef.current;
        const selected = selectedIds;
        if (api && selected.length) {
          api.updateScene({
            elements: api
              .getSceneElementsIncludingDeleted()
              .map((element) => (selected.includes(element.id) ? { ...element, isDeleted: true } : element)),
          });
          addEvent("agent", "Selection cleared", selected.length + " selected element(s) removed.");
        } else {
          addEvent("agent", "Nothing selected", "Select an element first, then ask me to clear it.");
        }
        return;
      }

      if (lower.includes("tool") || lower.includes("herramienta")) {
        setStudioOpen(true);
        addEvent("agent", "Tool Studio opened", "Describe a reusable canvas action and we will make it together.");
        return;
      }

      const result = addToScene(
        shapeSkeletons({ shape: "text", input: request, x: 420, y: 610 }),
        "agent",
        "Agent captured an idea",
        "I placed your request on the shared canvas as editable text.",
      );
      addEvent("human", "Prompt understood", result.ok ? "Idea added as a canvas label." : "The canvas was not ready yet.");
    },
    [addEvent, addToScene, selectedIds],
  );

  const openNewTool = useCallback(() => {
    setEditingToolId(null);
    setToolForm(EMPTY_TOOL_FORM);
    setStudioOpen(true);
  }, []);

  const editTool = useCallback((tool: DrawingTool) => {
    setEditingToolId(tool.id);
    setToolForm(initialToolForm(tool));
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

  const deleteTool = useCallback(
    (tool: DrawingTool) => {
      saveTool({ operation: "delete", id: tool.id });
    },
    [saveTool],
  );

  const runtimeLabel =
    runtimeMode === "native" ? "WebMCP connected" : runtimeMode === "fallback" ? "WebMCP fallback" : "Preview mode";
  const initialData = useMemo(
    () => ({
      elements: initialElementsRef.current,
      appState: { viewBackgroundColor: "#ffffff" as const },
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

      {!panelOpen && (
        <button className="drawai-floating-trigger" type="button" onClick={() => setPanelOpen(true)}>
          <Sparkles size={16} />
          Open DrawAI
        </button>
      )}

      {panelOpen && (
        <aside className="drawai-panel" aria-label="DrawAI copilot">
          <div className="panel-header">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-mark">
                  <Pencil size={12} />
                </span>
                DRAWING × WEBMCP
              </div>
              <h1>DrawAI</h1>
              <p>Human + agent on one canvas.</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setPanelOpen(false)} aria-label="Close DrawAI copilot">
              <X size={18} />
            </button>
          </div>

          <div className={"runtime-status " + runtimeMode}>
            <span className="status-dot" />
            <span>{runtimeLabel}</span>
            <span className="runtime-count">{webmcpTools.length} tools</span>
          </div>

          <section className="copilot-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">COPILOT</span>
                <h2>What should we draw?</h2>
              </div>
              <Bot size={20} className="section-icon" />
            </div>
            <p className="section-description">
              Ask for a flow, a note, or a new reusable tool. The agent edits the same canvas you can edit.
            </p>
            <div className="prompt-box">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    runPrompt(prompt);
                  }
                }}
                placeholder="e.g. Map the checkout journey"
                aria-label="Agent prompt"
                rows={3}
              />
              <button type="button" className="prompt-submit" onClick={() => runPrompt(prompt)} disabled={!prompt.trim()}>
                <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="prompt-chips">
              <button type="button" onClick={() => runPrompt("Map a user journey for onboarding")}>
                <LayoutTemplate size={13} /> User journey
              </button>
              <button type="button" onClick={() => runPrompt("Add a sticky note about the next idea")}>
                <Plus size={13} /> Sticky note
              </button>
              <button type="button" onClick={() => setStudioOpen(true)}>
                <WandSparkles size={13} /> Make a tool
              </button>
            </div>
          </section>

          <section className="activity-section">
            <div className="section-heading compact">
              <div>
                <span className="section-kicker">LIVE TRACE</span>
                <h2>Activity</h2>
              </div>
              <Activity size={18} className="section-icon" />
            </div>
            <div className="activity-list">
              {events.slice(0, 4).map((event) => (
                <div className="activity-row" key={event.id}>
                  <div className={"activity-avatar " + event.actor}>
                    {event.actor === "agent" ? <Bot size={13} /> : event.actor === "human" ? <MousePointer2 size={13} /> : <CircleDashed size={13} />}
                  </div>
                  <div className="activity-copy">
                    <strong>{event.label}</strong>
                    <span>{event.detail}</span>
                  </div>
                  <time>{event.time}</time>
                </div>
              ))}
            </div>
          </section>

          <section className="tools-section">
            <div className="section-heading compact">
              <div>
                <span className="section-kicker">LIVE REGISTRY</span>
                <h2>Drawing tools</h2>
              </div>
              <button type="button" className="small-action" onClick={openNewTool}>
                <Plus size={14} /> New
              </button>
            </div>
            <div className="tool-list">
              {BASE_TOOL_META.map((tool) => (
                <div className="tool-row built-in" key={tool.name}>
                  <div className="tool-icon"><Code2 size={15} /></div>
                  <div className="tool-copy">
                    <strong>{tool.name}</strong>
                    <span>{tool.title}</span>
                  </div>
                  <span className="tool-pill">base</span>
                </div>
              ))}
              {drawingTools.map((tool) => (
                <div className="tool-row custom" key={tool.id}>
                  <div className="tool-icon custom"><WandSparkles size={15} /></div>
                  <div className="tool-copy">
                    <strong>{tool.name}</strong>
                    <span>{ACTION_LABELS[tool.action]}</span>
                  </div>
                  <div className="tool-actions">
                    <button
                      type="button"
                      onClick={() => runCustomTool(tool, { input: "A new idea" })}
                      aria-label={"Run " + tool.title}
                      title={"Run " + tool.title}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                    <button type="button" onClick={() => editTool(tool)} aria-label={"Edit " + tool.title} title="Edit tool">
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => deleteTool(tool)} aria-label={"Delete " + tool.title} title="Delete tool">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!drawingTools.length && (
              <button className="empty-tool-card" type="button" onClick={openNewTool}>
                <Sparkles size={16} />
                <span><strong>Make the canvas yours.</strong> Create a tool with the agent.</span>
                <ChevronDown size={14} />
              </button>
            )}
          </section>

          <footer className="panel-footer">
            <span><Check size={13} /> Autosaved locally</span>
            <span>{sceneElements.length} elements</span>
          </footer>
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
              Input prompt
              <input
                value={toolForm.inputLabel}
                onChange={(event) => setToolForm((current) => ({ ...current, inputLabel: event.target.value }))}
                placeholder="What should be highlighted?"
                required
              />
            </label>
            <label>
              Canvas action
              <span className="select-wrap">
                <select
                  value={toolForm.action}
                  onChange={(event) => setToolForm((current) => ({ ...current, action: event.target.value as DrawingToolAction }))}
                >
                  {Object.entries(ACTION_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
            <div className="schema-preview">
              <div><Code2 size={14} /> WebMCP schema</div>
              <code>{"{ input: string, x?: number, y?: number }"}</code>
            </div>
            <div className="studio-actions">
              <button type="button" className="secondary-button" onClick={() => setStudioOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button"><Sparkles size={15} /> {editingToolId ? "Save changes" : "Create tool"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

export default App;
