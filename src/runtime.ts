export type JsonSchema = Record<string, unknown>;

export interface WebMCPToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
}

export interface ModelContextLike {
  registerTool?: (tool: WebMCPToolDefinition, options?: { signal?: AbortSignal }) => void | Promise<void>;
  getTools?: () => Promise<Array<{ name: string }>>;
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }

  interface Navigator {
    modelContext?: ModelContextLike;
  }
}

export type RuntimeMode = "native" | "fallback" | "offline";

export interface RegistryEvent {
  message: string;
  mode: RuntimeMode;
}

let activeController: AbortController | null = null;

export function getModelContext(): { context: ModelContextLike | null; mode: RuntimeMode } {
  if (document.modelContext?.registerTool) {
    return { context: document.modelContext, mode: "native" };
  }

  if (navigator.modelContext?.registerTool) {
    return { context: navigator.modelContext, mode: "fallback" };
  }

  return { context: null, mode: "offline" };
}

export async function registerToolSurface(
  tools: WebMCPToolDefinition[],
  execute: WebMCPToolDefinition["execute"],
  onEvent: (event: RegistryEvent) => void,
): Promise<() => void> {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const { context, mode } = getModelContext();

  if (!context?.registerTool) {
    onEvent({ message: "Preview mode · browser WebMCP API not detected", mode: "offline" });
    return () => controller.abort();
  }

  let registered = 0;
  for (const tool of tools) {
    if (controller.signal.aborted) break;
    try {
      const toolExecutor = async (input: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
        execute({ __toolName: tool.name, ...input }, options);
      await context.registerTool({ ...tool, execute: toolExecutor }, { signal: controller.signal });
      registered += 1;
    } catch (error) {
      console.warn("[DrawAI] Could not register " + tool.name, error);
    }
  }

  onEvent({
    message: registered + " capabilities live · " + (mode === "native" ? "document" : "navigator") + ".modelContext",
    mode,
  });
  return () => controller.abort();
}

export function makeToolName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 42);
  return normalized || "new_drawing_tool";
}
