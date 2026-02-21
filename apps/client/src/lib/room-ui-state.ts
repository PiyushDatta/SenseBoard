import { createEmptyBoardState } from '../../../shared/board-state';
import type { ContextPriority, ContextScope, RoomState } from '../../../shared/types';

export interface ContextDraft {
  title: string;
  content: string;
  priority: ContextPriority;
  scope: ContextScope;
  pinned: boolean;
}

export const createInitialContextDraft = (): ContextDraft => ({
  title: '',
  content: '',
  priority: 'normal',
  scope: 'topic',
  pinned: true,
});

export const createEmptyRoomFallback = (roomId: string): RoomState => ({
  id: roomId,
  createdAt: Date.now(),
  members: [],
  transcriptChunks: [],
  chatMessages: [],
  contextItems: [],
  visualHint: '',
  aiConfig: {
    frozen: false,
    focusMode: false,
    focusBox: null,
    pinnedGroupIds: [],
    status: 'idle',
  },
  diagramGroups: {},
  activeGroupId: '',
  archivedGroups: [],
  aiHistory: [],
  lastAiPatchAt: 0,
  lastAiFingerprint: '',
  board: createEmptyBoardState(),
});
