export type ToolStatus = "running" | "completed" | "error";

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: ToolStatus;
}

export interface AgentEntry {
  id: string;
  type: string;
  description?: string;
  model?: string;
  status: ToolStatus;
  background: boolean;
  /** Wall-clock start (from local timer cache). */
  startedAtMs?: number;
  /** Wall-clock end when status became completed. */
  endedAtMs?: number;
}

export interface TodoItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
}
