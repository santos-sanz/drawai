import type { WebMCPToolDefinition } from "./runtime";

export const DRAWAI_AGENT_PROTOCOL = "drawai-agent-v1";
const CHANNEL_NAME = "drawai-agent-v1";

type AgentTransport = "broadcast" | "postmessage" | "page";

type AgentMessage = {
  type: string;
  requestId?: string;
  agentId?: string;
  tool?: string;
  input?: Record<string, unknown>;
};

export type AgentToolSummary = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export interface PublicDrawAIAgentAPI {
  protocol: string;
  channel: string;
  connect: (agentId?: string) => Promise<{ connected: true; agentId: string; tools: AgentToolSummary[] }>;
  listTools: () => AgentToolSummary[];
  invoke: (tool: string, input?: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentBridgeCallbacks {
  onAgentConnected?: (agentId: string, transport: AgentTransport) => void;
  onAgentRequest?: (tool: string) => void;
  onAgentError?: (message: string) => void;
}

declare global {
  interface Window {
    __drawaiAgent?: PublicDrawAIAgentAPI;
  }
}

function isAgentMessage(value: unknown): value is AgentMessage {
  return Boolean(value && typeof value === "object" && "type" in value && typeof value.type === "string");
}

export class DrawAIAgentBridge {
  private tools: WebMCPToolDefinition[] = [];
  private execute: WebMCPToolDefinition["execute"] = async () => ({ ok: false, error: "Agent bridge is not ready." });
  private channel: BroadcastChannel | null = null;
  private running = false;
  private callbacks: AgentBridgeCallbacks = {};
  private agents = new Map<string, number>();

  private handleWindowMessage = (event: MessageEvent) => {
    if (event.origin && event.origin !== window.location.origin) return;
    void this.handleMessage(event.data, event, "postmessage");
  };

  private handleChannelMessage = (event: MessageEvent) => {
    void this.handleMessage(event.data, event, "broadcast");
  };

  start(tools: WebMCPToolDefinition[], execute: WebMCPToolDefinition["execute"], callbacks: AgentBridgeCallbacks = {}): () => void {
    this.tools = tools;
    this.execute = execute;
    this.callbacks = callbacks;
    if (this.running) return () => this.stop();

    this.running = true;
    window.addEventListener("message", this.handleWindowMessage);
    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener("message", this.handleChannelMessage);
    }

    window.__drawaiAgent = {
      protocol: DRAWAI_AGENT_PROTOCOL,
      channel: CHANNEL_NAME,
      connect: async (agentId = "page-agent") => {
        this.agents.set(agentId, Date.now());
        this.callbacks.onAgentConnected?.(agentId, "page");
        return { connected: true, agentId, tools: this.toolSummaries() };
      },
      listTools: () => this.toolSummaries(),
      invoke: async (tool, input = {}) => this.execute({ ...input, __toolName: tool }),
    };

    return () => this.stop();
  }

  update(tools: WebMCPToolDefinition[], execute: WebMCPToolDefinition["execute"]): void {
    this.tools = tools;
    this.execute = execute;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener("message", this.handleWindowMessage);
    this.channel?.removeEventListener("message", this.handleChannelMessage);
    this.channel?.close();
    this.channel = null;
    delete window.__drawaiAgent;
  }

  connectedAgentCount(): number {
    return this.agents.size;
  }

  private toolSummaries(): AgentToolSummary[] {
    return this.tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
  }

  private async handleMessage(value: unknown, event: MessageEvent, transport: AgentTransport): Promise<void> {
    if (!isAgentMessage(value)) return;
    const message = value;
    const agentId = message.agentId || "anonymous-agent";

    if (message.type === "drawai:hello") {
      this.agents.set(agentId, Date.now());
      this.callbacks.onAgentConnected?.(agentId, transport);
      this.send(
        {
          type: "drawai:hello_ack",
          protocol: DRAWAI_AGENT_PROTOCOL,
          requestId: message.requestId,
          agentId,
          tools: this.toolSummaries(),
        },
        event,
      );
      return;
    }

    if (message.type === "drawai:list_tools") {
      this.send(
        {
          type: "drawai:tools",
          protocol: DRAWAI_AGENT_PROTOCOL,
          requestId: message.requestId,
          tools: this.toolSummaries(),
        },
        event,
      );
      return;
    }

    if (message.type === "drawai:ping") {
      this.send({ type: "drawai:pong", protocol: DRAWAI_AGENT_PROTOCOL, requestId: message.requestId }, event);
      return;
    }

    if (message.type === "drawai:subscribe") {
      this.send({ type: "drawai:subscribed", protocol: DRAWAI_AGENT_PROTOCOL, requestId: message.requestId }, event);
      return;
    }

    if (message.type !== "drawai:invoke") return;
    const tool = message.tool || "";
    this.callbacks.onAgentRequest?.(tool);
    if (!this.tools.some((registeredTool) => registeredTool.name === tool)) {
      this.callbacks.onAgentError?.("Unknown agent tool: " + tool);
      this.send({ type: "drawai:response", requestId: message.requestId, ok: false, error: "Unknown tool: " + tool }, event);
      return;
    }

    try {
      const result = await this.execute({ ...(message.input || {}), __toolName: tool });
      this.send({ type: "drawai:response", requestId: message.requestId, ok: true, result }, event);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Tool execution failed.";
      this.callbacks.onAgentError?.(detail);
      this.send({ type: "drawai:response", requestId: message.requestId, ok: false, error: detail }, event);
    }
  }

  private send(payload: Record<string, unknown>, event: MessageEvent): void {
    if (event.source && typeof (event.source as Window).postMessage === "function") {
      (event.source as Window).postMessage(payload, event.origin || window.location.origin);
      return;
    }
    this.channel?.postMessage(payload);
  }
}
