export type GraphNodeInput = {
  id: string;
  label: string;
  description?: string;
  kind?: string;
};

export type GraphEdgeInput = {
  source: string;
  target: string;
  label?: string;
};

export type LayoutMode = "auto" | "flow" | "tree" | "grid";
export type LayoutEngine = "webgpu" | "cpu";

export type PositionedGraphNode = GraphNodeInput & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Slot = { row: number; column: number };

const GPU_BUFFER_MAP_READ = 0x0001;
const GPU_BUFFER_COPY_DST = 0x0008;
const GPU_BUFFER_COPY_SRC = 0x0004;
const GPU_BUFFER_STORAGE = 0x0080;
const GPU_BUFFER_UNIFORM = 0x0040;

type GpuDevice = {
  createShaderModule: (descriptor: { code: string }) => unknown;
  createBindGroupLayout: (descriptor: { entries: unknown[] }) => unknown;
  createPipelineLayout: (descriptor: { bindGroupLayouts: unknown[] }) => unknown;
  createComputePipeline: (descriptor: { layout: unknown; compute: { module: unknown; entryPoint: string } }) => unknown;
  createBuffer: (descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) => any;
  createBindGroup: (descriptor: { layout: unknown; entries: unknown[] }) => unknown;
  createCommandEncoder: () => any;
  queue: { writeBuffer: (buffer: any, offset: number, data: ArrayBufferView) => void; submit: (commands: unknown[]) => void };
};

type GpuAdapter = { requestDevice: () => Promise<GpuDevice> };

type GpuNavigator = Navigator & {
  gpu?: { requestAdapter: () => Promise<GpuAdapter | null> };
};

function cleanNodes(value: unknown): GraphNodeInput[] {
  if (!Array.isArray(value)) throw new Error("compose_canvas requires a nodes array.");
  if (value.length === 0 || value.length > 128) throw new Error("compose_canvas accepts between 1 and 128 nodes.");
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error("Node " + index + " must be an object.");
    const node = raw as Record<string, unknown>;
    const id = typeof node.id === "string" ? node.id.trim() : "";
    const label = typeof node.label === "string" ? node.label.trim() : "";
    if (!id || !label) throw new Error("Every node needs a non-empty id and label.");
    if (ids.has(id)) throw new Error("Duplicate node id: " + id);
    ids.add(id);
    return {
      id,
      label: label.slice(0, 180),
      ...(typeof node.description === "string" && node.description.trim()
        ? { description: node.description.trim().slice(0, 220) }
        : {}),
      ...(typeof node.kind === "string" && node.kind.trim() ? { kind: node.kind.trim().slice(0, 48) } : {}),
    };
  });
}

function cleanEdges(value: unknown, nodeIds: Set<string>): GraphEdgeInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("compose_canvas edges must be an array.");
  if (value.length > 256) throw new Error("compose_canvas accepts at most 256 edges.");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error("Edge " + index + " must be an object.");
    const edge = raw as Record<string, unknown>;
    const source = typeof edge.source === "string" ? edge.source.trim() : "";
    const target = typeof edge.target === "string" ? edge.target.trim() : "";
    if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error("Edge " + index + " points to an unknown node.");
    return {
      source,
      target,
      ...(typeof edge.label === "string" && edge.label.trim() ? { label: edge.label.trim().slice(0, 120) } : {}),
    };
  });
}

function levelsFor(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): Map<string, number> {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const levels = new Map(nodes.map((node) => [node.id, 0]));
  let visited = 0;
  while (queue.length) {
    const id = queue.shift() as string;
    visited += 1;
    const nextLevel = (levels.get(id) || 0) + 1;
    outgoing.get(id)?.forEach((target) => {
      levels.set(target, Math.max(levels.get(target) || 0, nextLevel));
      const nextDegree = (indegree.get(target) || 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) queue.push(target);
    });
  }
  if (visited !== nodes.length) return new Map(nodes.map((node, index) => [node.id, index]));
  return levels;
}

function slotsFor(nodes: GraphNodeInput[], edges: GraphEdgeInput[], mode: LayoutMode): { slots: Slot[]; columns: number } {
  const columns = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(nodes.length * 1.45))));
  if (mode === "tree" || mode === "flow") {
    const levels = levelsFor(nodes, edges);
    const rows = new Map<number, number>();
    return {
      columns,
      slots: nodes.map((node) => {
        const level = levels.get(node.id) || 0;
        const position = rows.get(level) || 0;
        rows.set(level, position + 1);
        return mode === "flow"
          ? { row: position, column: level }
          : { row: level, column: position };
      }),
    };
  }
  return {
    columns,
    slots: nodes.map((_, index) => {
      const row = Math.floor(index / columns);
      const columnInRow = index % columns;
      return { row, column: row % 2 === 0 ? columnInRow : columns - 1 - columnInRow };
    }),
  };
}

function cpuPositions(slots: Slot[], width: number, height: number, gapX: number, gapY: number): Array<{ x: number; y: number }> {
  return slots.map((slot) => ({
    x: slot.column * (width + gapX),
    y: slot.row * (height + gapY),
  }));
}

async function gpuPositions(
  slots: Slot[],
  width: number,
  height: number,
  gapX: number,
  gapY: number,
): Promise<Array<{ x: number; y: number }>> {
  const gpu = (navigator as GpuNavigator).gpu;
  if (!gpu) throw new Error("WebGPU is not available.");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter is available.");
  const device = await adapter.requestDevice();
  const shader = device.createShaderModule({
    code: `
      struct Params { stride: vec4<f32> };
      @group(0) @binding(0) var<storage, read> slots: array<vec2<u32>>;
      @group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
      @group(0) @binding(2) var<uniform> params: Params;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let index = id.x;
        if (index >= arrayLength(&slots)) { return; }
        let slot = slots[index];
        positions[index] = vec4<f32>(f32(slot.x) * params.stride.x, f32(slot.y) * params.stride.y, 0.0, 0.0);
      }
    `,
  });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: 4, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: 4, buffer: { type: "storage" } },
      { binding: 2, visibility: 4, buffer: { type: "uniform" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: shader, entryPoint: "main" },
  });
  const slotData = new Uint32Array(slots.flatMap((slot) => [slot.column, slot.row]));
  const slotBuffer = device.createBuffer({ size: Math.max(8, slotData.byteLength), usage: GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST });
  const outputBuffer = device.createBuffer({ size: Math.max(16, slots.length * 16), usage: GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_SRC });
  const paramsBuffer = device.createBuffer({ size: 16, usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST });
  const readBuffer = device.createBuffer({ size: Math.max(16, slots.length * 16), usage: GPU_BUFFER_MAP_READ | GPU_BUFFER_COPY_DST });
  device.queue.writeBuffer(slotBuffer, 0, slotData);
  device.queue.writeBuffer(paramsBuffer, 0, new Float32Array([width + gapX, height + gapY, 0, 0]));
  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: slotBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(slots.length / 64));
  pass.end();
  encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, Math.max(16, slots.length * 16));
  device.queue.submit([encoder.finish()]);
  await readBuffer.mapAsync(GPU_BUFFER_MAP_READ);
  const output = new Float32Array(readBuffer.getMappedRange().slice(0));
  readBuffer.unmap();
  return slots.map((_, index) => ({ x: output[index * 4], y: output[index * 4 + 1] }));
}

export async function computeGraphLayout(input: {
  nodes: unknown;
  edges?: unknown;
  mode?: LayoutMode;
  x?: number;
  y?: number;
}): Promise<{ nodes: PositionedGraphNode[]; edges: GraphEdgeInput[]; engine: LayoutEngine }> {
  const nodes = cleanNodes(input.nodes);
  const edges = cleanEdges(input.edges, new Set(nodes.map((node) => node.id)));
  const mode = input.mode || "auto";
  const layoutMode = mode === "auto" ? (edges.length ? "flow" : "grid") : mode;
  const { slots } = slotsFor(nodes, edges, layoutMode);
  const width = 210;
  const gapX = 42;
  const gapY = 64;
  const positions = cpuPositions(slots, width, 104, gapX, gapY);
  let engine: LayoutEngine = "cpu";
  try {
    const gpuResult = await gpuPositions(slots, width, 104, gapX, gapY);
    positions.splice(0, positions.length, ...gpuResult);
    engine = "webgpu";
  } catch {
    // CPU layout is the portable path for browsers without WebGPU or an adapter.
  }
  const originX = Number.isFinite(input.x) ? Number(input.x) : 72;
  const originY = Number.isFinite(input.y) ? Number(input.y) : 112;
  return {
    nodes: nodes.map((node, index) => ({
      ...node,
      x: originX + positions[index].x,
      y: originY + positions[index].y,
      width,
      height: node.description ? 104 : 88,
    })),
    edges,
    engine,
  };
}
