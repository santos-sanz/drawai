import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Command,
  Edit3,
  Layers3,
  Lightbulb,
  ListPlus,
  MessageSquareText,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Sparkles,
  TerminalSquare,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { makeToolName, registerToolSurface, type JsonSchema, type RuntimeMode, type WebMCPToolDefinition } from "./runtime";
import type { ActivityEvent, CustomAction, CustomTool, Task, WorkspaceState } from "./types";

const STORAGE_KEY = "escalero-workspace-v1";

const starterState: WorkspaceState = {
  tasks: [
    { id: "task_1", title: "Shape the smallest useful workflow", status: "done", createdAt: "2026-08-29T12:00:00.000Z" },
    { id: "task_2", title: "Expose the first three capabilities", status: "open", createdAt: "2026-08-29T12:03:00.000Z" },
    { id: "task_3", title: "Design a tool for the next real need", status: "open", createdAt: "2026-08-29T12:05:00.000Z" },
  ],
  notes: ["Start with intent, then grow the interface."],
  focus: "Make the next step obvious",
  customTools: [],
};

const actionLabels: Record<CustomAction, string> = {
  add_task: "Add a task",
  complete_task: "Complete the first open task",
  add_note: "Capture a note",
  set_focus: "Set the workspace focus",
};

const actionDescriptions: Record<CustomAction, string> = {
  add_task: "Creates a new item in the shared workspace.",
  complete_task: "Closes the first open item in the shared workspace.",
  add_note: "Adds a short note to the shared workspace memory.",
  set_focus: "Changes the current focus shown to humans and agents.",
};

const baseTools: WebMCPToolDefinition[] = [
  {
    name: "get_workspace_snapshot",
    title: "Read the workspace",
    description: "Read the current Escalero workspace, including open tasks, focus, notes, and the capabilities available to this agent.",
    inputSchema: {
      type: "object",
      properties: { includeNotes: { type: "boolean", description: "Include workspace notes in the snapshot." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async () => null,
  },
  {
    name: "apply_task_change",
    title: "Change a task",
    description: "Add, complete, or rename a task in the shared Escalero workspace. Use the exact operation and task ID when supplied.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["add", "complete", "rename"], description: "The task change to apply." },
        taskId: { type: "string", description: "The task ID for complete or rename." },
        title: { type: "string", description: "The task text for add or rename." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async () => null,
  },
  {
    name: "design_tool",
    title: "Design a new capability",
    description: "Create, update, or remove a custom Escalero tool. Start small: give it a clear name, one input, and one safe workspace action.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "update", "delete"], description: "How to change the tool registry." },
        name: { type: "string", description: "Stable snake_case name for the custom tool." },
        title: { type: "string", description: "Human-readable title for the tool." },
        description: { type: "string", description: "When an agent should use the tool." },
        inputLabel: { type: "string", description: "What the tool's single text input means." },
        action: { type: "string", enum: ["add_task", "complete_task", "add_note", "set_focus"], description: "The safe workspace action behind the tool." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async () => null,
  },
];

function readStoredState(): WorkspaceState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return starterState;
    const parsed = JSON.parse(value) as Partial<WorkspaceState>;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : starterState.tasks,
      notes: Array.isArray(parsed.notes) ? parsed.notes : starterState.notes,
      focus: typeof parsed.focus === "string" ? parsed.focus : starterState.focus,
      customTools: Array.isArray(parsed.customTools) ? parsed.customTools : [],
    };
  } catch {
    return starterState;
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function toolIcon(name: string) {
  if (name.includes("workspace")) return <Layers3 size={16} />;
  if (name.includes("task")) return <ListPlus size={16} />;
  if (name.includes("design")) return <WandSparkles size={16} />;
  return <Zap size={16} />;
}

function customSchema(tool: CustomTool): JsonSchema {
  return {
    type: "object",
    properties: { input: { type: "string", description: tool.inputLabel } },
    required: ["input"],
    additionalProperties: false,
  };
}

function App() {
  const [state, setState] = useState<WorkspaceState>(readStoredState);
  const stateRef = useRef(state);
  const [events, setEvents] = useState<ActivityEvent[]>([
    { id: "event_1", time: "2026-08-29T12:08:00.000Z", label: "Surface initialized", detail: "3 base capabilities are ready for an agent.", tone: "mint" },
    { id: "event_2", time: "2026-08-29T12:08:10.000Z", label: "Human + agent mode", detail: "Both sides read and change the same workspace.", tone: "violet" },
  ]);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("offline");
  const [studioOpen, setStudioOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<CustomTool | null>(null);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentReply, setAgentReply] = useState("Waiting for an intent…");
  const [toast, setToast] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  stateRef.current = state;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const addEvent = (label: string, detail: string, tone: ActivityEvent["tone"] = "muted") => {
    setEvents((current) => [
      { id: String(Date.now()) + "_" + Math.random(), time: timestamp(), label, detail, tone },
      ...current,
    ].slice(0, 7));
  };

  const addToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  };

  const perform = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    const current = stateRef.current;

    if (name === "get_workspace_snapshot") {
      addEvent("Agent read the workspace", "Returned live tasks, focus, notes, and tool count.", "mint");
      return {
        focus: current.focus,
        openTasks: current.tasks.filter((task) => task.status === "open"),
        completedTasks: current.tasks.filter((task) => task.status === "done"),
        notes: input.includeNotes === false ? [] : current.notes,
        capabilities: baseTools.map((tool) => tool.name).concat(current.customTools.map((tool) => tool.name)),
      };
    }

    if (name === "apply_task_change") {
      const operation = input.operation;
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const taskId = typeof input.taskId === "string" ? input.taskId : "";
      if (operation === "add" && title) {
        const task: Task = { id: "task_" + Date.now(), title, status: "open", createdAt: timestamp() };
        setState((previous) => ({ ...previous, tasks: [...previous.tasks, task] }));
        addEvent("Agent added a task", "“" + title + "” joined the shared workspace.", "amber");
        addToast("Task added by the agent");
        return { ok: true, task };
      }
      if (operation === "complete") {
        const target = current.tasks.find((task) => task.id === taskId) ?? current.tasks.find((task) => task.status === "open");
        if (!target) return { ok: false, error: "No open task was found." };
        setState((previous) => ({ ...previous, tasks: previous.tasks.map((task) => task.id === target.id ? { ...task, status: "done" } : task) }));
        addEvent("Agent completed a task", "“" + target.title + "” is now done.", "mint");
        addToast("Task completed");
        return { ok: true, taskId: target.id };
      }
      if (operation === "rename" && taskId && title) {
        setState((previous) => ({ ...previous, tasks: previous.tasks.map((task) => task.id === taskId ? { ...task, title } : task) }));
        addEvent("Agent renamed a task", "Task " + taskId + " has a clearer intent.", "amber");
        return { ok: true, taskId, title };
      }
      return { ok: false, error: "Use add with title, or complete/rename with a taskId." };
    }

    if (name === "design_tool") {
      const operation = input.operation;
      const rawName = typeof input.name === "string" ? input.name : "";
      const normalizedName = makeToolName(rawName);
      if (operation === "delete") {
        const target = current.customTools.find((tool) => tool.name === normalizedName || tool.id === rawName);
        if (!target) return { ok: false, error: "Custom tool not found." };
        setState((previous) => ({ ...previous, customTools: previous.customTools.filter((tool) => tool.id !== target.id) }));
        addEvent("Capability removed", target.title + " left the live surface.", "violet");
        addToast("Capability removed");
        return { ok: true, removed: target.name };
      }
      const action = (input.action as CustomAction) || "add_note";
      const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : normalizedName.replaceAll("_", " ");
      const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : actionDescriptions[action];
      const inputLabel = typeof input.inputLabel === "string" && input.inputLabel.trim() ? input.inputLabel.trim() : "The short instruction to apply";
      const existing = current.customTools.find((tool) => tool.name === normalizedName || tool.id === rawName);
      if (operation === "update" && existing) {
        const updated: CustomTool = { ...existing, name: normalizedName || existing.name, title, description, inputLabel, action, updatedAt: timestamp() };
        setState((previous) => ({ ...previous, customTools: previous.customTools.map((tool) => tool.id === existing.id ? updated : tool) }));
        addEvent("Capability refined", updated.title + " now exposes an updated schema.", "violet");
        addToast("Capability updated");
        return { ok: true, tool: updated };
      }
      if (operation === "create") {
        if (existing || baseTools.some((tool) => tool.name === normalizedName)) return { ok: false, error: "That tool name is already in use." };
        const now = timestamp();
        const created: CustomTool = { id: "custom_" + Date.now(), name: normalizedName, title, description, inputLabel, action, createdAt: now, updatedAt: now };
        setState((previous) => ({ ...previous, customTools: [...previous.customTools, created] }));
        addEvent("New capability designed", created.title + " is entering the live surface.", "violet");
        addToast("New capability added");
        return { ok: true, tool: created };
      }
      return { ok: false, error: "Use create for a new tool or update with an existing name." };
    }

    const custom = current.customTools.find((tool) => tool.name === name);
    if (!custom) return { ok: false, error: "Unknown capability: " + name };
    const value = typeof input.input === "string" ? input.input.trim() : "";
    if (custom.action === "add_task" && value) return perform("apply_task_change", { operation: "add", title: value });
    if (custom.action === "complete_task") return perform("apply_task_change", { operation: "complete" });
    if (custom.action === "add_note" && value) {
      setState((previous) => ({ ...previous, notes: [value, ...previous.notes].slice(0, 8) }));
      addEvent("Custom capability invoked", custom.title + " captured a note.", "violet");
      addToast("Note captured");
      return { ok: true, note: value };
    }
    if (custom.action === "set_focus" && value) {
      setState((previous) => ({ ...previous, focus: value }));
      addEvent("Custom capability invoked", custom.title + " changed the shared focus.", "violet");
      addToast("Focus updated");
      return { ok: true, focus: value };
    }
    return { ok: false, error: "This capability needs a short text input." };
  };

  const customDefinitions = useMemo<WebMCPToolDefinition[]>(() => state.customTools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: customSchema(tool),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async () => null,
  })), [state.customTools]);

  useEffect(() => {
    let cancelled = false;
    void registerToolSurface(
      [...baseTools, ...customDefinitions],
      async (input, options) => {
        const toolName = typeof input.__toolName === "string" ? input.__toolName : "";
        const cleanInput = { ...input };
        delete cleanInput.__toolName;
        if (options?.signal?.aborted) return { ok: false, error: "Tool execution cancelled." };
        return perform(toolName, cleanInput);
      },
      ({ message, mode }) => {
        if (!cancelled) {
          setRuntimeMode(mode);
          addEvent("Registry synchronized", message, mode === "offline" ? "muted" : "mint");
        }
      },
    );
    return () => { cancelled = true; };
    // The tool handler reads the latest state through stateRef; customDefinitions is the lifecycle boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customDefinitions]);

  const activeTools = [...baseTools, ...customDefinitions];
  const openTasks = state.tasks.filter((task) => task.status === "open");
  const level = state.customTools.length >= 2 ? 3 : state.customTools.length >= 1 ? 2 : 1;
  const progress = level === 1 ? 34 : level === 2 ? 67 : 100;
  const modeLabel = runtimeMode === "offline" ? "Preview mode" : runtimeMode === "native" ? "Native WebMCP" : "Compatibility mode";

  const runPrompt = async () => {
    const prompt = agentPrompt.trim();
    if (!prompt) return;
    const normalized = prompt.toLowerCase();
    if (normalized.includes("crear") || normalized.includes("diseña") || normalized.includes("design")) {
      setStudioOpen(true);
      setAgentReply("I need one more decision: what should this new capability do?");
      addEvent("Agent requested an extension", "Tool Studio is ready for a focused capability.", "violet");
      return;
    }
    if (normalized.includes("completa") || normalized.includes("finish") || normalized.includes("done")) {
      await perform("apply_task_change", { operation: "complete" });
      setAgentReply("I used apply_task_change to complete the first open task.");
      return;
    }
    if (normalized.includes("añade") || normalized.includes("agrega") || normalized.includes("add")) {
      const title = prompt
        .replace(/.*?(añade|agrega|add)\s+/i, "")
        .replace(/^(?:a|an|the)\s+task\s+to\s+/i, "")
        .trim() || "Follow up on the next useful step";
      await perform("apply_task_change", { operation: "add", title });
      setAgentReply("I used apply_task_change to add that to the shared workspace.");
      return;
    }
    const result = await perform("get_workspace_snapshot", { includeNotes: true }) as { openTasks?: Task[]; focus?: string };
    setAgentReply("I read the workspace: " + (result.openTasks?.length ?? 0) + " open tasks, focused on “" + result.focus + "”.");
  };

  const resetWorkspace = () => {
    setState(starterState);
    addEvent("Workspace reset", "Back to the smallest useful surface.", "muted");
    addToast("Workspace reset");
  };

  const openCreate = () => { setEditingTool(null); setStudioOpen(true); };
  const openEdit = (tool: CustomTool) => { setEditingTool(tool); setStudioOpen(true); };
  const deleteTool = async (tool: CustomTool) => { await perform("design_tool", { operation: "delete", name: tool.name }); };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>↗</span></div>
          <div><div className="brand-name">escalero</div><div className="brand-subtitle">web-native capability</div></div>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <nav className="sidebar-nav">
          <button className="sidebar-link active"><Layers3 size={17} /><span>Capability ladder</span><span className="nav-count">{activeTools.length}</span></button>
          <button className="sidebar-link" onClick={() => setShowInspector((current) => !current)}><TerminalSquare size={17} /><span>Runtime inspector</span><span className="live-dot" /></button>
          <button className="sidebar-link" onClick={openCreate}><WandSparkles size={17} /><span>Tool studio</span><ChevronRight size={15} className="nav-chevron" /></button>
        </nav>

        <div className="ladder-card">
          <div className="ladder-header"><span>Growth path</span><span className="ladder-level">0{level} / 03</span></div>
          <div className="progress-track"><span style={{ width: progress + "%" }} /></div>
          <div className="ladder-title">{level === 1 ? "Start with intent" : level === 2 ? "Adapt to the need" : "Compose the system"}</div>
          <p>{level === 1 ? "A small surface is easier for humans and agents to trust." : level === 2 ? "You added a capability without rebuilding the app." : "The workspace now carries its own evolving vocabulary."}</p>
          <div className="ladder-steps">
            <span className={level >= 1 ? "reached" : ""}><i />Small</span>
            <span className={level >= 2 ? "reached" : ""}><i />Adapt</span>
            <span className={level >= 3 ? "reached" : ""}><i />Compose</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="profile-chip"><div className="avatar">AS</div><div><strong>Andrés’ workspace</strong><span>Personal prototype</span></div><Settings2 size={15} /></div>
          <button className="reset-button" onClick={resetWorkspace}><RefreshCw size={14} />Reset demo state</button>
        </div>
      </aside>

      <section className="content-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={13} /><strong>Capability ladder</strong></div>
          <div className="topbar-actions"><div className={"runtime-pill " + runtimeMode}><span className="pill-dot" />{modeLabel}<span className="pill-divider" />{activeTools.length} tools exposed</div><button className="icon-button" aria-label="Open command menu"><Command size={17} /></button></div>
        </header>

        <div className="page-content">
          <div className="hero-row">
            <div className="hero-copy">
              <div className="eyebrow"><Sparkles size={14} />A workspace that grows with the work</div>
              <h1>Start small.<br /><em>Become specific.</em></h1>
              <p>Escalero gives humans and agents the smallest useful tool surface — then lets the workflow teach it what to become next.</p>
              <div className="hero-actions"><button className="primary-button" onClick={openCreate}><Plus size={17} />Design a capability</button><button className="text-button" onClick={() => setShowInspector((current) => !current)}>See the runtime <ArrowUpRight size={15} /></button></div>
            </div>
            <div className="hero-visual" aria-hidden="true">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-node node-main"><Zap size={22} /><span>your workflow</span></div>
              <div className="hero-node node-a"><ListPlus size={16} /><span>task</span></div><div className="hero-node node-b"><WandSparkles size={16} /><span>adapt</span></div><div className="hero-node node-c"><Layers3 size={16} /><span>compose</span></div>
              <div className="connector connector-a" /><div className="connector connector-b" /><div className="connector connector-c" />
            </div>
          </div>

          <div className="metric-strip"><div><span className="metric-label">ACTIVE CAPABILITIES</span><strong>{activeTools.length}</strong><small>{state.customTools.length ? "+" + state.customTools.length + " designed by you" : "The smallest useful surface"}</small></div><div><span className="metric-label">OPEN INTENTS</span><strong>{openTasks.length}</strong><small>Shared with the agent in real time</small></div><div><span className="metric-label">CURRENT FOCUS</span><strong className="focus-metric">{state.focus}</strong><small>Human-readable context</small></div><div className="metric-signal"><Radio size={16} /><span>Registry<br /><b>synchronized</b></span></div></div>

          <div className="dashboard-grid">
            <section className="panel workspace-panel">
              <div className="panel-heading"><div><span className="section-kicker">SHARED WORKSPACE</span><h2>What needs to move?</h2></div><span className="sync-badge"><CircleDot size={12} />Live state</span></div>
              <div className="focus-banner"><div className="focus-icon"><Lightbulb size={16} /></div><div><span>Current focus</span><strong>{state.focus}</strong></div><button aria-label="Change focus" onClick={() => setState((current) => ({ ...current, focus: current.focus === "Make the next step obvious" ? "Turn friction into a capability" : "Make the next step obvious" }))}><Edit3 size={15} /></button></div>
              <div className="task-list">
                {state.tasks.map((task) => <div className={"task-row " + task.status} key={task.id}><button className={"task-check " + task.status} aria-label={task.status === "done" ? "Completed" : "Complete task"} onClick={() => void perform("apply_task_change", { operation: task.status === "done" ? "rename" : "complete", taskId: task.id, ...(task.status === "done" ? { title: task.title } : {}) })}>{task.status === "done" ? <Check size={14} /> : null}</button><span className="task-title">{task.title}</span><span className="task-origin">{task.id === "task_1" ? "seed" : "shared"}</span></div>)}
              </div>
              <button className="add-task-button" onClick={() => { const title = window.prompt("New task"); if (title) void perform("apply_task_change", { operation: "add", title }); }}><Plus size={15} />Add a task</button>
              <div className="workspace-note"><MessageSquareText size={15} /><span>{state.notes[0]}</span></div>
            </section>

            <section className="panel registry-panel">
              <div className="panel-heading"><div><span className="section-kicker">WEBMCP RUNTIME</span><h2>Live tool registry</h2></div><span className="registry-count">{activeTools.length} exposed</span></div>
              <p className="panel-intro">The agent sees only this surface. When your need changes, the schema changes with it.</p>
              <div className="tool-list">
                {activeTools.map((tool) => {
                  const custom = state.customTools.find((item) => item.name === tool.name);
                  return <div className={"tool-row " + (custom ? "custom" : "")} key={tool.name}><div className={"tool-icon " + (custom ? "custom-icon" : "")}>{toolIcon(tool.name)}</div><div className="tool-info"><div className="tool-name-line"><strong>{tool.name}</strong>{custom ? <span className="you-badge">YOU</span> : <span className="core-badge">CORE</span>}</div><span>{tool.title}</span></div>{custom ? <div className="tool-actions"><button onClick={() => openEdit(custom)} aria-label={"Edit " + custom.title}><Edit3 size={14} /></button><button onClick={() => void deleteTool(custom)} aria-label={"Delete " + custom.title}><Trash2 size={14} /></button></div> : <span className="tool-live">LIVE</span>}</div>;
                })}
              </div>
              <button className="registry-cta" onClick={openCreate}><Plus size={15} />Extend the surface <span>⌘ K</span></button>
            </section>
          </div>

          <div className="lower-grid">
            <section className="panel agent-panel">
              <div className="panel-heading"><div><span className="section-kicker">AGENT CONSOLE</span><h2>Ask for the next step</h2></div><div className="agent-avatar"><Bot size={17} /></div></div>
              <p className="panel-intro">Try a natural-language intent. The demo routes it through the same semantic tools exposed to a real agent.</p>
              <div className="prompt-box"><textarea value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} placeholder="e.g. Add a task to review the launch flow…" rows={2} /><button className="send-button" onClick={() => void runPrompt()} aria-label="Run agent intent"><ArrowUpRight size={17} /></button></div>
              <div className="prompt-footer"><span><span className="kbd">↵</span> Run intent</span><div className="suggestion-chips"><button onClick={() => setAgentPrompt("Add a task to test the new capability")}>Add a task</button><button onClick={() => setAgentPrompt("Complete the first open task")}>Complete one</button><button onClick={() => setAgentPrompt("Create a new capability")}>Create tool</button></div></div>
              <div className="agent-reply"><div className="reply-icon"><Bot size={15} /></div><span>{agentReply}</span></div>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading"><div><span className="section-kicker">ACTIVITY TRACE</span><h2>Shared context, visible</h2></div><span className="trace-live"><span />LIVE</span></div>
              <div className="activity-list">{events.slice(0, 5).map((event) => <div className="activity-row" key={event.id}><div className={"activity-dot " + event.tone} /><div className="activity-copy"><strong>{event.label}</strong><span>{event.detail}</span></div><time>{timeLabel(event.time)}</time></div>)}</div>
            </section>
          </div>

          {showInspector && <section className="inspector-panel"><div className="inspector-heading"><div><span className="section-kicker">DEVELOPER VIEW</span><h2>What WebMCP receives</h2></div><button className="close-inline" onClick={() => setShowInspector(false)}><X size={16} /></button></div><div className="inspector-body"><div className="code-window"><div className="code-top"><span /><span /><span /><small>runtime.ts</small></div><pre><code><span className="code-purple">await</span> document.modelContext.registerTool({"{"}<br />{"  name: \"" + activeTools[activeTools.length - 1]?.name + "\","}<br />{"  description: \"...exact intent...\","}<br />{"  inputSchema: { /* strict JSON Schema */ },"}<br />{"  execute: async (input) =&gt; ..."}<br />{"});"}</code></pre></div><div className="inspector-facts"><div><span>Registration</span><strong>document.modelContext</strong></div><div><span>Lifecycle</span><strong>AbortController</strong></div><div><span>Current surface</span><strong>{activeTools.length} tools</strong></div><div><span>State</span><strong>Shared + live</strong></div></div></div></section>}

          <footer className="page-footer"><span><Code2 size={14} />Built for The WebMCP Challenge</span><a href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noreferrer">Read the WebMCP docs <ArrowUpRight size={13} /></a><span className="footer-note">A tool surface should earn its complexity.</span></footer>
        </div>
      </section>

      {studioOpen && <ToolStudio editingTool={editingTool} onClose={() => { setStudioOpen(false); setEditingTool(null); }} onSave={async (payload) => { await perform("design_tool", { operation: editingTool ? "update" : "create", ...(editingTool ? { name: editingTool.name } : {}), ...payload }); setStudioOpen(false); setEditingTool(null); }} />}
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </main>
  );
}

interface ToolStudioProps {
  editingTool: CustomTool | null;
  onClose: () => void;
  onSave: (payload: { name: string; title: string; description: string; inputLabel: string; action: CustomAction }) => Promise<void>;
}

function ToolStudio({ editingTool, onClose, onSave }: ToolStudioProps) {
  const [name, setName] = useState(editingTool?.name ?? "capture_decision");
  const [title, setTitle] = useState(editingTool?.title ?? "Capture a decision");
  const [description, setDescription] = useState(editingTool?.description ?? "Save a short decision to the shared workspace when the team reaches clarity.");
  const [inputLabel, setInputLabel] = useState(editingTool?.inputLabel ?? "The decision to capture");
  const [action, setAction] = useState<CustomAction>(editingTool?.action ?? "add_note");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({ name: makeToolName(name), title: title.trim(), description: description.trim(), inputLabel: inputLabel.trim(), action });
  };

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Tool studio"><div className="studio-modal"><div className="studio-top"><div><span className="section-kicker">TOOL STUDIO / {editingTool ? "EDIT" : "CREATE"}</span><h2>{editingTool ? "Refine a capability" : "Design a capability"}</h2><p>One clear input. One safe action. A capability your workflow can understand.</p></div><button className="close-button" onClick={onClose} aria-label="Close tool studio"><X size={18} /></button></div><form onSubmit={submit}><div className="form-grid"><label><span>Tool name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="capture_decision" required /><small>Normalized to stable snake_case.</small></label><label><span>Display title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Capture a decision" required /></label></div><label><span>When should an agent use it?</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} required /></label><label><span>Input meaning</span><input value={inputLabel} onChange={(event) => setInputLabel(event.target.value)} required /><small>This becomes the JSON Schema description for <code>input</code>.</small></label><label><span>Safe workspace action</span><select value={action} onChange={(event) => setAction(event.target.value as CustomAction)}>{(Object.keys(actionLabels) as CustomAction[]).map((key) => <option key={key} value={key}>{actionLabels[key]}</option>)}</select><small>{actionDescriptions[action]}</small></label><div className="schema-preview"><div className="schema-preview-head"><span>SCHEMA PREVIEW</span><span>strict · one input</span></div><pre>{"{\n  \"name\": \"" + (makeToolName(name) || "new_capability") + "\",\n  \"inputSchema\": {\n    \"input\": \"" + (inputLabel || "...") + "\"\n  }\n}"}</pre></div><div className="studio-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><WandSparkles size={16} />{editingTool ? "Update capability" : "Add to live surface"}</button></div></form></div></div>;
}

export default App;
