export type TaskStatus = "open" | "done";

export type CustomAction = "add_task" | "complete_task" | "add_note" | "set_focus";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
}

export interface CustomTool {
  id: string;
  name: string;
  title: string;
  description: string;
  inputLabel: string;
  action: CustomAction;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceState {
  tasks: Task[];
  notes: string[];
  focus: string;
  customTools: CustomTool[];
}

export interface ActivityEvent {
  id: string;
  time: string;
  label: string;
  detail: string;
  tone: "mint" | "amber" | "violet" | "muted";
}
