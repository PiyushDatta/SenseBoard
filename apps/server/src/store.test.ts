import { describe, expect, it } from 'bun:test';

import { applyBoardOp, createEmptyBoardState } from '../../shared/board-state';
import { createEmptyRoom } from '../../shared/room-state';
import type { ClientMessage } from '../../shared/types';
import {
  applyClientMessage,
  attachSocket,
  broadcastSnapshot,
  createRoom,
  createSocketData,
  detachSocket,
  getOrCreateRoom,
  getRoom,
} from './store';

interface FakeSocket {
  send: (data: string) => void;
  data: {
    roomId: string;
    memberId: string;
    memberName: string;
  };
}

const makeSocket = (roomId: string, memberId: string, memberName = 'Guest') => {
  const sent: string[] = [];
  const socket: FakeSocket = {
    send: (data: string) => {
      sent.push(data);
    },
    data: {
      roomId,
      memberId,
      memberName,
    },
  };
  return { socket, sent };
};

const parseLast = <T>(messages: string[]): T => {
  const last = messages.at(-1);
  if (!last) {
    throw new Error('Expected at least one message');
  }
  return JSON.parse(last) as T;
};

describe('store', () => {
  it('creates rooms and normalizes room ids for lookup', () => {
    const created = createRoom();
    expect(created.id.length).toBe(6);

    const normalized = getOrCreateRoom('  room-t1  ');
    expect(normalized.id).toBe('ROOM-T1');
    expect(getRoom('room-t1')).toBe(normalized);
    expect(getOrCreateRoom('ROOM-T1')).toBe(normalized);
  });

  it('creates normalized socket data with fallback member name', () => {
    const data = createSocketData(' room-abc ', '   ');
    expect(data.roomId).toBe('ROOM-ABC');
    expect(data.memberName).toBe('Guest');
    expect(data.memberId.length).toBeGreaterThan(0);
  });

  it('attaches socket, tracks membership, and broadcasts snapshots', () => {
    const roomId = 'ROOM-STORE-A';
    const { socket, sent } = makeSocket(roomId, 'm-1', 'Alex');

    attachSocket(socket);
    const room = getRoom(roomId)!;
    expect(room.members.map((member) => member.id)).toEqual(['m-1']);

    const snapshot = parseLast<{ type: string; payload: { members: Array<{ id: string; name: string; joinedAt: number }> } }>(
      sent,
    );
    expect(snapshot.type).toBe('room:snapshot');
    expect(snapshot.payload.members[0]?.id).toBe('m-1');
    expect(snapshot.payload.members[0]?.name).toBe('Alex');
    expect(typeof snapshot.payload.members[0]?.joinedAt).toBe('number');

    attachSocket(socket);
    expect(room.members.length).toBe(1);
  });

  it('detaches socket and removes members with no active sockets', () => {
    const roomId = 'ROOM-STORE-B';
    const one = makeSocket(roomId, 'm-1', 'Alex');
    const two = makeSocket(roomId, 'm-2', 'Sam');

    attachSocket(one.socket);
    attachSocket(two.socket);
    one.sent.length = 0;
    two.sent.length = 0;

    detachSocket(one.socket);
    const room = getRoom(roomId)!;
    expect(room.members.map((member) => member.id)).toEqual(['m-2']);

    expect(one.sent.length).toBe(0);
    const snapshot = parseLast<{ payload: { members: Array<{ id: string }> } }>(two.sent);
    expect(snapshot.payload.members.map((member) => member.id)).toEqual(['m-2']);
  });

  it('ignores empty chat messages and caps chat history at 300', () => {
    const room = createEmptyRoom('ROOM-STORE-C');
    const sender = { roomId: room.id, memberId: 'm-chat', memberName: 'Alex' };

    applyClientMessage(room, sender, {
      type: 'chat:add',
      payload: {
        text: '    ',
        kind: 'normal',
      },
    });
    expect(room.chatMessages.length).toBe(0);

    for (let index = 0; index < 305; index += 1) {
      applyClientMessage(room, sender, {
        type: 'chat:add',
        payload: {
          text: `Message ${index}`,
          kind: 'normal',
        },
      });
    }

    expect(room.chatMessages.length).toBe(300);
    expect(room.chatMessages[0]?.text).toBe('Message 5');
    expect(room.chatMessages.at(-1)?.text).toBe('Message 304');
  });

  it('adds context with fallback title and caps context list at 200', () => {
    const room = createEmptyRoom('ROOM-STORE-D');
    const sender = { roomId: room.id, memberId: 'm-context', memberName: 'Alex' };

    applyClientMessage(room, sender, {
      type: 'context:add',
      payload: {
        title: '   ',
        content: 'A',
        priority: 'normal',
        scope: 'topic',
        pinned: false,
      },
    });
    expect(room.contextItems[0]?.title).toBe('Untitled context');

    for (let index = 0; index < 205; index += 1) {
      applyClientMessage(room, sender, {
        type: 'context:add',
        payload: {
          title: `T${index}`,
          content: `C${index}`,
          priority: 'normal',
          scope: 'topic',
          pinned: false,
        },
      });
    }

    expect(room.contextItems.length).toBe(200);
    expect(room.contextItems[0]?.title).toBe('T5');
    expect(room.contextItems.at(-1)?.title).toBe('T204');
  });

  it('updates and deletes context items', () => {
    const room = createEmptyRoom('ROOM-STORE-E');
    const sender = { roomId: room.id, memberId: 'm-context-2', memberName: 'Sam' };

    applyClientMessage(room, sender, {
      type: 'context:add',
      payload: {
        title: 'Before',
        content: 'Draft',
        priority: 'normal',
        scope: 'topic',
        pinned: false,
      },
    });
    const id = room.contextItems[0]!.id;
    const before = room.contextItems[0]!.updatedAt;

    applyClientMessage(room, sender, {
      type: 'context:update',
      payload: {
        id,
        title: 'After',
        content: 'Published',
        priority: 'high',
        scope: 'global',
        pinned: true,
      },
    });

    expect(room.contextItems[0]).toMatchObject({
      id,
      title: 'After',
      content: 'Published',
      priority: 'high',
      scope: 'global',
      pinned: true,
    });
    expect(room.contextItems[0]!.updatedAt).toBeGreaterThanOrEqual(before);

    applyClientMessage(room, sender, {
      type: 'context:delete',
      payload: { id },
    });
    expect(room.contextItems.length).toBe(0);
  });

  it('handles transcript and visual hint updates', () => {
    const room = createEmptyRoom('ROOM-STORE-F');
    const sender = { roomId: room.id, memberId: 'm-transcript', memberName: 'Host' };

    applyClientMessage(room, sender, {
      type: 'transcript:add',
      payload: {
        text: '  testing one two  ',
        source: 'manual',
      },
    });
    expect(room.transcriptChunks[0]?.text).toBe('testing one two');
    expect(room.aiConfig.status).toBe('listening');

    room.aiConfig.frozen = true;
    applyClientMessage(room, sender, {
      type: 'transcript:add',
      payload: {
        text: 'still tracking',
        source: 'mic',
      },
    });
    expect(room.aiConfig.status).toBe('frozen');

    applyClientMessage(room, sender, {
      type: 'visualHint:set',
      payload: {
        value: '  section 2.1  ',
      },
    });
    expect(room.visualHint).toBe('section 2.1');
  });

  it('updates AI config and clears focus box when focus mode disabled', () => {
    const room = createEmptyRoom('ROOM-STORE-G');
    const sender = { roomId: room.id, memberId: 'm-ai', memberName: 'Host' };

    applyClientMessage(room, sender, {
      type: 'aiConfig:update',
      payload: {
        focusBox: { x: 1, y: 2, w: 3, h: 4 },
      },
    });
    expect(room.aiConfig.focusMode).toBe(true);
    expect(room.aiConfig.focusBox).toEqual({ x: 1, y: 2, w: 3, h: 4 });

    applyClientMessage(room, sender, {
      type: 'aiConfig:update',
      payload: {
        focusMode: false,
      },
    });
    expect(room.aiConfig.focusMode).toBe(false);
    expect(room.aiConfig.focusBox).toBeNull();

    applyClientMessage(room, sender, {
      type: 'aiConfig:update',
      payload: {
        frozen: true,
      },
    });
    expect(room.aiConfig.frozen).toBe(true);
    expect(room.aiConfig.status).toBe('frozen');
  });

  it('dispatches diagram control messages', () => {
    const room = createEmptyRoom('ROOM-STORE-H');
    const sender = { roomId: room.id, memberId: 'm-diagram', memberName: 'Host' };
    const firstGroupId = room.activeGroupId;

    room.board = applyBoardOp(createEmptyBoardState(), {
      type: 'upsertElement',
      element: {
        id: 'tmp-shape',
        kind: 'rect',
        x: 10,
        y: 10,
        w: 20,
        h: 20,
        createdAt: Date.now(),
        createdBy: 'system',
      },
    });
    expect(Object.keys(room.board.elements)).toEqual(['tmp-shape']);

    applyClientMessage(room, sender, {
      type: 'diagram:pinCurrent',
      payload: {},
    } satisfies ClientMessage);
    expect(room.activeGroupId).not.toBe(firstGroupId);
    expect(room.aiConfig.pinnedGroupIds).toContain(firstGroupId);

    applyClientMessage(room, sender, {
      type: 'diagram:clearBoard',
      payload: {},
    });
    expect(Object.keys(room.board.elements).length).toBe(0);

    applyClientMessage(room, sender, { type: 'diagram:undoAi', payload: {} });
    applyClientMessage(room, sender, { type: 'diagram:restoreArchived', payload: {} });
  });

  it('broadcastSnapshot safely no-ops for missing rooms', () => {
    expect(() => broadcastSnapshot('ROOM-DOES-NOT-EXIST')).not.toThrow();
  });
});
