import { customAlphabet } from 'nanoid';
import { createEmptyBoardState } from './board-state';

import type {
  DiagramGroup,
  DiagramType,
  FocusBox,
  RoomState,
  RoomSummary,
} from './types';

const roomIdAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export const newId = () => crypto.randomUUID();

export const newRoomId = () => roomIdAlphabet();

export const DEFAULT_GROUP_BOUNDS: FocusBox = {
  x: 120,
  y: 120,
  w: 760,
  h: 520,
};

export const createDiagramGroup = (
  id: string,
  topic = 'Untitled discussion',
  diagramType: DiagramType = 'flowchart',
  bounds: FocusBox = DEFAULT_GROUP_BOUNDS,
): DiagramGroup => {
  const now = Date.now();
  return {
    id,
    topic,
    diagramType,
    title: topic,
    notes: [],
    nodes: {},
    edges: {},
    highlightOrder: [],
    pinned: false,
    bounds,
    createdAt: now,
    updatedAt: now,
  };
};

export const createEmptyRoom = (roomId: string): RoomState => {
  const now = Date.now();
  const firstGroup = createDiagramGroup(newId(), 'Live Discussion', 'flowchart');
  return {
    id: roomId,
    createdAt: now,
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
    diagramGroups: {
      [firstGroup.id]: firstGroup,
    },
    activeGroupId: firstGroup.id,
    archivedGroups: [],
    aiHistory: [],
    lastAiPatchAt: 0,
    lastAiFingerprint: '',
    board: createEmptyBoardState(),
  };
};

export const toRoomSummary = (room: RoomState): RoomSummary => {
  return {
    roomId: room.id,
    activeMembers: room.members.length,
    transcriptCount: room.transcriptChunks.length,
    contextCount: room.contextItems.length,
    diagramGroupCount: Object.keys(room.diagramGroups).length,
  };
};

export const limitList = <T>(list: T[], limit: number): T[] => {
  if (list.length <= limit) {
    return list;
  }
  return list.slice(list.length - limit);
};
