import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { createEmptyRoom } from '../../shared/room-state';
import { collectAiInput, createSystemPromptPayloadPreview, generateDiagramPatch, hasAiSignal } from './ai-engine';

describe('AI engine', () => {
  const previousProvider = process.env.AI_PROVIDER;

  beforeAll(() => {
    process.env.AI_PROVIDER = 'deterministic';
  });

  afterAll(() => {
    if (previousProvider) {
      process.env.AI_PROVIDER = previousProvider;
      return;
    }
    delete process.env.AI_PROVIDER;
  });

  it('creates a tree patch from traversal discussion', async () => {
    const room = createEmptyRoom('ROOM01');
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'We have a tree with root A, children B and C. B has D and E. We will do DFS pre-order.',
    });

    const { patch } = await generateDiagramPatch(room, { reason: 'manual' });
    expect(patch.diagramType).toBe('tree');
    expect(patch.actions.some((action) => action.op === 'highlightOrder')).toBe(true);
  });

  it('respects typed correction for traversal', async () => {
    const room = createEmptyRoom('ROOM02');
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'Tree with root A and children B and C. DFS pre-order.',
    });
    room.chatMessages.push({
      id: 'm1',
      authorId: 'u1',
      authorName: 'Alex',
      kind: 'correction',
      createdAt: Date.now(),
      text: 'Actually post-order.',
    });

    const { patch } = await generateDiagramPatch(room, { reason: 'correction' });
    const highlight = patch.actions.find((action) => action.op === 'highlightOrder');
    expect(highlight && highlight.op === 'highlightOrder' && highlight.nodes.at(-1)).toBe('A');
  });

  it('creates a system blocks patch for architecture chains', async () => {
    const room = createEmptyRoom('ROOM03');
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'Architecture: Client -> API Gateway -> Service -> Postgres. Add Redis cache.',
    });

    const { patch } = await generateDiagramPatch(room, { reason: 'manual' });
    expect(patch.diagramType).toBe('system_blocks');
    expect(patch.actions.filter((action) => action.op === 'upsertNode').length).toBeGreaterThan(2);
  });

  it('lets correction with "Context update:" override high-priority context lock', async () => {
    const room = createEmptyRoom('ROOM04');
    room.contextItems.push({
      id: 'c1',
      authorName: 'Host',
      title: 'Constraint',
      content: 'System architecture only. Keep system blocks.',
      priority: 'high',
      scope: 'global',
      pinned: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'Now discussing DFS tree traversal and post-order.',
    });
    room.chatMessages.push({
      id: 'm1',
      authorId: 'u1',
      authorName: 'Alex',
      kind: 'correction',
      createdAt: Date.now(),
      text: 'Context update: switch topic to tree traversal.',
    });

    const { patch } = await generateDiagramPatch(room, { reason: 'correction' });
    expect(patch.diagramType).toBe('tree');
  });

  it('deletes stale nodes from the active group when deterministic patch changes shape set', async () => {
    const room = createEmptyRoom('ROOM05');
    const active = room.diagramGroups[room.activeGroupId]!;
    active.nodes = {
      legacy: {
        id: 'legacy',
        label: 'Legacy',
        x: 10,
        y: 10,
        width: 160,
        height: 72,
      },
    };
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'We have a tree with root A, children B and C.',
    });

    const { patch } = await generateDiagramPatch(room, { reason: 'manual' });
    expect(patch.actions.some((action) => action.op === 'deleteShape' && action.id === 'legacy')).toBe(true);
  });

  it('reports no AI signal for a fresh room and true after transcript input', () => {
    const room = createEmptyRoom('ROOM06');
    expect(hasAiSignal(room)).toBe(false);
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'Quick discussion starter.',
    });
    expect(hasAiSignal(room)).toBe(true);
  });

  it('filters low-signal transcript chunks while keeping meaningful keywords', () => {
    const room = createEmptyRoom('ROOM06B');
    const now = Date.now();
    room.transcriptChunks.push(
      {
        id: 't1',
        speaker: 'Host',
        source: 'mic',
        createdAt: now - 2000,
        text: 'um',
      },
      {
        id: 't2',
        speaker: 'Host',
        source: 'mic',
        createdAt: now - 1500,
        text: 'creepy',
      },
      {
        id: 't3',
        speaker: 'Host',
        source: 'mic',
        createdAt: now - 1000,
        text: 'Actually post-order',
      },
      {
        id: 't4',
        speaker: 'Host',
        source: 'mic',
        createdAt: now - 500,
        text: 'and tree B',
      },
    );

    const input = collectAiInput(room, 30, { reason: 'manual', regenerate: false });
    const joined = input.transcriptWindow.join(' | ').toLowerCase();
    expect(joined.includes('creepy')).toBe(false);
    expect(joined.includes('post-order')).toBe(true);
    expect(joined.includes('tree b')).toBe(true);
  });

  it('maps two trees sharing C1 into a tree diagram instead of a generic flowchart', async () => {
    const room = createEmptyRoom('ROOM07');
    const now = Date.now();
    room.transcriptChunks.push(
      {
        id: 't1',
        speaker: 'Host',
        source: 'manual',
        createdAt: now - 2000,
        text: 'okay so we have two trees one tree is tree A and another tree is tree B',
      },
      {
        id: 't2',
        speaker: 'Host',
        source: 'manual',
        createdAt: now - 1000,
        text: 'whole trees can share one node meaning tree A could have C1 and tree B can have C1',
      },
    );

    const { patch } = await generateDiagramPatch(room, { reason: 'manual' });
    expect(patch.diagramType).toBe('tree');
    expect(
      patch.actions.some(
        (action) => action.op === 'upsertNode' && action.label.toLowerCase().replace(/\s+/g, ' ').includes('a tree'),
      ),
    ).toBe(true);
    expect(
      patch.actions.some(
        (action) => action.op === 'upsertNode' && action.label.toLowerCase().replace(/\s+/g, ' ').includes('b tree'),
      ),
    ).toBe(true);
    expect(patch.actions.some((action) => action.op === 'upsertNode' && action.label === 'C1')).toBe(true);
    expect(patch.actions.filter((action) => action.op === 'upsertEdge').length).toBeGreaterThanOrEqual(2);
  });

  it('maps named trees and underscore shared node from correction text', async () => {
    const room = createEmptyRoom('ROOM07B');
    const now = Date.now();
    room.chatMessages.push(
      {
        id: 'm1',
        authorId: 'u1',
        authorName: 'Host',
        kind: 'correction',
        createdAt: now - 1000,
        text: "today we're looking at the trees for an ad",
      },
      {
        id: 'm2',
        authorId: 'u1',
        authorName: 'Host',
        kind: 'correction',
        createdAt: now,
        text: 'when you have 2 trees, lets say click through tree and referral tree, both trees can have different nodes, but they can also share similar nodes, for example they could both have node ad_trait_3. But we need to process these nodes differently depending on the tree.',
      },
    );

    const { patch } = await generateDiagramPatch(room, { reason: 'correction' });
    expect(patch.diagramType).toBe('tree');
    expect(
      patch.actions.some(
        (action) => action.op === 'upsertNode' && action.label.toLowerCase().includes('click through tree'),
      ),
    ).toBe(true);
    expect(
      patch.actions.some((action) => action.op === 'upsertNode' && action.label.toLowerCase().includes('referral tree')),
    ).toBe(true);
    expect(patch.actions.some((action) => action.op === 'upsertNode' && action.label === 'AD_TRAIT_3')).toBe(true);
  });

  it('revises provider output toward reference until review threshold is met', async () => {
    const room = createEmptyRoom('ROOM08');
    room.transcriptChunks.push({
      id: 't1',
      speaker: 'Host',
      source: 'manual',
      createdAt: Date.now(),
      text: 'We have two trees: tree A and tree B, and both share node C1.',
    });

    const previousProvider = process.env.AI_PROVIDER;
    const previousApiKey = process.env.OPENAI_API_KEY;
    const previousThreshold = process.env.AI_REVIEW_CONFIDENCE_THRESHOLD;
    const previousMaxRevisions = process.env.AI_REVIEW_MAX_REVISIONS;
    const originalFetch = globalThis.fetch;

    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.AI_REVIEW_CONFIDENCE_THRESHOLD = '0.98';
    process.env.AI_REVIEW_MAX_REVISIONS = '20';

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  topic: 'Meeting flow',
                  diagramType: 'flowchart',
                  confidence: 0.45,
                  actions: [{ op: 'setTitle', text: 'Live flowchart' }],
                  openQuestions: [],
                  conflicts: [],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const { patch } = await generateDiagramPatch(room, { reason: 'manual' });
      expect(patch.diagramType).toBe('tree');
      expect(patch.confidence).toBeGreaterThanOrEqual(0.98);
      expect(patch.actions.some((action) => action.op === 'upsertNode')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousProvider) {
        process.env.AI_PROVIDER = previousProvider;
      } else {
        delete process.env.AI_PROVIDER;
      }
      if (previousApiKey) {
        process.env.OPENAI_API_KEY = previousApiKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
      if (previousThreshold) {
        process.env.AI_REVIEW_CONFIDENCE_THRESHOLD = previousThreshold;
      } else {
        delete process.env.AI_REVIEW_CONFIDENCE_THRESHOLD;
      }
      if (previousMaxRevisions) {
        process.env.AI_REVIEW_MAX_REVISIONS = previousMaxRevisions;
      } else {
        delete process.env.AI_REVIEW_MAX_REVISIONS;
      }
    }
  });

  it('builds a strong prompt preview with cleanup and priority directives', () => {
    const room = createEmptyRoom('ROOM09');
    room.chatMessages.push({
      id: 'm1',
      authorId: 'u1',
      authorName: 'Alex',
      kind: 'correction',
      createdAt: Date.now(),
      text: 'Actually use post-order traversal.',
    });

    const preview = createSystemPromptPayloadPreview(room, { reason: 'manual' });
    expect(preview.systemPrompt.includes('deleteShape')).toBe(true);
    expect(preview.systemPrompt.includes('Modality priority is strict')).toBe(true);
    expect(preview.userPrompt.includes('"modalityPriority"')).toBe(true);
    expect(preview.userPrompt.includes('"correctionDirectives"')).toBe(true);
  });
});
