export type NoteKind = 'normal' | 'correction' | 'suggestion';

export type ContextPriority = 'normal' | 'high';

export type ContextScope = 'global' | 'topic';

export type DiagramType = 'flowchart' | 'system_blocks' | 'tree';

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

export interface RoomSummary {
  roomId: string;
  activeMembers: number;
  transcriptCount: number;
  contextCount: number;
  diagramGroupCount: number;
}

export type ClientMessage =
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
    };

export type ServerMessage =
  | {
      type: 'room:snapshot';
      payload: RoomState;
    }
  | {
      type: 'room:summary';
      payload: RoomSummary;
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
}
