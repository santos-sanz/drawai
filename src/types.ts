export type DrawingToolAction = "sticky_note" | "user_journey" | "highlight_area" | "label_element";

export interface DrawingTool {
  id: string;
  name: string;
  title: string;
  description: string;
  inputLabel: string;
  action: DrawingToolAction;
  createdAt: string;
}

export interface AgentEvent {
  id: string;
  label: string;
  detail: string;
  time: string;
  actor: "agent" | "human" | "system";
}
