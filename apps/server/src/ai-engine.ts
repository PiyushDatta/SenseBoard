import { limitList, newId } from '../../shared/room-state';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRuntimeConfig } from './runtime-config';
import type {
  BoardOp,
  ChatMessage,
  ContextItem,
  DiagramPatch,
  DiagramPatchAction,
  DiagramType,
  RoomState,
  TranscriptChunk,
  TriggerPatchRequest,
} from '../../shared/types';

interface AIInput {
  roomId: string;
  nowIso: string;
  trigger: {
    reason: TriggerPatchRequest['reason'];
    regenerate: boolean;
    windowSeconds: number;
  };
  transcriptWindow: string[];
  recentChat: Array<{ kind: string; text: string; author: string }>;
  corrections: string[];
  correctionDirectives: Array<{ author: string; text: string }>;
  contextPinnedHigh: Array<{ title: string; content: string }>;
  contextPinnedNormal: Array<{ title: string; content: string }>;
  contextDirectiveLines: string[];
  visualHint: string;
  currentDiagramSummary: {
    groupId: string;
    topic: string;
    diagramType: DiagramType;
    nodeCount: number;
    edgeCount: number;
  };
  activeDiagramSnapshot: {
    pinned: boolean;
    title: string;
    notes: string[];
    nodeIds: string[];
    nodeLabels: string[];
    edgePairs: string[];
  };
  aiConfig: {
    frozen: boolean;
    focusMode: boolean;
    pinnedGroups: string[];
  };
}

const HIGH_WORDS = ['must', 'always', 'constraint', 'required', 'priority'];
const TREE_WORDS = ['tree', 'dfs', 'bfs', 'pre-order', 'post-order', 'traversal', 'node', 'children'];
const SYSTEM_WORDS = ['architecture', 'gateway', 'service', 'postgres', 'redis', 'cache', 'api', 'rps'];
const TRANSCRIPT_FILLER_WORDS = new Set(['uh', 'um', 'hmm', 'erm', 'ah', 'mm']);
const KEYWORD_HINTS = [...TREE_WORDS, ...SYSTEM_WORDS, 'flowchart', 'diagram', 'context', 'correction'];

const normalizePromptText = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
};

const stripLeadingFillers = (value: string): string => {
  let output = value.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const match = output.match(/^([a-z]+)/i);
    if (!match) {
      break;
    }
    const token = match[1]?.toLowerCase() ?? '';
    if (!TRANSCRIPT_FILLER_WORDS.has(token)) {
      break;
    }
    output = output.slice(match[0].length).replace(/^[\s,.-]+/, '');
  }
  return output.trim();
};

const normalizeTranscriptText = (text: string): string => {
  const cleaned = stripLeadingFillers(text)
    .replace(/\s+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
  return cleaned;
};

const hasUsefulTranscriptSignal = (text: string): boolean => {
  const cleaned = normalizeTranscriptText(text);
  if (!cleaned) {
    return false;
  }
  const lower = cleaned.toLowerCase();
  const hasKeyword = KEYWORD_HINTS.some((word) => lower.includes(word));
  const tokens = lower.match(/[a-z0-9]+/g) ?? [];

  if (tokens.length === 0) {
    return false;
  }
  if (tokens.length === 1 && !hasKeyword) {
    return false;
  }

  if (tokens.length >= 5) {
    const uniqueRatio = new Set(tokens).size / tokens.length;
    if (uniqueRatio < 0.25 && !hasKeyword) {
      return false;
    }
  }
  return true;
};

const buildTranscriptWindow = (chunks: TranscriptChunk[], threshold: number): string[] => {
  const lines: Array<{ speaker: string; text: string }> = [];
  const windowChunks = chunks
    .filter((chunk) => chunk.createdAt >= threshold)
    .sort((left, right) => left.createdAt - right.createdAt);

  windowChunks.forEach((chunk) => {
    const cleaned = normalizeTranscriptText(chunk.text);
    if (!hasUsefulTranscriptSignal(cleaned)) {
      return;
    }

    const speaker = chunk.speaker.trim() || 'Speaker';
    const previous = lines[lines.length - 1];
    if (previous && previous.speaker === speaker) {
      const previousNormalized = normalizePromptText(previous.text);
      const nextNormalized = normalizePromptText(cleaned);
      if (!nextNormalized) {
        return;
      }
      if (nextNormalized === previousNormalized) {
        return;
      }
      if (nextNormalized.startsWith(previousNormalized) && nextNormalized.length <= previousNormalized.length + 80) {
        previous.text = cleaned;
        return;
      }
      if (previousNormalized.startsWith(nextNormalized) && previousNormalized.length <= nextNormalized.length + 80) {
        return;
      }
    }

    lines.push({ speaker, text: cleaned });
  });

  return lines.slice(-24).map((line) => `${line.speaker}: ${line.text}`);
};

const normalizeToken = (value: string) => value.trim().replace(/[^\w-]/g, '');

const safeJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type AIProvider = 'deterministic' | 'openai' | 'anthropic' | 'codex_cli' | 'auto';
let codexCliStatus: 'unknown' | 'ready' | 'unavailable' = 'unknown';
const CODEX_REASONING_EFFORT = 'high';
const ANTHROPIC_API_VERSION = '2023-06-01';

const logAiRouter = (message: string) => {
  console.log(`[AI Router] ${message}`);
};

const readErrorText = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => '');
  return body.replace(/\s+/g, ' ').trim().slice(0, 240);
};

type AiAgentId = 'openai' | 'anthropic' | 'codex_cli';

interface AiAgentTextResult {
  provider: AiAgentId;
  text: string;
}

interface AiAgent {
  id: AiAgentId;
  completeJson: (systemPrompt: string, userPrompt: string) => Promise<unknown | null>;
  completeTextWithProvider: (prompt: string) => Promise<AiAgentTextResult | null>;
  completeText: (prompt: string) => Promise<string | null>;
}

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
};

const parseArrowChainSegment = (segment: string): string => {
  const firstClause = segment.split(/[.!?\n;]/)[0] ?? segment;
  const normalized = firstClause
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
  if (!normalized) {
    return '';
  }
  return normalized
    .split(' ')
    .map((part) => {
      if (part.length <= 4 && part === part.toUpperCase()) {
        return part;
      }
      if (/^\d+$/.test(part)) {
        return part;
      }
      return `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`;
    })
    .join(' ')
    .trim();
};

const parseArrowChain = (text: string): string[] => {
  if (!text.includes('->')) {
    return [];
  }
  const seen = new Set<string>();
  const chain: string[] = [];
  text.split('->').forEach((part) => {
    const segment = parseArrowChainSegment(part);
    if (!segment) {
      return;
    }
    if (!seen.has(segment)) {
      seen.add(segment);
      chain.push(segment);
    }
  });
  return chain;
};

const detectDiagramType = (text: string): DiagramType => {
  const lower = text.toLowerCase();
  const treeScore = TREE_WORDS.filter((word) => lower.includes(word)).length;
  const systemScore = SYSTEM_WORDS.filter((word) => lower.includes(word)).length;
  if (treeScore >= systemScore && treeScore > 0) {
    return 'tree';
  }
  if (systemScore > 0) {
    return 'system_blocks';
  }
  return 'flowchart';
};

export const shouldBypassHighPriorityContext = (messages: ChatMessage[]): boolean => {
  const correction = messages.find((message) => message.kind === 'correction');
  if (!correction) {
    return false;
  }
  const text = correction.text.toLowerCase();
  return text.includes('context update:') || HIGH_WORDS.some((word) => text.includes(`override ${word}`));
};

const pickTraversal = (text: string): 'pre' | 'post' | 'bfs' => {
  const lower = text.toLowerCase();
  if (lower.includes('post-order') || lower.includes('post order')) {
    return 'post';
  }
  if (lower.includes('bfs') || lower.includes('breadth')) {
    return 'bfs';
  }
  return 'pre';
};

const TREE_ALIAS_STOPWORDS = new Set([
  'an',
  'and',
  'another',
  'are',
  'as',
  'be',
  'can',
  'for',
  'has',
  'have',
  'in',
  'is',
  'of',
  'one',
  'same',
  'share',
  'shares',
  'the',
  'two',
  'with',
]);

const normalizeTreeLabel = (value: string): string => {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
  if (!cleaned) {
    return '';
  }
  return cleaned
    .split(' ')
    .map((part) => (part.length <= 3 ? part.toLowerCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`))
    .join(' ');
};

const treeIdFromLabel = (label: string): string => {
  return `TREE_${label.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase()}`;
};

const extractTreeAliases = (rawText: string): string[] => {
  const aliases = new Set<string>();

  Array.from(rawText.matchAll(/\btrees?\s+([A-Za-z0-9_-]+)/gi))
    .map((match) => normalizeToken(match[1]).toUpperCase())
    .filter((token) => token.length > 0 && !TREE_ALIAS_STOPWORDS.has(token.toLowerCase()))
    .forEach((token) => aliases.add(token));

  // Capture "click through tree", "referral tree", etc.
  Array.from(rawText.matchAll(/\b([A-Za-z0-9_]+(?:\s+[A-Za-z0-9_]+){0,2})\s+tree\b/gi))
    .map((match) => normalizeTreeLabel(match[1] ?? ''))
    .filter((label) => {
      if (!label) {
        return false;
      }
      const lower = label.toLowerCase();
      if (TREE_ALIAS_STOPWORDS.has(lower)) {
        return false;
      }
      if (/^\d+$/.test(lower)) {
        return false;
      }
      if (lower === 'two' || lower === 'another' || lower === 'same') {
        return false;
      }
      return true;
    })
    .forEach((label) => aliases.add(label));

  return Array.from(aliases).slice(0, 6);
};

const hasTraversalIntent = (text: string): boolean => {
  const lower = text.toLowerCase();
  return (
    lower.includes('pre-order') ||
    lower.includes('pre order') ||
    lower.includes('post-order') ||
    lower.includes('post order') ||
    lower.includes('bfs') ||
    lower.includes('dfs') ||
    lower.includes('traversal')
  );
};

const buildTreePatch = (input: AIInput, rawText: string): DiagramPatch => {
  const actions: DiagramPatchAction[] = [];
  const nodeIds = new Set<string>();
  const nodeLabels = new Map<string, string>();
  const edges = new Map<string, { from: string; to: string; label?: string }>();
  const conflicts: DiagramPatch['conflicts'] = [];
  const openQuestions: string[] = [];
  const lowerRaw = rawText.toLowerCase();

  let rootNode: string | null = null;

  const rootMatch = rawText.match(/root\s+([A-Za-z0-9_-]+)/i);
  if (rootMatch) {
    rootNode = normalizeToken(rootMatch[1]).toUpperCase();
    nodeIds.add(rootNode);
    nodeLabels.set(rootNode, rootNode);
  }

  const parentChildrenRegex = /([A-Za-z0-9_-]+)\s+has\s+([A-Za-z0-9_-]+)\s+(?:and|,)\s+([A-Za-z0-9_-]+)/gi;
  for (const match of rawText.matchAll(parentChildrenRegex)) {
    const parent = normalizeToken(match[1]).toUpperCase();
    const left = normalizeToken(match[2]).toUpperCase();
    const right = normalizeToken(match[3]).toUpperCase();
    if (!parent || !left || !right) {
      continue;
    }
    nodeIds.add(parent);
    nodeIds.add(left);
    nodeIds.add(right);
    nodeLabels.set(parent, parent);
    nodeLabels.set(left, left);
    nodeLabels.set(right, right);
    edges.set(`${parent}->${left}`, { from: parent, to: left, label: 'left' });
    edges.set(`${parent}->${right}`, { from: parent, to: right, label: 'right' });
  }

  const childrenOnlyRegex = /children?\s+([A-Za-z0-9_-]+)\s+(?:and|,)\s+([A-Za-z0-9_-]+)/gi;
  for (const match of rawText.matchAll(childrenOnlyRegex)) {
    if (!rootNode) {
      continue;
    }
    const left = normalizeToken(match[1]).toUpperCase();
    const right = normalizeToken(match[2]).toUpperCase();
    if (!left || !right) {
      continue;
    }
    nodeIds.add(rootNode);
    nodeIds.add(left);
    nodeIds.add(right);
    nodeLabels.set(rootNode, rootNode);
    nodeLabels.set(left, left);
    nodeLabels.set(right, right);
    edges.set(`${rootNode}->${left}`, { from: rootNode, to: left, label: 'left' });
    edges.set(`${rootNode}->${right}`, { from: rootNode, to: right, label: 'right' });
  }

  const treeAliases = extractTreeAliases(rawText);

  if (treeAliases.length >= 2) {
    treeAliases.forEach((alias) => {
      const id = treeIdFromLabel(alias);
      nodeIds.add(id);
      nodeLabels.set(id, alias.toLowerCase().startsWith('tree ') ? alias : `${alias} tree`);
      if (!rootNode) {
        rootNode = id;
      }
    });

    const sharedLabelCandidates = Array.from(rawText.matchAll(/\b([A-Za-z][A-Za-z0-9_]*\d+[A-Za-z0-9_]*)\b/g))
      .map((match) => normalizeToken(match[1]).toUpperCase())
      .filter((token) => token.length > 0);
    const sharedNode = sharedLabelCandidates[0] ?? (lowerRaw.includes('share') ? 'SHARED' : null);

    if (sharedNode) {
      nodeIds.add(sharedNode);
      nodeLabels.set(sharedNode, sharedNode);
      treeAliases.forEach((alias) => {
        const from = treeIdFromLabel(alias);
        edges.set(`${from}->${sharedNode}`, { from, to: sharedNode, label: 'shares' });
      });
    }
  }

  if (nodeIds.size === 0) {
    ['A', 'B', 'C', 'D', 'E'].forEach((id) => nodeIds.add(id));
    ['A', 'B', 'C', 'D', 'E'].forEach((id) => nodeLabels.set(id, id));
    edges.set('A->B', { from: 'A', to: 'B', label: 'left' });
    edges.set('A->C', { from: 'A', to: 'C', label: 'right' });
    edges.set('B->D', { from: 'B', to: 'D', label: 'left' });
    edges.set('B->E', { from: 'B', to: 'E', label: 'right' });
    rootNode = 'A';
    openQuestions.push('Which root node should this tree use?');
  }

  if (!rootNode) {
    rootNode = Array.from(nodeIds).sort()[0]!;
  }

  const childMap = new Map<string, string[]>();
  const incoming = new Set<string>();
  Array.from(edges.values()).forEach((edge) => {
    incoming.add(edge.to);
    const bucket = childMap.get(edge.from) ?? [];
    bucket.push(edge.to);
    childMap.set(edge.from, bucket.sort());
  });

  const traversalIntent = hasTraversalIntent(rawText);
  const orderMode = pickTraversal(rawText);
  const traversal: string[] = [];

  const seenForPre = new Set<string>();
  const visitPre = (node: string) => {
    if (seenForPre.has(node)) {
      return;
    }
    seenForPre.add(node);
    traversal.push(node);
    for (const child of childMap.get(node) ?? []) {
      visitPre(child);
    }
  };

  const seenForPost = new Set<string>();
  const visitPost = (node: string) => {
    if (seenForPost.has(node)) {
      return;
    }
    seenForPost.add(node);
    for (const child of childMap.get(node) ?? []) {
      visitPost(child);
    }
    traversal.push(node);
  };

  if (traversalIntent) {
    if (orderMode === 'bfs') {
      const queue = [rootNode];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (seen.has(node)) {
          continue;
        }
        seen.add(node);
        traversal.push(node);
        queue.push(...(childMap.get(node) ?? []));
      }
    } else if (orderMode === 'post') {
      visitPost(rootNode);
    } else {
      visitPre(rootNode);
    }

    Array.from(nodeIds).forEach((nodeId) => {
      if (!traversal.includes(nodeId)) {
        traversal.push(nodeId);
      }
    });
  }

  const levelMap = new Map<string, number>();
  const queue: string[] = [rootNode];
  levelMap.set(rootNode, 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levelMap.get(current)!;
    for (const child of childMap.get(current) ?? []) {
      if (!levelMap.has(child)) {
        levelMap.set(child, level + 1);
        queue.push(child);
      }
    }
  }

  const rows = new Map<number, string[]>();
  Array.from(nodeIds)
    .sort()
    .forEach((id) => {
      const level = levelMap.get(id) ?? 0;
      const list = rows.get(level) ?? [];
      list.push(id);
      rows.set(level, list);
    });

  Array.from(rows.entries()).forEach(([level, ids]) => {
    const gap = 180;
    const startX = 40 + Math.max(0, (700 - ids.length * gap) / 2);
    ids.forEach((id, index) => {
        actions.push({
          op: 'upsertNode',
          id,
          label: nodeLabels.get(id) ?? id,
          x: Math.round(startX + index * gap),
          y: Math.round(80 + level * 150),
        });
    });
  });

  Array.from(edges.values()).forEach((edge) => {
    actions.push({
      op: 'upsertEdge',
      id: `e_${edge.from}_${edge.to}`,
      from: edge.from,
      to: edge.to,
      label: edge.label,
    });
  });

  const transcriptText = input.transcriptWindow.join(' ').toLowerCase();
  const correctionText = input.corrections.join(' ').toLowerCase();
  if (transcriptText.includes('pre-order') && correctionText.includes('post-order')) {
    conflicts.push({
      type: 'correction',
      detail: 'Typed correction switched traversal from pre-order to post-order.',
    });
  }

  const traversalLabel =
    orderMode === 'post' ? 'DFS post-order' : orderMode === 'bfs' ? 'BFS level-order' : 'DFS pre-order';

  const inferredSharedNode = Array.from(nodeLabels.keys()).find(
    (key) => !key.startsWith('TREE_') && /[A-Z]+[0-9]+/.test(key),
  );
  if (traversalIntent) {
    actions.push({
      op: 'setTitle',
      text: `${traversalLabel} traversal`,
    });

    actions.push({
      op: 'setNotes',
      lines: [
        `Topic: ${input.currentDiagramSummary.topic || 'Tree traversal'}`,
        `Mode: ${traversalLabel}`,
        ...input.contextPinnedHigh.slice(0, 2).map((item) => `Constraint: ${item.title} - ${item.content}`),
      ],
    });

    actions.push({
      op: 'highlightOrder',
      nodes: traversal,
    });
  } else if (treeAliases.length >= 2) {
    actions.push({
      op: 'setTitle',
      text: 'Two trees with shared node',
    });

    actions.push({
      op: 'setNotes',
      lines: [
        `Trees: ${treeAliases
          .map((alias) => (alias.toLowerCase().startsWith('tree ') ? alias : `${alias} tree`))
          .join(', ')}`,
        inferredSharedNode ? `Shared node: ${inferredSharedNode}` : 'Shared node mentioned but not clearly named.',
        ...input.contextPinnedHigh.slice(0, 2).map((item) => `Constraint: ${item.title} - ${item.content}`),
      ],
    });
  } else {
    actions.push({
      op: 'setTitle',
      text: 'Tree structure',
    });

    actions.push({
      op: 'setNotes',
      lines: [
        `Topic: ${input.currentDiagramSummary.topic || 'Tree structure'}`,
        ...input.contextPinnedHigh.slice(0, 2).map((item) => `Constraint: ${item.title} - ${item.content}`),
      ],
    });
  }

  actions.push({
    op: 'layoutHint',
    value: 'tree',
  });

  if (
    traversalIntent &&
    !rawText.toLowerCase().includes('pre-order') &&
    !rawText.toLowerCase().includes('post-order') &&
    !rawText.toLowerCase().includes('bfs')
  ) {
    openQuestions.push('Should traversal be pre-order, post-order, or BFS?');
  } else if (!traversalIntent && treeAliases.length >= 2 && !inferredSharedNode) {
    openQuestions.push('What is the exact label of the shared node between the two trees?');
  }

  return {
    topic: traversalIntent ? 'Tree traversal' : treeAliases.length >= 2 ? 'Multi-tree shared node structure' : 'Tree structure',
    diagramType: 'tree',
    confidence: traversalIntent ? 0.82 : 0.79,
    actions,
    openQuestions: openQuestions.slice(0, 2),
    conflicts: conflicts.slice(0, 2),
  };
};

const buildSystemPatch = (input: AIInput, rawText: string): DiagramPatch => {
  const actions: DiagramPatchAction[] = [];
  const chainFromText = parseArrowChain(rawText);
  const flow = chainFromText.length > 1 ? chainFromText : ['Client', 'API Gateway', 'Service', 'Postgres'];

  if (rawText.toLowerCase().includes('redis')) {
    const hasRedis = flow.some((node) => node.toLowerCase().includes('redis'));
    if (!hasRedis) {
      const dbIndex = flow.findIndex((node) => node.toLowerCase().includes('postgre') || node.toLowerCase().includes('db'));
      if (dbIndex > 0) {
        flow.splice(dbIndex, 0, 'Redis Cache');
      } else {
        flow.push('Redis Cache');
      }
    }
  }

  flow.forEach((label, index) => {
    actions.push({
      op: 'upsertNode',
      id: label.toLowerCase().replace(/\s+/g, '_'),
      label,
      x: 70 + index * 190,
      y: 220,
      width: 170,
      height: 88,
    });
  });

  for (let index = 0; index < flow.length - 1; index += 1) {
    const from = flow[index]!.toLowerCase().replace(/\s+/g, '_');
    const to = flow[index + 1]!.toLowerCase().replace(/\s+/g, '_');
    actions.push({
      op: 'upsertEdge',
      id: `e_${from}_${to}`,
      from,
      to,
      label: 'request',
    });
  }

  const notes = [
    'System blocks inferred from conversation.',
    ...input.contextPinnedHigh.slice(0, 3).map((item) => `${item.title}: ${item.content}`),
  ];

  actions.push({ op: 'setTitle', text: 'System design call flow' });
  actions.push({ op: 'setNotes', lines: notes });
  actions.push({ op: 'layoutHint', value: 'left-to-right' });

  return {
    topic: 'System design call flow',
    diagramType: 'system_blocks',
    confidence: 0.77,
    actions,
    openQuestions: [],
    conflicts: [],
  };
};

const buildFlowchartPatch = (input: AIInput, rawText: string): DiagramPatch => {
  const actions: DiagramPatchAction[] = [];
  const sentenceSource = rawText
    .split(/[.!?]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const keyPhrases = sentenceSource.length > 0 ? sentenceSource.slice(0, 3) : ['Live discussion summary'];
  const emojiForText = (value: string): string => {
    const lower = value.toLowerCase();
    if (lower.includes('api') || lower.includes('service') || lower.includes('system')) {
      return '🧩';
    }
    if (lower.includes('tree') || lower.includes('graph') || lower.includes('node')) {
      return '🌳';
    }
    if (lower.includes('design') || lower.includes('ui') || lower.includes('screen')) {
      return '🎨';
    }
    if (lower.includes('problem') || lower.includes('issue') || lower.includes('bug')) {
      return '🛠️';
    }
    if (lower.includes('idea') || lower.includes('plan')) {
      return '💡';
    }
    return '🖼️';
  };

  actions.push({
    op: 'upsertNode',
    id: 'visual_main',
    label: `${emojiForText(keyPhrases[0] ?? '')} ${keyPhrases[0] ?? 'Live discussion'}`.slice(0, 86),
    x: 320,
    y: 170,
    width: 620,
    height: 190,
  });

  keyPhrases.slice(1, 3).forEach((phrase, index) => {
    actions.push({
      op: 'upsertNode',
      id: `visual_detail_${index + 1}`,
      label: `${emojiForText(phrase)} ${phrase}`.slice(0, 72),
      x: 360 + index * 300,
      y: 410,
      width: 280,
      height: 100,
    });
  });

  actions.push({ op: 'setTitle', text: 'Live visual summary' });
  actions.push({
    op: 'setNotes',
    lines: [
      'AI sketch summary generated from the active discussion.',
      ...input.contextPinnedNormal.slice(0, 2).map((item) => `${item.title}: ${item.content}`),
    ],
  });
  actions.push({ op: 'layoutHint', value: 'top-down' });

  return {
    topic: 'Live visual summary',
    diagramType: 'flowchart',
    confidence: 0.66,
    actions,
    openQuestions: [],
    conflicts: [],
  };
};

const coercePatch = (value: unknown): DiagramPatch | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DiagramPatch>;
  if (!candidate.topic || !candidate.diagramType || !Array.isArray(candidate.actions)) {
    return null;
  }

  return {
    topic: candidate.topic,
    diagramType: candidate.diagramType,
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.5,
    actions: candidate.actions.slice(0, 800) as DiagramPatchAction[],
    openQuestions: Array.isArray(candidate.openQuestions) ? candidate.openQuestions.slice(0, 2) : [],
    conflicts: Array.isArray(candidate.conflicts) ? candidate.conflicts.slice(0, 2) : [],
    targetGroupId: candidate.targetGroupId,
  };
};

const parseJsonObject = (text: string): unknown | null => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
};

interface BoardOpsEnvelope {
  kind: 'board_ops';
  summary?: string;
  ops: BoardOp[];
}

const coerceBoardOp = (value: unknown): BoardOp | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Record<string, unknown>;
  const type = typeof item.type === 'string' ? item.type : '';
  if (type === 'clearBoard') {
    return { type: 'clearBoard' };
  }
  if (type === 'deleteElement' && typeof item.id === 'string') {
    return { type: 'deleteElement', id: item.id };
  }
  if (type === 'appendStrokePoints' && typeof item.id === 'string' && Array.isArray(item.points)) {
    return {
      type: 'appendStrokePoints',
      id: item.id,
      points: item.points.filter((point) => Array.isArray(point) && point.length === 2) as Array<[number, number]>,
    };
  }
  if (type === 'setViewport' && item.viewport && typeof item.viewport === 'object') {
    const viewport = item.viewport as Record<string, unknown>;
    return {
      type: 'setViewport',
      viewport: {
        x: typeof viewport.x === 'number' ? viewport.x : undefined,
        y: typeof viewport.y === 'number' ? viewport.y : undefined,
        zoom: typeof viewport.zoom === 'number' ? viewport.zoom : undefined,
      },
    };
  }
  if (type === 'upsertElement' && item.element && typeof item.element === 'object') {
    return {
      type: 'upsertElement',
      element: item.element as BoardOp extends { type: 'upsertElement'; element: infer E } ? E : never,
    };
  }
  if (type === 'batch' && Array.isArray(item.ops)) {
    return {
      type: 'batch',
      ops: item.ops.map(coerceBoardOp).filter((op): op is BoardOp => Boolean(op)).slice(0, 600),
    };
  }
  return null;
};

const coerceBoardOpsEnvelope = (value: unknown): BoardOpsEnvelope | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'board_ops' || !Array.isArray(candidate.ops)) {
    return null;
  }
  const ops = candidate.ops.map(coerceBoardOp).filter((op): op is BoardOp => Boolean(op)).slice(0, 800);
  if (ops.length === 0) {
    return null;
  }
  return {
    kind: 'board_ops',
    summary: typeof candidate.summary === 'string' ? candidate.summary.slice(0, 240) : undefined,
    ops,
  };
};

const getConfiguredProvider = (): AIProvider => {
  return getRuntimeConfig().ai.provider;
};

const isCodexLoggedIn = (exitCode: number, output: string): boolean => {
  if (exitCode !== 0) {
    return false;
  }
  const normalized = output.toLowerCase();
  if (
    normalized.includes('not logged in') ||
    normalized.includes('logged out') ||
    normalized.includes('login required') ||
    normalized.includes('not authenticated')
  ) {
    return false;
  }
  return normalized.includes('logged in') || normalized.includes('authenticated');
};

const checkCodexCliReady = (): boolean => {
  if (codexCliStatus === 'ready') {
    return true;
  }
  try {
    const status = Bun.spawnSync({
      cmd: ['codex', 'login', 'status'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 3000,
    });
    const stdout = status.stdout ? new TextDecoder().decode(status.stdout) : '';
    const stderr = status.stderr ? new TextDecoder().decode(status.stderr) : '';
    const output = `${stdout}\n${stderr}`;
    const ready = isCodexLoggedIn(status.exitCode, output);
    codexCliStatus = ready ? 'ready' : 'unavailable';
    return ready;
  } catch {
    codexCliStatus = 'unavailable';
    return false;
  }
};

const buildDiagramPatchSystemPrompt = (): string => {
  return [
    'You generate deterministic JSON-only diagram patches for a collaborative meeting whiteboard.',
    'Do not output markdown, code fences, prose, or explanations.',
    'Output exactly one JSON object with keys: topic, diagramType, confidence, actions, openQuestions, conflicts, targetGroupId(optional).',
    'Allowed diagramType values: flowchart, system_blocks, tree.',
    'Allowed action ops: upsertNode, upsertEdge, deleteShape, setTitle, setNotes, highlightOrder, layoutHint.',
    'Modality priority is strict:',
    '1) typed corrections (authoritative, highest)',
    '2) pinned high-priority context',
    '3) pinned normal context',
    '4) transcript window',
    '5) visual hint',
    'If typed corrections conflict with transcript, corrections win.',
    'If pinned context conflicts with transcript, pinned context wins unless correction says "Context update:".',
    'Keep the board clear and current: remove stale/irrelevant shapes using deleteShape when topic or structure changed.',
    'Minimize churn: prefer updating existing node IDs/edge IDs before creating new IDs.',
    'Never exceed 500 upsertNode actions.',
    'openQuestions max 2 and conflicts max 2.',
    'Use confidence between 0.1 and 0.99.',
    'If signal is partial or noisy from speech recognition, rely on corrections/context and avoid speculative details.',
  ].join('\n');
};

const buildDiagramPatchUserPrompt = (payload: AIInput): string => {
  const input = {
    metadata: {
      roomId: payload.roomId,
      nowIso: payload.nowIso,
      trigger: payload.trigger,
    },
    modalityPriority: {
      correctionDirectives: payload.correctionDirectives,
      contextPinnedHigh: payload.contextPinnedHigh,
      contextPinnedNormal: payload.contextPinnedNormal,
      contextDirectiveLines: payload.contextDirectiveLines,
      transcriptWindow: payload.transcriptWindow,
      visualHint: payload.visualHint,
    },
    currentDiagram: {
      summary: payload.currentDiagramSummary,
      snapshot: payload.activeDiagramSnapshot,
      aiConfig: payload.aiConfig,
    },
    recentChat: payload.recentChat,
  };

  return [
    'Build the next diagram patch for this exact meeting moment.',
    'Prioritize correctionDirectives first, then pinned context, then transcriptWindow.',
    'Board clarity rule: if prior shapes are no longer relevant, include deleteShape for stale IDs.',
    'Return JSON only.',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
};

const buildBoardOpsSystemPrompt = (): string => {
  return [
    'You are an AI whiteboard sketch engine.',
    'Return JSON only. No markdown.',
    'Output exactly one object: {"kind":"board_ops","summary":"...","ops":[...]}',
    'Ops must use this API only:',
    '- upsertElement: {type:"upsertElement", element:{id,kind,...}}',
    '- appendStrokePoints: {type:"appendStrokePoints", id, points:[[x,y],...]}',
    '- deleteElement: {type:"deleteElement", id}',
    '- clearBoard: {type:"clearBoard"}',
    '- setViewport: {type:"setViewport", viewport:{x?,y?,zoom?}}',
    '- batch: {type:"batch", ops:[...]}',
    'Element kinds: stroke, rect, ellipse, diamond, arrow, line, text.',
    'Prefer sketches over prose. Use arrows/lines to connect ideas.',
    'Modality priority: corrections > pinned high context > pinned normal context > transcript.',
    'Avoid excessive text. Keep labels short. Keep coordinates in a readable range.',
  ].join('\n');
};

const buildBoardOpsUserPrompt = (payload: AIInput): string => {
  const input = {
    metadata: {
      roomId: payload.roomId,
      nowIso: payload.nowIso,
      trigger: payload.trigger,
    },
    context: {
      corrections: payload.correctionDirectives,
      contextPinnedHigh: payload.contextPinnedHigh,
      contextPinnedNormal: payload.contextPinnedNormal,
      transcriptWindow: payload.transcriptWindow,
      recentChat: payload.recentChat,
    },
    currentBoardHint: {
      topic: payload.currentDiagramSummary.topic,
      diagramType: payload.currentDiagramSummary.diagramType,
      nodeCount: payload.currentDiagramSummary.nodeCount,
      edgeCount: payload.currentDiagramSummary.edgeCount,
    },
  };
  return [
    'Generate the next sketch operations for this meeting moment.',
    'Return board_ops JSON only.',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
};

const runCodexCliJsonPrompt = async (systemPrompt: string, userPrompt: string): Promise<unknown | null> => {
  if (!checkCodexCliReady()) {
    return null;
  }
  const outputFile = join(tmpdir(), `senseboard-codex-${newId()}.txt`);
  const model = getRuntimeConfig().ai.codexModel;
  const prompt = [systemPrompt, userPrompt].join('\n\n');
  try {
    const result = Bun.spawnSync({
      cmd: [
        'codex',
        'exec',
        '--output-last-message',
        outputFile,
        '--color',
        'never',
        '-m',
        model,
        '-c',
        `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        prompt,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 45000,
    });
    if (result.exitCode !== 0 || !existsSync(outputFile)) {
      return null;
    }
    const content = readFileSync(outputFile, 'utf8');
    return parseJsonObject(content);
  } catch {
    return null;
  } finally {
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
  }
};

const runOpenAiJsonPrompt = async (systemPrompt: string, userPrompt: string): Promise<unknown | null> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.openaiApiKey;
  if (!apiKey) {
    return null;
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: runtimeConfig.ai.openaiModel,
      temperature: 0.15,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    const detail = await readErrorText(response);
    logAiRouter(`OpenAI text call failed (${response.status})${detail ? `: ${detail}` : ''}`);
    return null;
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }
  return parseJsonObject(content);
};

const extractAnthropicText = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const root = value as { content?: unknown };
  if (!Array.isArray(root.content)) {
    return '';
  }
  const textBlocks = root.content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const block = item as { type?: unknown; text?: unknown };
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter((text) => text.length > 0);
  return textBlocks.join('\n').trim();
};

const runAnthropicJsonPrompt = async (systemPrompt: string, userPrompt: string): Promise<unknown | null> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.anthropicApiKey;
  if (!apiKey) {
    return null;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: runtimeConfig.ai.anthropicModel,
      max_tokens: 1600,
      temperature: 0.15,
      system: `${systemPrompt}\n\nReturn a valid JSON object only.`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!response.ok) {
    const detail = await readErrorText(response);
    logAiRouter(`OpenAI JSON call failed (${response.status})${detail ? `: ${detail}` : ''}`);
    return null;
  }
  const data = (await response.json().catch(() => null)) as unknown;
  const content = extractAnthropicText(data);
  if (!content) {
    return null;
  }
  return parseJsonObject(content);
};

const runCodexCliTextPrompt = async (prompt: string): Promise<string | null> => {
  if (!checkCodexCliReady()) {
    return null;
  }
  const outputFile = join(tmpdir(), `senseboard-codex-ping-${newId()}.txt`);
  const model = getRuntimeConfig().ai.codexModel;
  try {
    const result = Bun.spawnSync({
      cmd: [
        'codex',
        'exec',
        '--output-last-message',
        outputFile,
        '--color',
        'never',
        '-m',
        model,
        '-c',
        `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        prompt,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
    });
    if (result.exitCode !== 0 || !existsSync(outputFile)) {
      return null;
    }
    const content = readFileSync(outputFile, 'utf8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  } finally {
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
  }
};

const runOpenAiTextPrompt = async (prompt: string): Promise<string | null> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.openaiApiKey;
  if (!apiKey) {
    return null;
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: runtimeConfig.ai.openaiModel,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = await readErrorText(response);
    logAiRouter(`Claude text call failed (${response.status})${detail ? `: ${detail}` : ''}`);
    return null;
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content && content.length > 0 ? content : null;
};

const runAnthropicTextPrompt = async (prompt: string): Promise<string | null> => {
  const runtimeConfig = getRuntimeConfig();
  const apiKey = runtimeConfig.ai.anthropicApiKey;
  if (!apiKey) {
    return null;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: runtimeConfig.ai.anthropicModel,
      max_tokens: 256,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = await readErrorText(response);
    logAiRouter(`Claude JSON call failed (${response.status})${detail ? `: ${detail}` : ''}`);
    return null;
  }
  const data = (await response.json().catch(() => null)) as unknown;
  const content = extractAnthropicText(data);
  return content.length > 0 ? content : null;
};

const getAgent = (): AiAgent | null => {
  const provider = getConfiguredProvider();
  const runtimeConfig = getRuntimeConfig();
  const openAiAvailable = runtimeConfig.ai.openaiApiKey.trim().length > 0;
  const anthropicAvailable = runtimeConfig.ai.anthropicApiKey.trim().length > 0;
  const codexAvailable = checkCodexCliReady();

  const chain: Array<{
    id: AiAgentId;
    completeJson: (systemPrompt: string, userPrompt: string) => Promise<unknown | null>;
    completeText: (prompt: string) => Promise<string | null>;
  }> = [];

  if (provider === 'openai') {
    if (openAiAvailable) {
      chain.push({
        id: 'openai',
        completeJson: runOpenAiJsonPrompt,
        completeText: runOpenAiTextPrompt,
      });
    }
    if (codexAvailable) {
      chain.push({
        id: 'codex_cli',
        completeJson: runCodexCliJsonPrompt,
        completeText: runCodexCliTextPrompt,
      });
    }
  } else if (provider === 'codex_cli') {
    if (codexAvailable) {
      chain.push({
        id: 'codex_cli',
        completeJson: runCodexCliJsonPrompt,
        completeText: runCodexCliTextPrompt,
      });
    }
  } else if (provider === 'anthropic' || provider === 'auto') {
    if (anthropicAvailable) {
      chain.push({
        id: 'anthropic',
        completeJson: runAnthropicJsonPrompt,
        completeText: runAnthropicTextPrompt,
      });
    }
    if (codexAvailable) {
      chain.push({
        id: 'codex_cli',
        completeJson: runCodexCliJsonPrompt,
        completeText: runCodexCliTextPrompt,
      });
    }
    if (provider === 'auto' && chain.length === 0 && openAiAvailable) {
      chain.push({
        id: 'openai',
        completeJson: runOpenAiJsonPrompt,
        completeText: runOpenAiTextPrompt,
      });
      logAiRouter('AUTO provider fell back to OpenAI because Claude/Codex were unavailable.');
    }
  }

  if (chain.length === 0) {
    return null;
  }

  const runJsonRoute = async (systemPrompt: string, userPrompt: string): Promise<unknown | null> => {
    for (let index = 0; index < chain.length; index += 1) {
      const entry = chain[index]!;
      if (index === 0) {
        logAiRouter(`JSON route primary=${entry.id}`);
      } else {
        logAiRouter(`JSON fallback -> ${entry.id}`);
      }
      const response = await entry.completeJson(systemPrompt, userPrompt).catch(() => null);
      if (response !== null) {
        if (index > 0) {
          logAiRouter(`JSON fallback succeeded with ${entry.id}`);
        }
        return response;
      }
    }
    logAiRouter('JSON route exhausted all providers.');
    return null;
  };

  const runTextRoute = async (prompt: string): Promise<AiAgentTextResult | null> => {
    for (let index = 0; index < chain.length; index += 1) {
      const entry = chain[index]!;
      if (index === 0) {
        logAiRouter(`Text route primary=${entry.id}`);
      } else {
        logAiRouter(`Text fallback -> ${entry.id}`);
      }
      const response = await entry.completeText(prompt).catch(() => null);
      const trimmed = response?.trim() ?? '';
      if (trimmed.length > 0) {
        if (index > 0) {
          logAiRouter(`Text fallback succeeded with ${entry.id}`);
        }
        return {
          provider: entry.id,
          text: trimmed,
        };
      }
    }
    logAiRouter('Text route exhausted all providers.');
    return null;
  };

  return {
    id: chain[0].id,
    completeJson: runJsonRoute,
    completeTextWithProvider: runTextRoute,
    completeText: async (prompt: string) => {
      const resolved = await runTextRoute(prompt);
      return resolved?.text ?? null;
    },
  };
};

const maybeRunCodexCli = async (payload: AIInput): Promise<DiagramPatch | null> => {
  const parsed = await runCodexCliJsonPrompt(buildDiagramPatchSystemPrompt(), buildDiagramPatchUserPrompt(payload));
  return coercePatch(parsed);
};

const maybeRunOpenAi = async (payload: AIInput): Promise<DiagramPatch | null> => {
  const parsed = await runOpenAiJsonPrompt(buildDiagramPatchSystemPrompt(), buildDiagramPatchUserPrompt(payload));
  return coercePatch(parsed);
};

const maybeRunAnthropic = async (payload: AIInput): Promise<DiagramPatch | null> => {
  const parsed = await runAnthropicJsonPrompt(buildDiagramPatchSystemPrompt(), buildDiagramPatchUserPrompt(payload));
  return coercePatch(parsed);
};

export const collectAiInput = (
  room: RoomState,
  windowSeconds = 30,
  trigger: Pick<TriggerPatchRequest, 'reason' | 'regenerate'> = { reason: 'manual', regenerate: false },
): AIInput => {
  const now = Date.now();
  const threshold = now - windowSeconds * 1000;
  const transcriptWindow = buildTranscriptWindow(room.transcriptChunks, threshold);

  const recentChat = limitList(room.chatMessages, 12);
  const correctionDirectives = recentChat
    .filter((item) => item.kind === 'correction')
    .map((item) => ({ author: item.authorName, text: normalizeTranscriptText(item.text) }))
    .filter((item) => item.text.length > 0);
  const corrections = correctionDirectives.map((item) => item.text);
  const contextPinnedHighAll = room.contextItems
    .filter((item) => item.pinned && item.priority === 'high')
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const contextPinnedNormalAll = room.contextItems
    .filter((item) => item.pinned && item.priority === 'normal')
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const bypassHighPriorityContext = shouldBypassHighPriorityContext(recentChat);
  const contextPinnedHigh = bypassHighPriorityContext ? [] : contextPinnedHighAll;
  const contextPinnedNormal = bypassHighPriorityContext
    ? [...contextPinnedNormalAll, ...contextPinnedHighAll].sort((left, right) => right.updatedAt - left.updatedAt)
    : contextPinnedNormalAll;
  const contextDirectiveLines = [...contextPinnedHigh, ...contextPinnedNormal]
    .slice(0, 12)
    .map((item) => {
      const scope = item.scope.toUpperCase();
      const priority = item.priority.toUpperCase();
      return `[${priority}/${scope}] ${item.title}: ${normalizeTranscriptText(item.content)}`.trim();
    });

  const activeGroup = room.diagramGroups[room.activeGroupId];
  const activeNodes = Object.values(activeGroup?.nodes ?? {});
  const activeEdges = Object.values(activeGroup?.edges ?? {});

  return {
    roomId: room.id,
    nowIso: new Date(now).toISOString(),
    trigger: {
      reason: trigger.reason,
      regenerate: Boolean(trigger.regenerate),
      windowSeconds,
    },
    transcriptWindow,
    recentChat: recentChat.map((item) => ({ kind: item.kind, text: item.text, author: item.authorName })),
    corrections,
    correctionDirectives,
    contextPinnedHigh: contextPinnedHigh.map((item) => ({ title: item.title, content: item.content })),
    contextPinnedNormal: contextPinnedNormal.map((item) => ({ title: item.title, content: item.content })),
    contextDirectiveLines,
    visualHint: room.visualHint,
    currentDiagramSummary: {
      groupId: activeGroup?.id ?? room.activeGroupId,
      topic: activeGroup?.topic ?? '',
      diagramType: activeGroup?.diagramType ?? 'flowchart',
      nodeCount: activeNodes.length,
      edgeCount: activeEdges.length,
    },
    activeDiagramSnapshot: {
      pinned: Boolean(activeGroup?.pinned),
      title: activeGroup?.title ?? '',
      notes: (activeGroup?.notes ?? []).slice(0, 6),
      nodeIds: activeNodes.map((node) => node.id).slice(0, 80),
      nodeLabels: activeNodes.map((node) => node.label).slice(0, 80),
      edgePairs: activeEdges.map((edge) => `${edge.from}->${edge.to}`).slice(0, 120),
    },
    aiConfig: {
      frozen: room.aiConfig.frozen,
      focusMode: room.aiConfig.focusMode,
      pinnedGroups: room.aiConfig.pinnedGroupIds,
    },
  };
};

export const getAiFingerprint = (input: AIInput): string => {
  const { nowIso: _ignoredNowIso, ...stableInput } = input;
  return hashString(JSON.stringify(stableInput));
};

export const hasAiSignal = (room: RoomState, windowSeconds = 30): boolean => {
  const input = collectAiInput(room, windowSeconds, { reason: 'tick', regenerate: false });
  if (input.transcriptWindow.length > 0) {
    return true;
  }
  if (input.recentChat.length > 0 || input.corrections.length > 0) {
    return true;
  }
  if (input.contextPinnedHigh.length > 0 || input.contextPinnedNormal.length > 0) {
    return true;
  }
  return input.visualHint.trim().length > 0;
};

const buildDeterministicPatch = (input: AIInput): DiagramPatch => {
  const allText = [
    ...input.corrections,
    ...input.contextPinnedHigh.map((item) => `${item.title} ${item.content}`),
    ...input.contextPinnedNormal.map((item) => `${item.title} ${item.content}`),
    ...input.recentChat.map((item) => item.text),
    ...input.transcriptWindow,
    input.visualHint,
  ]
    .join(' ')
    .trim();

  const diagramType = detectDiagramType(allText);
  if (diagramType === 'tree') {
    return buildTreePatch(input, allText);
  }
  if (diagramType === 'system_blocks') {
    return buildSystemPatch(input, allText);
  }
  return buildFlowchartPatch(input, allText);
};

const withDeterministicCleanup = (room: RoomState, patch: DiagramPatch): DiagramPatch => {
  const activeGroup = room.diagramGroups[room.activeGroupId];
  if (!activeGroup || activeGroup.pinned) {
    return patch;
  }

  const nextNodeIds = new Set(
    patch.actions
      .filter((action) => action.op === 'upsertNode')
      .map((action) => (action.op === 'upsertNode' ? action.id : '')),
  );
  const nextEdgeIds = new Set(
    patch.actions
      .filter((action) => action.op === 'upsertEdge')
      .map((action) => (action.op === 'upsertEdge' ? action.id : '')),
  );

  const deleteActions: DiagramPatchAction[] = [];

  Object.keys(activeGroup.edges).forEach((edgeId) => {
    if (!nextEdgeIds.has(edgeId)) {
      deleteActions.push({ op: 'deleteShape', id: edgeId });
    }
  });

  Object.keys(activeGroup.nodes).forEach((nodeId) => {
    if (!nextNodeIds.has(nodeId)) {
      deleteActions.push({ op: 'deleteShape', id: nodeId });
    }
  });

  if (deleteActions.length === 0) {
    return patch;
  }

  return {
    ...patch,
    actions: [...deleteActions, ...patch.actions],
  };
};

const ensurePatchLimits = (patch: DiagramPatch): DiagramPatch => {
  const nodeOps = patch.actions.filter((action) => action.op === 'upsertNode');
  if (nodeOps.length > 500) {
    patch.actions = [...patch.actions.filter((action) => action.op !== 'upsertNode'), ...nodeOps.slice(0, 500)];
  }
  patch.openQuestions = patch.openQuestions.slice(0, 2);
  patch.conflicts = patch.conflicts.slice(0, 2);
  patch.confidence = Math.max(0.1, Math.min(0.99, patch.confidence));
  return patch;
};

interface PatchReviewResult {
  score: number;
  issues: string[];
}

const normalizeForMatch = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
};

const collectNodeLabels = (patch: DiagramPatch): Set<string> => {
  return new Set(
    patch.actions
      .filter((action) => action.op === 'upsertNode')
      .map((action) => normalizeForMatch(action.label))
      .filter((value) => value.length > 0),
  );
};

const collectEdgePairs = (patch: DiagramPatch): Set<string> => {
  return new Set(
    patch.actions
      .filter((action) => action.op === 'upsertEdge')
      .map((action) => `${normalizeForMatch(action.from)}->${normalizeForMatch(action.to)}`),
  );
};

const ratio = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 1;
  }
  return numerator / denominator;
};

const reviewPatchAgainstReference = (candidate: DiagramPatch, reference: DiagramPatch): PatchReviewResult => {
  const issues: string[] = [];

  const diagramTypeMatch = candidate.diagramType === reference.diagramType ? 1 : 0;
  if (!diagramTypeMatch) {
    issues.push(`diagram_type:${candidate.diagramType}->${reference.diagramType}`);
  }

  const candidateNodes = collectNodeLabels(candidate);
  const referenceNodes = collectNodeLabels(reference);
  let nodeHits = 0;
  referenceNodes.forEach((node) => {
    if (candidateNodes.has(node)) {
      nodeHits += 1;
    }
  });
  const nodeCoverage = ratio(nodeHits, referenceNodes.size);
  if (nodeCoverage < 0.99) {
    issues.push(`node_coverage:${nodeCoverage.toFixed(2)}`);
  }

  const candidateEdges = collectEdgePairs(candidate);
  const referenceEdges = collectEdgePairs(reference);
  let edgeHits = 0;
  referenceEdges.forEach((edge) => {
    if (candidateEdges.has(edge)) {
      edgeHits += 1;
    }
  });
  const edgeCoverage = ratio(edgeHits, referenceEdges.size);
  if (edgeCoverage < 0.99) {
    issues.push(`edge_coverage:${edgeCoverage.toFixed(2)}`);
  }

  const score = Math.max(
    0,
    Math.min(1, 0.4 * diagramTypeMatch + 0.35 * nodeCoverage + 0.25 * edgeCoverage),
  );
  return {
    score,
    issues,
  };
};

const mergePatchTowardReference = (candidate: DiagramPatch, reference: DiagramPatch): DiagramPatch => {
  if (candidate.diagramType !== reference.diagramType) {
    return safeJson(reference);
  }

  const candidateNodeIds = new Set(
    candidate.actions.filter((action) => action.op === 'upsertNode').map((action) => action.id),
  );
  const candidateEdgePairs = new Set(
    candidate.actions
      .filter((action) => action.op === 'upsertEdge')
      .map((action) => `${action.from}->${action.to}`),
  );

  const missingActions: DiagramPatchAction[] = [];
  reference.actions.forEach((action) => {
    if (action.op === 'upsertNode' && !candidateNodeIds.has(action.id)) {
      missingActions.push(action);
      return;
    }
    if (action.op === 'upsertEdge' && !candidateEdgePairs.has(`${action.from}->${action.to}`)) {
      missingActions.push(action);
      return;
    }
    if (action.op === 'setTitle' && !candidate.actions.some((item) => item.op === 'setTitle')) {
      missingActions.push(action);
      return;
    }
    if (action.op === 'setNotes' && !candidate.actions.some((item) => item.op === 'setNotes')) {
      missingActions.push(action);
      return;
    }
    if (action.op === 'layoutHint' && !candidate.actions.some((item) => item.op === 'layoutHint')) {
      missingActions.push(action);
      return;
    }
    if (action.op === 'highlightOrder' && !candidate.actions.some((item) => item.op === 'highlightOrder')) {
      missingActions.push(action);
    }
  });

  const merged: DiagramPatch = {
    ...candidate,
    topic: candidate.topic || reference.topic,
    actions: [...candidate.actions, ...missingActions],
    openQuestions: candidate.openQuestions.length > 0 ? candidate.openQuestions : reference.openQuestions,
    conflicts: [...candidate.conflicts, ...reference.conflicts].slice(0, 2),
  };
  return safeJson(merged);
};

const reviewAndRevisePatch = (
  initialPatch: DiagramPatch,
  referencePatch: DiagramPatch,
  maxRevisions: number,
  threshold: number,
): { patch: DiagramPatch; reviewScore: number; reviewPasses: number } => {
  let current = safeJson(initialPatch);
  const safeMaxRevisions = Math.max(0, Math.floor(maxRevisions));
  const clampedThreshold = Math.max(0, Math.min(1, threshold));
  let reviewScore = 0;
  let reviewPasses = 0;

  for (let pass = 0; pass <= safeMaxRevisions; pass += 1) {
    const review = reviewPatchAgainstReference(current, referencePatch);
    reviewScore = review.score;
    reviewPasses = pass + 1;
    if (review.score >= clampedThreshold) {
      current.confidence = Math.max(current.confidence, review.score);
      return { patch: current, reviewScore, reviewPasses };
    }
    if (pass === safeMaxRevisions) {
      break;
    }

    if (pass >= 1) {
      current = safeJson(referencePatch);
    } else {
      current = mergePatchTowardReference(current, referencePatch);
    }
  }

  current.confidence = Math.max(current.confidence, reviewScore);
  if (reviewScore < clampedThreshold) {
    current.conflicts = [
      ...current.conflicts,
      {
        type: 'topic' as const,
        detail: `Review score ${Math.round(reviewScore * 1000) / 10}% stayed below threshold ${Math.round(clampedThreshold * 1000) / 10}% after ${reviewPasses} pass(es).`,
      },
    ].slice(0, 2);
  }
  return { patch: current, reviewScore, reviewPasses };
};

export const generateBoardOps = async (
  room: RoomState,
  request: TriggerPatchRequest,
): Promise<{ ops: BoardOp[]; fingerprint: string } | null> => {
  const agent = getAgent();
  if (!agent) {
    return null;
  }
  const input = collectAiInput(room, request.windowSeconds ?? 30, {
    reason: request.reason,
    regenerate: request.regenerate,
  });
  const fingerprint = `${getAiFingerprint(input)}:board_ops`;
  const systemPrompt = buildBoardOpsSystemPrompt();
  const userPrompt = buildBoardOpsUserPrompt(input);

  const parsed = await agent.completeJson(systemPrompt, userPrompt).catch(() => null);

  const envelope = coerceBoardOpsEnvelope(parsed);
  if (!envelope || envelope.ops.length === 0) {
    return null;
  }
  return {
    ops: envelope.ops,
    fingerprint,
  };
};

export const runAiPreflightCheck = async (): Promise<{
  ok: boolean;
  provider: string;
  resolvedProvider?: AiAgentId;
  response?: string;
  error?: string;
}> => {
  const providerLabel = getAiProviderLabel();
  const agent = getAgent();
  if (!agent) {
    return {
      ok: false,
      provider: providerLabel,
      error: 'No connected AI agent is available for the configured provider.',
    };
  }
  const resolved = await agent.completeTextWithProvider('hello how are you').catch(() => null);
  const response = resolved?.text ?? '';
  if (!response) {
    return {
      ok: false,
      provider: providerLabel,
      error: 'AI agent did not return a response to preflight prompt.',
    };
  }
  return {
    ok: true,
    provider: providerLabel,
    resolvedProvider: resolved?.provider,
    response,
  };
};

export const generateDiagramPatch = async (
  room: RoomState,
  request: TriggerPatchRequest,
): Promise<{ patch: DiagramPatch; fingerprint: string }> => {
  const input = collectAiInput(room, request.windowSeconds ?? 30, {
    reason: request.reason,
    regenerate: request.regenerate,
  });
  const fingerprint = getAiFingerprint(input);
  const provider = getConfiguredProvider();
  const runtimeConfig = getRuntimeConfig();
  const reviewMaxRevisions = runtimeConfig.ai.review.maxRevisions;
  const reviewThreshold = runtimeConfig.ai.review.confidenceThreshold;
  const deterministicPatch = withDeterministicCleanup(room, buildDeterministicPatch(input));

  let providerPatch: DiagramPatch | null = null;
  if (provider === 'codex_cli') {
    logAiRouter('Diagram route primary=codex_cli');
    providerPatch = await maybeRunCodexCli(input).catch(() => null);
  } else if (provider === 'anthropic' || provider === 'auto') {
    logAiRouter('Diagram route primary=anthropic');
    providerPatch = await maybeRunAnthropic(input).catch(() => null);
    if (!providerPatch) {
      logAiRouter('Diagram fallback -> codex_cli');
      providerPatch = await maybeRunCodexCli(input).catch(() => null);
      if (providerPatch) {
        logAiRouter('Diagram fallback succeeded with codex_cli');
      }
    }
    if (!providerPatch && provider === 'auto') {
      logAiRouter('Diagram AUTO fallback -> openai');
      providerPatch = await maybeRunOpenAi(input).catch(() => null);
      if (providerPatch) {
        logAiRouter('Diagram fallback succeeded with openai');
      }
    }
  } else if (provider === 'openai') {
    logAiRouter('Diagram route primary=openai');
    providerPatch = await maybeRunOpenAi(input).catch(() => null);
    if (!providerPatch) {
      logAiRouter('Diagram fallback -> codex_cli');
      providerPatch = await maybeRunCodexCli(input).catch(() => null);
      if (providerPatch) {
        logAiRouter('Diagram fallback succeeded with codex_cli');
      }
    }
  }

  const patchFromProviderLooksOff =
    providerPatch !== null &&
    deterministicPatch.diagramType === 'tree' &&
    providerPatch.diagramType !== 'tree' &&
    input.transcriptWindow.some((line) => line.toLowerCase().includes('tree'));

  const initialPatch = patchFromProviderLooksOff ? deterministicPatch : providerPatch ?? deterministicPatch;
  const reviewed = reviewAndRevisePatch(initialPatch, deterministicPatch, reviewMaxRevisions, reviewThreshold);
  const patch = ensurePatchLimits(reviewed.patch);
  if (!patch.topic) {
    patch.topic = 'Live discussion';
  }
  return {
    patch: safeJson({
      ...patch,
      openQuestions: patch.openQuestions.slice(0, 2),
    }),
    fingerprint,
  };
};

export const getAiProviderLabel = (): string => {
  const runtimeConfig = getRuntimeConfig();
  const provider = getConfiguredProvider();
  if (provider === 'openai') {
    return `openai:${runtimeConfig.ai.openaiModel}`;
  }
  if (provider === 'anthropic') {
    return `anthropic:${runtimeConfig.ai.anthropicModel}->codex_cli:${runtimeConfig.ai.codexModel}`;
  }
  if (provider === 'codex_cli') {
    return `codex_cli:${runtimeConfig.ai.codexModel}`;
  }
  if (provider === 'auto') {
    if (runtimeConfig.ai.anthropicApiKey) {
      return `auto->anthropic:${runtimeConfig.ai.anthropicModel}->codex_cli:${runtimeConfig.ai.codexModel}`;
    }
    if (checkCodexCliReady()) {
      return `auto->codex_cli:${runtimeConfig.ai.codexModel}`;
    }
    if (runtimeConfig.ai.openaiApiKey) {
      return `auto->openai:${runtimeConfig.ai.openaiModel}`;
    }
    return 'auto->deterministic';
  }
  return 'deterministic';
};

export const createSystemPromptPayloadPreview = (room: RoomState, request: TriggerPatchRequest) => {
  const payload = collectAiInput(room, request.windowSeconds ?? 30, {
    reason: request.reason,
    regenerate: request.regenerate,
  });
  return {
    id: newId(),
    request,
    systemPrompt: buildDiagramPatchSystemPrompt(),
    userPrompt: buildDiagramPatchUserPrompt(payload),
    payload,
  };
};
