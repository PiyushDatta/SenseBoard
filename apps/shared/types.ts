export type NoteKind = 'normal' | 'correction' | 'suggestion';

export type ContextPriority = 'normal' | 'high';

export type ContextScope = 'global' | 'topic';

export type DiagramType = 'flowchart' | 'system_blocks' | 'tree';

export type BoardElementKind =
  | 'stroke'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'sticky'
  | 'frame'
  | 'arrow'
  | 'line'
  | 'text';

export interface BoardElementStyle {
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  roughness?: number;
  fontSize?: number;
}

interface BoardElementBase {
  id: string;
  kind: BoardElementKind;
  style?: BoardElementStyle;
  zIndex?: number;
  createdAt: number;
  createdBy: 'ai' | 'system';
}

export type BoardPoint = [number, number];

export interface BoardStrokeElement extends BoardElementBase {
  kind: 'stroke';
  points: BoardPoint[];
}

export interface BoardRectElement extends BoardElementBase {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardEllipseElement extends BoardElementBase {
  kind: 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardDiamondElement extends BoardElementBase {
  kind: 'diamond';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardTriangleElement extends BoardElementBase {
  kind: 'triangle';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardStickyElement extends BoardElementBase {
  kind: 'sticky';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface BoardFrameElement extends BoardElementBase {
  kind: 'frame';
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
}

export interface BoardArrowElement extends BoardElementBase {
  kind: 'arrow';
  points: BoardPoint[];
}

export interface BoardLineElement extends BoardElementBase {
  kind: 'line';
  points: BoardPoint[];
}

export interface BoardTextElement extends BoardElementBase {
  kind: 'text';
  x: number;
  y: number;
  text: string;
}

export type BoardElement =
  | BoardStrokeElement
  | BoardRectElement
  | BoardEllipseElement
  | BoardDiamondElement
  | BoardTriangleElement
  | BoardStickyElement
  | BoardFrameElement
  | BoardArrowElement
  | BoardLineElement
  | BoardTextElement;

export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardState {
  elements: Record<string, BoardElement>;
  order: string[];
  revision: number;
  lastUpdatedAt: number;
  viewport: BoardViewport;
}

export type BoardOp =
  | { type: 'upsertElement'; element: BoardElement }
  | { type: 'appendStrokePoints'; id: string; points: BoardPoint[] }
  | { type: 'deleteElement'; id: string }
  | { type: 'offsetElement'; id: string; dx: number; dy: number }
  | { type: 'setElementGeometry'; id: string; x?: number; y?: number; w?: number; h?: number; points?: BoardPoint[] }
  | { type: 'setElementStyle'; id: string; style: Partial<BoardElementStyle> }
  | { type: 'setElementText'; id: string; text: string }
  | { type: 'duplicateElement'; id: string; newId: string; dx?: number; dy?: number }
  | { type: 'setElementZIndex'; id: string; zIndex: number }
  | {
      type: 'alignElements';
      ids: string[];
      axis: 'left' | 'center' | 'right' | 'x' | 'top' | 'middle' | 'bottom' | 'y';
    }
  | {
      type: 'distributeElements';
      ids: string[];
      axis: 'horizontal' | 'vertical' | 'x' | 'y';
      gap?: number;
    }
  | { type: 'clearBoard' }
  | { type: 'setViewport'; viewport: Partial<BoardViewport> }
  | { type: 'batch'; ops: BoardOp[] };

export interface FocusBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Member {
  id: string;
  name: string;
  joinedAt: number;
}

export interface TranscriptChunk {
  id: string;
  speaker: string;
  text: string;
  source: 'mic' | 'manual';
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  kind: NoteKind;
  createdAt: number;
}

export interface ContextItem {
  id: string;
  authorName: string;
  title: string;
  content: string;
  priority: ContextPriority;
  scope: ContextScope;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface DiagramGroup {
  id: string;
  topic: string;
  diagramType: DiagramType;
  title: string;
  notes: string[];
  nodes: Record<string, DiagramNode>;
  edges: Record<string, DiagramEdge>;
  highlightOrder: string[];
  pinned: boolean;
  bounds: FocusBox;
  createdAt: number;
  updatedAt: number;
}

export interface ArchivedDiagram {
  id: string;
  archivedAt: number;
  reason: string;
  group: DiagramGroup;
}

export interface AIConfig {
  frozen: boolean;
  focusMode: boolean;
  focusBox: FocusBox | null;
  pinnedGroupIds: string[];
  status: 'idle' | 'listening' | 'updating' | 'frozen';
}

export interface AIPatchHistoryEntry {
  id: string;
  createdAt: number;
  patch: DiagramPatch;
  previousGroupSnapshot: DiagramGroup;
}

export interface RoomState {
  id: string;
  createdAt: number;
  members: Member[];
  transcriptChunks: TranscriptChunk[];
  chatMessages: ChatMessage[];
  contextItems: ContextItem[];
  visualHint: string;
  aiConfig: AIConfig;
  diagramGroups: Record<string, DiagramGroup>;
  activeGroupId: string;
  archivedGroups: ArchivedDiagram[];
  aiHistory: AIPatchHistoryEntry[];
  lastAiPatchAt: number;
  lastAiFingerprint: string;
  board: BoardState;
}

export type DiagramPatchAction =
  | {
      op: 'upsertNode';
      id: string;
      label: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }
  | {
      op: 'upsertEdge';
      id: string;
      from: string;
      to: string;
      label?: string;
    }
  | {
      op: 'deleteShape';
      id: string;
    }
  | {
      op: 'setTitle';
      text: string;
    }
  | {
      op: 'setNotes';
      lines: string[];
    }
  | {
      op: 'highlightOrder';
      nodes: string[];
    }
  | {
      op: 'layoutHint';
      value: 'tree' | 'left-to-right' | 'top-down';
    };

export interface DiagramPatchConflict {
  type: 'correction' | 'context' | 'topic';
  detail: string;
}

export interface DiagramPatch {
  topic: string;
  diagramType: DiagramType;
  confidence: number;
  actions: DiagramPatchAction[];
  openQuestions: string[];
  conflicts: DiagramPatchConflict[];
  targetGroupId?: string;
}

export type ClientMessage =
  | {
      type: 'client:ack';
      payload: {
        protocol: 'senseboard-ws-v1';
        sentAt: number;
      };
    }
  | {
      type: 'chat:add';
      payload: {
        text: string;
        kind: NoteKind;
      };
    }
  | {
      type: 'context:add';
      payload: {
        title: string;
        content: string;
        priority: ContextPriority;
        scope: ContextScope;
        pinned: boolean;
      };
    }
  | {
      type: 'context:update';
      payload: {
        id: string;
        title?: string;
        content?: string;
        priority?: ContextPriority;
        scope?: ContextScope;
        pinned?: boolean;
      };
    }
  | {
      type: 'context:delete';
      payload: {
        id: string;
      };
    }
  | {
      type: 'transcript:add';
      payload: {
        text: string;
        source: 'mic' | 'manual';
      };
    }
  | {
      type: 'visualHint:set';
      payload: {
        value: string;
      };
    }
  | {
      type: 'aiConfig:update';
      payload: Partial<Pick<AIConfig, 'frozen' | 'focusMode' | 'focusBox' | 'status'>>;
    }
  | {
      type: 'diagram:pinCurrent';
      payload: Record<string, never>;
    }
  | {
      type: 'diagram:undoAi';
      payload: Record<string, never>;
    }
  | {
      type: 'diagram:restoreArchived';
      payload: Record<string, never>;
    }
  | {
      type: 'diagram:clearBoard';
      payload: Record<string, never>;
    };

export type ServerMessage =
  | {
      type: 'server:ack';
      payload: {
        protocol: 'senseboard-ws-v1';
        roomId: string;
        memberId: string;
        receivedAt: number;
      };
    }
  | {
      type: 'room:snapshot';
      payload: RoomState;
    }
  | {
      type: 'room:error';
      payload: {
        message: string;
      };
    };

export interface TriggerPatchRequest {
  reason: 'tick' | 'correction' | 'context' | 'regenerate' | 'manual';
  regenerate?: boolean;
  windowSeconds?: number;
  transcriptChunkCount?: number;
}
