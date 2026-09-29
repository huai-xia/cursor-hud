import { createReadStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import type { AgentEntry, TodoItem, ToolEntry, TranscriptData } from "./types.js";

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

interface TranscriptLine {
  role?: string;
  type?: string;
  message?: { content?: ContentBlock[] | string };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function normalizeTodoStatus(status: unknown): TodoItem["status"] {
  if (typeof status !== "string") return "pending";
  switch (status) {
    case "completed":
    case "complete":
    case "done":
      return "completed";
    case "in_progress":
    case "in-progress":
    case "running":
      return "in_progress";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Resolve display name + optional specialization for Cursor tools.
 * CallDynamicTool({ namespace, toolName, arguments }) → treat Task/TodoWrite specially.
 */
function resolveTool(block: ContentBlock): {
  name: string;
  input: Record<string, unknown>;
  isTask: boolean;
  isTodo: boolean;
} {
  const rawName = block.name || "tool";
  const input = asRecord(block.input) || {};

  if (rawName === "CallDynamicTool" || rawName === "CallMcpTool") {
    const toolName = typeof input.toolName === "string" ? input.toolName : "";
    const args = asRecord(input.arguments) || {};
    if (toolName === "Task" || toolName === "Agent") {
      return { name: toolName, input: args, isTask: true, isTodo: false };
    }
    if (toolName === "TodoWrite") {
      return { name: toolName, input: args, isTask: false, isTodo: true };
    }
    if (toolName) {
      return { name: toolName, input: { ...input, ...args }, isTask: false, isTodo: false };
    }
  }

  if (rawName === "Task" || rawName === "Agent") {
    return { name: rawName, input, isTask: true, isTodo: false };
  }
  if (rawName === "TodoWrite") {
    return { name: rawName, input, isTask: false, isTodo: true };
  }

  return { name: rawName, input, isTask: false, isTodo: false };
}

/** Keep path-like targets mostly intact; display layer relativizes + truncates. */
const PATH_STORE_MAX = 240;
const TEXT_STORE_MAX = 80;

function extractTarget(name: string, input: Record<string, unknown>): string | undefined {
  switch (name) {
    case "Read":
    case "Write":
    case "StrReplace":
    case "Edit":
    case "Delete":
      if (typeof input.path === "string") return truncate(input.path, PATH_STORE_MAX);
      if (typeof input.file_path === "string") return truncate(input.file_path, PATH_STORE_MAX);
      break;
    case "Glob":
      if (typeof input.glob_pattern === "string") return truncate(input.glob_pattern, TEXT_STORE_MAX);
      if (typeof input.pattern === "string") return truncate(input.pattern, TEXT_STORE_MAX);
      break;
    case "Grep":
      if (typeof input.path === "string") return truncate(input.path, PATH_STORE_MAX);
      if (typeof input.pattern === "string") return truncate(input.pattern, TEXT_STORE_MAX);
      break;
    case "Shell":
    case "Bash":
      if (typeof input.command === "string") return truncate(input.command, TEXT_STORE_MAX);
      break;
    case "GetDynamicTools":
      if (typeof input.namespace === "string") {
        const t = typeof input.toolName === "string" ? `.${input.toolName}` : "";
        return truncate(`${input.namespace}${t}`, TEXT_STORE_MAX);
      }
      break;
    default:
      if (typeof input.description === "string") return truncate(input.description, TEXT_STORE_MAX);
  }
  return undefined;
}

interface ParsedMessage {
  role: "user" | "assistant" | "other";
  tools: Array<{
    id: string;
    name: string;
    target?: string;
    isTask: boolean;
    isTodo: boolean;
    input: Record<string, unknown>;
  }>;
  hasText: boolean;
}

function parseMessage(line: TranscriptLine, msgIndex: number): ParsedMessage | null {
  const roleRaw = line.role || line.type;
  const role =
    roleRaw === "user" || roleRaw === "assistant"
      ? roleRaw
      : roleRaw === "human"
        ? "user"
        : "other";

  const content = line.message?.content;
  const tools: ParsedMessage["tools"] = [];
  let hasText = false;

  if (typeof content === "string") {
    hasText = content.trim().length > 0;
  } else if (Array.isArray(content)) {
    let toolIdx = 0;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && block.text?.trim()) hasText = true;
      if (block.type !== "tool_use" || !block.name) continue;

      const resolved = resolveTool(block);
      const id =
        (typeof block.id === "string" && block.id) ||
        `synth-${msgIndex}-${toolIdx}-${resolved.name}`;
      toolIdx += 1;

      tools.push({
        id,
        name: resolved.name,
        target: extractTarget(resolved.name, resolved.input),
        isTask: resolved.isTask,
        isTodo: resolved.isTodo,
        input: resolved.input,
      });
    }
  }

  if (role === "other" && tools.length === 0 && !hasText) return null;
  return { role: role === "other" ? "assistant" : role, tools, hasText };
}

/**
 * Cursor transcripts often lack tool ids and tool_result blocks.
 * Heuristic: within the latest turn, tools in the final assistant message are
 * "running"; everything earlier is "completed".
 */
export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const empty: TranscriptData = { tools: [], agents: [], todos: [] };
  if (!transcriptPath || !existsSync(transcriptPath)) return empty;

  try {
    statSync(transcriptPath);
  } catch {
    return empty;
  }

  const messages: ParsedMessage[] = [];
  const stream = createReadStream(transcriptPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let msgIndex = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = parseMessage(JSON.parse(trimmed) as TranscriptLine, msgIndex);
      if (parsed) {
        messages.push(parsed);
        msgIndex += 1;
      }
    } catch {
      /* skip bad lines */
    }
  }

  // Split into turns: each user message starts a turn
  const turns: ParsedMessage[][] = [];
  let current: ParsedMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      if (current.length) turns.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
  }
  if (current.length) turns.push(current);

  const tools: ToolEntry[] = [];
  const agents: AgentEntry[] = [];
  let latestTodos: TodoItem[] = [];

  const lastTurnIndex = turns.length - 1;

  for (let ti = 0; ti < turns.length; ti++) {
    const turn = turns[ti];
    const assistantMsgs = turn.filter((m) => m.role === "assistant");
    const lastAssistantIndex = assistantMsgs.length - 1;

    for (let ai = 0; ai < assistantMsgs.length; ai++) {
      const msg = assistantMsgs[ai];
      const isLastMsgOfLastTurn = ti === lastTurnIndex && ai === lastAssistantIndex;
      // If the final assistant message is text-only, the turn is idle → all completed
      const runningHere = isLastMsgOfLastTurn && msg.tools.length > 0;

      for (const t of msg.tools) {
        if (t.isTodo) {
          const todos = t.input.todos;
          if (Array.isArray(todos)) {
            const next: TodoItem[] = [];
            for (const item of todos) {
              const rec = asRecord(item);
              if (!rec) continue;
              const content =
                typeof rec.content === "string"
                  ? rec.content
                  : typeof rec.title === "string"
                    ? rec.title
                    : "";
              if (!content) continue;
              next.push({
                id: typeof rec.id === "string" ? rec.id : undefined,
                content,
                status: normalizeTodoStatus(rec.status),
              });
            }
            latestTodos = next;
          }
          continue;
        }

        if (t.isTask) {
          agents.push({
            id: t.id,
            type:
              typeof t.input.subagent_type === "string"
                ? t.input.subagent_type
                : typeof t.input.subagentType === "string"
                  ? t.input.subagentType
                  : "agent",
            description:
              typeof t.input.description === "string"
                ? truncate(t.input.description, 40)
                : undefined,
            model: typeof t.input.model === "string" ? t.input.model : undefined,
            status: runningHere ? "running" : "completed",
            background: t.input.run_in_background === true || t.input.runInBackground === true,
          });
          continue;
        }

        tools.push({
          id: t.id,
          name: t.name,
          target: t.target,
          status: runningHere ? "running" : "completed",
        });
      }
    }
  }

  return { tools, agents, todos: latestTodos };
}
