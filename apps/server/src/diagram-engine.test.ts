import { describe, expect, it } from 'bun:test';

import { createEmptyRoom } from '../../shared/room-state';
import type { DiagramPatch } from '../../shared/types';
import { applyDiagramPatch, restoreLatestArchivedDiagram } from './diagram-engine';

const treePatch: DiagramPatch = {
  topic: 'Tree traversal',
  diagramType: 'tree',
  confidence: 0.9,
  actions: [
    { op: 'upsertNode', id: 'A', label: 'A', x: 100, y: 80 },
    { op: 'upsertNode', id: 'B', label: 'B', x: 280, y: 220 },
    { op: 'upsertEdge', id: 'e1', from: 'A', to: 'B', label: 'left' },
    { op: 'setTitle', text: 'Tree traversal' },
    { op: 'setNotes', lines: ['Discussing DFS'] },
  ],
  openQuestions: [],
  conflicts: [],
};

const systemPatch: DiagramPatch = {
  topic: 'System architecture',
  diagramType: 'system_blocks',
  confidence: 0.85,
  actions: [
    { op: 'upsertNode', id: 'client', label: 'Client', x: 80, y: 180 },
    { op: 'upsertNode', id: 'api', label: 'API', x: 300, y: 180 },
    { op: 'upsertEdge', id: 'e2', from: 'client', to: 'api', label: 'request' },
    { op: 'setTitle', text: 'System architecture' },
    { op: 'setNotes', lines: ['Current discussion focus'] },
  ],
  openQuestions: [],
  conflicts: [],
};

describe('diagram engine', () => {
  it('archives and clears when topic shifts to a different diagram type', () => {
    const room = createEmptyRoom('ROOMD1');
    const appliedInitial = applyDiagramPatch(room, treePatch);
    expect(appliedInitial).toBe(true);
    expect(Object.keys(room.diagramGroups[room.activeGroupId]!.nodes).length).toBe(2);

    const appliedShift = applyDiagramPatch(room, systemPatch);
    expect(appliedShift).toBe(true);
    expect(room.archivedGroups.length).toBe(1);

    const active = room.diagramGroups[room.activeGroupId]!;
    expect(active.diagramType).toBe('system_blocks');
    expect(active.topic).toBe('System architecture');
    expect(Object.keys(active.nodes)).toEqual(['client', 'api']);
  });

  it('restores latest archived diagram as a pinned restored group', () => {
    const room = createEmptyRoom('ROOMD2');
    applyDiagramPatch(room, treePatch);
    applyDiagramPatch(room, systemPatch);
    const beforeGroupCount = Object.keys(room.diagramGroups).length;
    expect(room.archivedGroups.length).toBe(1);

    const restored = restoreLatestArchivedDiagram(room);
    expect(restored).toBe(true);
    expect(room.archivedGroups.length).toBe(0);
    expect(Object.keys(room.diagramGroups).length).toBe(beforeGroupCount + 1);

    const active = room.diagramGroups[room.activeGroupId]!;
    expect(active.pinned).toBe(true);
    expect(active.title.startsWith('[Restored]')).toBe(true);
    expect(active.diagramType).toBe('tree');
  });
});

