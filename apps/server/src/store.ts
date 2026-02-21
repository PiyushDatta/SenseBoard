import { createEmptyRoom, newId, newRoomId } from '../../shared/room-state';
import type { ClientMessage, RoomState, ServerMessage } from '../../shared/types';
import { pinCurrentDiagram, restoreLatestArchivedDiagram, undoAiPatch } from './diagram-engine';

interface SocketWithData {
  send: (data: string) => void;
  data: {
    roomId: string;
    memberId: string;
    memberName: string;
  };
}

const MAX_TRANSCRIPT_CHUNKS = 400;
const MAX_CHAT_MESSAGES = 300;
const MAX_CONTEXT_ITEMS = 200;

const rooms = new Map<string, RoomState>();
const socketsByRoom = new Map<string, Set<SocketWithData>>();

const getSockets = (roomId: string): Set<SocketWithData> => {
  const existing = socketsByRoom.get(roomId);
  if (existing) {
    return existing;
  }
  const fresh = new Set<SocketWithData>();
  socketsByRoom.set(roomId, fresh);
  return fresh;
};

export const createRoom = (): RoomState => {
  const room = createEmptyRoom(newRoomId());
  rooms.set(room.id, room);
  return room;
};

export const getOrCreateRoom = (roomId: string): RoomState => {
  const normalized = roomId.trim().toUpperCase();
  const existing = rooms.get(normalized);
  if (existing) {
    return existing;
  }
  const room = createEmptyRoom(normalized);
  rooms.set(normalized, room);
  return room;
};

export const getRoom = (roomId: string): RoomState | undefined => {
  return rooms.get(roomId.trim().toUpperCase());
};

const broadcast = (roomId: string, message: ServerMessage) => {
  const payload = JSON.stringify(message);
  for (const socket of getSockets(roomId)) {
    socket.send(payload);
  }
};

export const broadcastSnapshot = (roomId: string) => {
  const room = getRoom(roomId);
  if (!room) {
    return;
  }
  broadcast(roomId, {
    type: 'room:snapshot',
    payload: room,
  });
};

export const attachSocket = (socket: SocketWithData) => {
  const room = getOrCreateRoom(socket.data.roomId);
  getSockets(room.id).add(socket);
  const exists = room.members.find((member) => member.id === socket.data.memberId);
  if (!exists) {
    room.members.push({
      id: socket.data.memberId,
      name: socket.data.memberName,
      joinedAt: Date.now(),
    });
  }
  broadcastSnapshot(room.id);
};

export const detachSocket = (socket: SocketWithData) => {
  const roomId = socket.data.roomId;
  getSockets(roomId).delete(socket);
  const room = getRoom(roomId);
  if (!room) {
    return;
  }
  const socketMembers = new Set(Array.from(getSockets(roomId)).map((item) => item.data.memberId));
  room.members = room.members.filter((member) => socketMembers.has(member.id));
  broadcastSnapshot(room.id);
};

export const createSocketData = (roomId: string, memberName: string) => {
  return {
    roomId: roomId.trim().toUpperCase(),
    memberId: newId(),
    memberName: memberName.trim() || 'Guest',
  };
};

export const applyClientMessage = (room: RoomState, sender: SocketWithData['data'], message: ClientMessage) => {
  const now = Date.now();
  if (message.type === 'chat:add') {
    if (!message.payload.text.trim()) {
      return;
    }
    room.chatMessages.push({
      id: newId(),
      authorId: sender.memberId,
      authorName: sender.memberName,
      text: message.payload.text.trim(),
      kind: message.payload.kind,
      createdAt: now,
    });
    if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
      room.chatMessages = room.chatMessages.slice(room.chatMessages.length - MAX_CHAT_MESSAGES);
    }
    return;
  }

  if (message.type === 'context:add') {
    room.contextItems.push({
      id: newId(),
      authorName: sender.memberName,
      title: message.payload.title.trim() || 'Untitled context',
      content: message.payload.content.trim(),
      priority: message.payload.priority,
      scope: message.payload.scope,
      pinned: message.payload.pinned,
      createdAt: now,
      updatedAt: now,
    });
    if (room.contextItems.length > MAX_CONTEXT_ITEMS) {
      room.contextItems = room.contextItems.slice(room.contextItems.length - MAX_CONTEXT_ITEMS);
    }
    return;
  }

  if (message.type === 'context:update') {
    const item = room.contextItems.find((candidate) => candidate.id === message.payload.id);
    if (!item) {
      return;
    }
    if (typeof message.payload.title === 'string') {
      item.title = message.payload.title;
    }
    if (typeof message.payload.content === 'string') {
      item.content = message.payload.content;
    }
    if (message.payload.priority) {
      item.priority = message.payload.priority;
    }
    if (message.payload.scope) {
      item.scope = message.payload.scope;
    }
    if (typeof message.payload.pinned === 'boolean') {
      item.pinned = message.payload.pinned;
    }
    item.updatedAt = now;
    return;
  }

  if (message.type === 'context:delete') {
    room.contextItems = room.contextItems.filter((item) => item.id !== message.payload.id);
    return;
  }

  if (message.type === 'transcript:add') {
    if (!message.payload.text.trim()) {
      return;
    }
    room.transcriptChunks.push({
      id: newId(),
      speaker: sender.memberName,
      text: message.payload.text.trim(),
      source: message.payload.source,
      createdAt: now,
    });
    if (room.transcriptChunks.length > MAX_TRANSCRIPT_CHUNKS) {
      room.transcriptChunks = room.transcriptChunks.slice(room.transcriptChunks.length - MAX_TRANSCRIPT_CHUNKS);
    }
    room.aiConfig.status = room.aiConfig.frozen ? 'frozen' : 'listening';
    return;
  }

  if (message.type === 'visualHint:set') {
    room.visualHint = message.payload.value.trim();
    return;
  }

  if (message.type === 'aiConfig:update') {
    if (typeof message.payload.frozen === 'boolean') {
      room.aiConfig.frozen = message.payload.frozen;
      room.aiConfig.status = message.payload.frozen ? 'frozen' : 'idle';
    }
    if (typeof message.payload.focusMode === 'boolean') {
      room.aiConfig.focusMode = message.payload.focusMode;
      if (!message.payload.focusMode) {
        room.aiConfig.focusBox = null;
      }
    }
    if (message.payload.focusBox) {
      room.aiConfig.focusBox = message.payload.focusBox;
      room.aiConfig.focusMode = true;
    }
    if (message.payload.status) {
      room.aiConfig.status = message.payload.status;
    }
    return;
  }

  if (message.type === 'diagram:pinCurrent') {
    pinCurrentDiagram(room);
    return;
  }

  if (message.type === 'diagram:undoAi') {
    undoAiPatch(room);
    return;
  }

  if (message.type === 'diagram:restoreArchived') {
    restoreLatestArchivedDiagram(room);
  }
};
