export interface DrawingTool {
  id: string;
  name: string;
  title: string;
  description: string;
  instruction: string;
  createdAt: string;
}

export interface AgentEvent {
  id: string;
  label: string;
  detail: string;
  time: string;
  actor: "agent" | "human" | "system";
}
