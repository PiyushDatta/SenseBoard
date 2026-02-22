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

export interface PersonalizedBoardOptions {
  memberName: string;
  contextLines: string[];
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

const buildTranscriptWindow = (
  chunks: TranscriptChunk[],
  threshold: number,
  transcriptChunkCount?: number,
): string[] => {
  const lines: Array<{ speaker: string; text: string }> = [];
  const cappedChunks =
    typeof transcriptChunkCount === 'number' && Number.isFinite(transcriptChunkCount) && transcriptChunkCount >= 0
      ? chunks.slice(0, Math.max(0, Math.floor(transcriptChunkCount)))
      : chunks;
  const windowChunks = cappedChunks
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
const PROMPTS_DIR = join(process.cwd(), 'prompts');
const BOARD_OPS_SYSTEM_PROMPT_PATH = join(PROMPTS_DIR, 'main_ai_board_system_prompt.txt');
const BOARD_OPS_DELTA_PROMPT_PATH = join(PROMPTS_DIR, 'main_ai_board_delta_prompt.txt');

const DEFAULT_BOARD_OPS_SYSTEM_PROMPT = [
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
  'Hard requirement: always return board_ops JSON.',
  'When transcriptWindow has text, never return empty ops.',
  'When uncertain, still produce simple drawable placeholders from transcript lines.',
  'Do not return metadata-only responses when transcriptWindow is non-empty.',
].join('\n');

const DEFAULT_BOARD_OPS_DELTA_PROMPT = [
  'You are receiving the latest transcript/context window for a live whiteboard.',
  'For each line in transcriptWindow, choose a concrete visual representation.',
  'When transcriptWindow has text, return drawable ops (upsertElement/appendStrokePoints), not only metadata ops.',
  'If uncertain, draw simple labeled rectangles/text for each transcript idea rather than returning empty output.',
  'Keep updates incremental and anchored to currentBoardHint.',
  'Use transcriptTaskChain to process cumulative tasks task1, task2, task3, ...',
  'Each new task must build on prior board context instead of resetting the board.',
].join('\n');

const BOARD_OPS_FALLBACK_MAX_LINES = 6;

let cachedBoardOpsPrompts: {
  system: string;
  delta: string;
} | null = null;
let boardOpsPromptSessionPrimed = false;
let boardOpsPromptSessionPriming: Promise<void> | null = null;

const logAiRouter = (message: string, level: 'info' | 'debug' = 'info') => {
  if (level === 'debug' && getRuntimeConfig().logging?.level !== 'debug') {
    return;
  }
  const prefix = level === 'debug' ? '[AI Router][debug]' : '[AI Router]';
  console.log(`${prefix} ${message}`);
};

const readPromptTemplate = (filePath: string, fallback: string, label: string): string => {
  if (!existsSync(filePath)) {
    logAiRouter(`Prompt file missing for ${label}; using default. path=${filePath}`, 'debug');
    return fallback;
  }
  try {
    const text = readFileSync(filePath, 'utf8').trim();
    if (!text) {
      logAiRouter(`Prompt file empty for ${label}; using default. path=${filePath}`, 'debug');
      return fallback;
    }
    return text;
  } catch (error) {
    logAiRouter(
      `Prompt file read failed for ${label}; using default. path=${filePath} error=${error instanceof Error ? error.message : String(error)}`,
      'debug',
    );
    return fallback;
  }
};

const getBoardOpsPromptTemplates = (): { system: string; delta: string } => {
  if (cachedBoardOpsPrompts) {
    return cachedBoardOpsPrompts;
  }
  cachedBoardOpsPrompts = {
    system: readPromptTemplate(BOARD_OPS_SYSTEM_PROMPT_PATH, DEFAULT_BOARD_OPS_SYSTEM_PROMPT, 'board_ops.system'),
    delta: readPromptTemplate(BOARD_OPS_DELTA_PROMPT_PATH, DEFAULT_BOARD_OPS_DELTA_PROMPT, 'board_ops.delta'),
  };
  logAiRouter(
    `Loaded board prompts system=${BOARD_OPS_SYSTEM_PROMPT_PATH} delta=${BOARD_OPS_DELTA_PROMPT_PATH}`,
    'debug',
  );
  return cachedBoardOpsPrompts;
};

const truncatePromptText = (value: string, maxLength = 120): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const transcriptLineToPlainText = (line: string): string => {
  const separatorIndex = line.indexOf(':');
  const text = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : line;
  return truncatePromptText(text, 180);
};

const buildTranscriptTaskChain = (lines: string[], maxTasks = 12): string[] => {
  const limited = lines.slice(-Math.max(1, maxTasks));
  const tasks: string[] = [];
  for (let index = 0; index < limited.length; index += 1) {
    tasks.push(`task${index + 1}: ${limited.slice(0, index + 1).join(' || ')}`);
  }
  return tasks;
};

const buildDeterministicBoardOpsFallback = (input: AIInput): BoardOp[] => {
  const lines = input.transcriptWindow
    .map(transcriptLineToPlainText)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-BOARD_OPS_FALLBACK_MAX_LINES);
  if (lines.length === 0) {
    return [];
  }

  const now = Date.now();
  const baseX = 280;
  const baseY = 280;
  const cardWidth = 980;
  const cardHeight = 120;
  const verticalGap = 56;

  const ops: BoardOp[] = [];
  ops.push({
    type: 'upsertElement',
    element: {
      id: 'ai:auto:title',
      kind: 'text',
      x: baseX,
      y: baseY - 42,
      text: 'Live transcript sketch',
      createdAt: now,
      createdBy: 'ai',
      style: {
        fontSize: 28,
        strokeColor: '#1f3c5c',
      },
    },
  });

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!;
    const topY = baseY + index * (cardHeight + verticalGap);
    ops.push({
      type: 'upsertElement',
      element: {
        id: `ai:auto:block:${index}`,
        kind: 'rect',
        x: baseX,
        y: topY,
        w: cardWidth,
        h: cardHeight,
        createdAt: now,
        createdBy: 'ai',
        style: {
          strokeColor: '#2d5a82',
          fillColor: '#dfefff',
          strokeWidth: 2,
          roughness: 1.4,
        },
      },
    });
    ops.push({
      type: 'upsertElement',
      element: {
        id: `ai:auto:text:${index}`,
        kind: 'text',
        x: baseX + 24,
        y: topY + 66,
        text: truncatePromptText(text, 130),
        createdAt: now,
        createdBy: 'ai',
        style: {
          fontSize: 24,
          strokeColor: '#16324a',
        },
      },
    });
  }

  for (let index = 0; index < BOARD_OPS_FALLBACK_MAX_LINES - 1; index += 1) {
    if (index < lines.length - 1) {
      const startY = baseY + index * (cardHeight + verticalGap) + cardHeight;
      const endY = baseY + (index + 1) * (cardHeight + verticalGap);
      ops.push({
        type: 'upsertElement',
        element: {
          id: `ai:auto:link:${index}`,
          kind: 'arrow',
          points: [
            [baseX + cardWidth / 2, startY],
            [baseX + cardWidth / 2, endY],
          ],
          createdAt: now,
          createdBy: 'ai',
          style: {
            strokeColor: '#527493',
            strokeWidth: 2,
            roughness: 1.4,
          },
        },
      });
    } else {
      ops.push({ type: 'deleteElement', id: `ai:auto:link:${index}` });
    }
  }

  for (let index = lines.length; index < BOARD_OPS_FALLBACK_MAX_LINES; index += 1) {
    ops.push({ type: 'deleteElement', id: `ai:auto:block:${index}` });
    ops.push({ type: 'deleteElement', id: `ai:auto:text:${index}` });
  }

  return ops;
};

const normalizePersonalizationContextLines = (lines: string[], maxLines = 16): string[] => {
  return lines
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .slice(-Math.max(1, maxLines));
};

const buildPersonalizedBoardOpsSystemPrompt = (options: PersonalizedBoardOptions): string => {
  const templates = getBoardOpsPromptTemplates();
  const member = options.memberName.trim() || 'Member';
  return [
    templates.system,
    '',
    'You are generating a personalized board for one participant.',
    `Participant: ${member}`,
    'This participant prefers concise bullet-point notes over visual diagrams.',
    'Use text-forward output: short bullet statements, compact grouping, and minimal decorative shapes.',
    'When transcriptWindow has content, always produce drawable operations.',
    'Clear stale personalized items if needed to keep the board focused on current discussion.',
  ].join('\n');
};

const buildPersonalizedBoardOpsUserPrompt = (payload: AIInput, options: PersonalizedBoardOptions): string => {
  const templates = getBoardOpsPromptTemplates();
  const contextLines = normalizePersonalizationContextLines(options.contextLines);
  const input = {
    metadata: {
      roomId: payload.roomId,
      nowIso: payload.nowIso,
      trigger: payload.trigger,
      participant: options.memberName.trim() || 'Member',
    },
    personalization: {
      preferredMode: 'bullet_points_over_visuals',
      contextLines,
    },
    context: {
      corrections: payload.correctionDirectives,
      contextPinnedHigh: payload.contextPinnedHigh,
      contextPinnedNormal: payload.contextPinnedNormal,
      transcriptWindow: payload.transcriptWindow,
      recentChat: payload.recentChat,
    },
    visualHint: payload.visualHint,
    currentBoardHint: {
      topic: payload.currentDiagramSummary.topic,
      diagramType: payload.currentDiagramSummary.diagramType,
      nodeCount: payload.currentDiagramSummary.nodeCount,
      edgeCount: payload.currentDiagramSummary.edgeCount,
    },
  };
  return [
    templates.delta,
    'Personalization directive: summarize ideas as concise bullet points for this user.',
    'Prefer text elements and simple containers; avoid dense diagram geometry unless absolutely necessary.',
    'Every transcript line should map to at least one bullet-style drawable operation.',
    'Return board_ops JSON only.',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
};

const buildDeterministicPersonalizedBoardOpsFallback = (
  input: AIInput,
  options: PersonalizedBoardOptions,
): BoardOp[] => {
  const transcriptLines = input.transcriptWindow
    .map(transcriptLineToPlainText)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-10);
  if (transcriptLines.length === 0) {
    return [];
  }

  const profileLines = normalizePersonalizationContextLines(options.contextLines, 3);
  const member = options.memberName.trim() || 'Member';
  const now = Date.now();
  const left = 260;
  const top = 240;
  const width = 1280;
  const lineHeight = 54;

  const ops: BoardOp[] = [{ type: 'clearBoard' }];
  ops.push({
    type: 'upsertElement',
    element: {
      id: 'personal:title',
      kind: 'text',
      x: left,
      y: top - 34,
      text: `${member} - Personalized Notes`,
      createdAt: now,
      createdBy: 'ai',
      style: {
        fontSize: 30,
        strokeColor: '#173a58',
      },
    },
  });

  if (profileLines.length > 0) {
    ops.push({
      type: 'upsertElement',
      element: {
        id: 'personal:profile',
        kind: 'text',
        x: left,
        y: top + 10,
        text: `Preferences: ${truncatePromptText(profileLines.join(' | '), 140)}`,
        createdAt: now,
        createdBy: 'ai',
        style: {
          fontSize: 20,
          strokeColor: '#2d607f',
        },
      },
    });
  } else {
    ops.push({ type: 'deleteElement', id: 'personal:profile' });
  }

  const bulletStartY = top + 72;
  for (let index = 0; index < transcriptLines.length; index += 1) {
    const line = transcriptLines[index]!;
    ops.push({
      type: 'upsertElement',
      element: {
        id: `personal:bullet:${index}`,
        kind: 'text',
        x: left,
        y: bulletStartY + index * lineHeight,
        text: `- ${truncatePromptText(line, 150)}`,
        createdAt: now,
        createdBy: 'ai',
        style: {
          fontSize: 24,
          strokeColor: '#1f3c5c',
        },
      },
    });
  }
  for (let index = transcriptLines.length; index < 10; index += 1) {
    ops.push({ type: 'deleteElement', id: `personal:bullet:${index}` });
  }

  ops.push({
    type: 'upsertElement',
    element: {
      id: 'personal:frame',
      kind: 'rect',
      x: left - 24,
      y: top - 64,
      w: width,
      h: 140 + transcriptLines.length * lineHeight,
      createdAt: now,
      createdBy: 'ai',
      style: {
        strokeColor: '#3b6c8e',
        fillColor: '#e8f4ff',
        strokeWidth: 2,
        roughness: 1.2,
      },
    },
  });

  return ops;
};

const buildBoardOpsPrimeInput = (): AIInput => ({
  roomId: 'PRIME',
  nowIso: new Date().toISOString(),
  trigger: {
    reason: 'manual',
    regenerate: false,
    windowSeconds: 30,
  },
  transcriptWindow: ['Host: Prime board drawing cache for live transcript updates.'],
  recentChat: [],
  corrections: [],
  correctionDirectives: [],
  contextPinnedHigh: [],
  contextPinnedNormal: [],
  contextDirectiveLines: [],
  visualHint: '',
  currentDiagramSummary: {
    groupId: 'prime',
    topic: 'Prime',
    diagramType: 'flowchart',
    nodeCount: 0,
    edgeCount: 0,
  },
  activeDiagramSnapshot: {
    pinned: false,
    title: '',
    notes: [],
    nodeIds: [],
    nodeLabels: [],
    edgePairs: [],
  },
  aiConfig: {
    frozen: false,
    focusMode: false,
    pinnedGroups: [],
  },
});

export const primeAiPromptSession = async (): Promise<void> => {
  if (boardOpsPromptSessionPrimed) {
    return;
  }
  if (boardOpsPromptSessionPriming) {
    await boardOpsPromptSessionPriming;
    return;
  }

  boardOpsPromptSessionPriming = (async () => {
    getBoardOpsPromptTemplates();

    const agent = getAgent();
    if (!agent) {
      logAiRouter('Board prompt session prime skipped: no AI agent available.', 'debug');
      return;
    }

    const primeInput = buildBoardOpsPrimeInput();
    const systemPrompt = buildBoardOpsSystemPrompt();
    const userPrompt = buildBoardOpsUserPrompt(primeInput);
    const primeResult = await agent.completeJson(systemPrompt, userPrompt).catch(() => null);
    if (primeResult) {
      logAiRouter('Board prompt session primed with main AI route.', 'debug');
    } else {
      logAiRouter('Board prompt session prime completed without response.', 'debug');
    }
    boardOpsPromptSessionPrimed = true;
  })()
    .catch(() => undefined)
    .finally(() => {
      boardOpsPromptSessionPriming = null;
    });

  await boardOpsPromptSessionPriming;
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

const compactForLog = (value: string, maxLength = 1400): string => {
  const flattened = value.replace(/\s+/g, ' ').trim();
  if (flattened.length <= maxLength) {
    return flattened;
  }
  return `${flattened.slice(0, maxLength)}...`;
};

const stringifyForLog = (value: unknown, maxLength = 1400): string => {
  try {
    return compactForLog(JSON.stringify(value), maxLength);
  } catch {
    return compactForLog(String(value), maxLength);
  }
};

const parseJsonWithDebugLog = (providerLabel: string, rawContent: string): unknown | null => {
  logAiRouter(`${providerLabel} JSON raw="${compactForLog(rawContent)}"`, 'debug');
  const parsed = parseJsonObject(rawContent);
  if (parsed === null) {
    logAiRouter(`${providerLabel} JSON parse failed`, 'debug');
    return null;
  }
  logAiRouter(`${providerLabel} JSON parsed="${stringifyForLog(parsed, 900)}"`, 'debug');
  return parsed;
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
  return getBoardOpsPromptTemplates().system;
};

const buildBoardOpsUserPrompt = (payload: AIInput): string => {
  const templates = getBoardOpsPromptTemplates();
  const transcriptTaskChain = buildTranscriptTaskChain(payload.transcriptWindow);
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
      transcriptTaskChain,
      recentChat: payload.recentChat,
    },
    visualHint: payload.visualHint,
    currentBoardHint: {
      topic: payload.currentDiagramSummary.topic,
      diagramType: payload.currentDiagramSummary.diagramType,
      nodeCount: payload.currentDiagramSummary.nodeCount,
      edgeCount: payload.currentDiagramSummary.edgeCount,
    },
    aiConfig: payload.aiConfig,
  };
  return [
    templates.delta,
    'Primary objective: generate visible board drawing operations quickly.',
    'If transcriptTaskChain has tasks, use the latest task while preserving cumulative context.',
    'Transcript mapping rule: every transcriptWindow line must map to at least one drawable operation.',
    'If transcriptWindow is not empty, output upsertElement/appendStrokePoints and not only setViewport/deleteElement metadata.',
    'Never return empty ops when transcriptWindow has content.',
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
      const stdout = result.stdout ? new TextDecoder().decode(result.stdout) : '';
      const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : '';
      logAiRouter(
        `Codex JSON call failed exitCode=${result.exitCode} stdout="${compactForLog(stdout, 700)}" stderr="${compactForLog(stderr, 700)}"`,
        'debug',
      );
      return null;
    }
    const content = readFileSync(outputFile, 'utf8');
    return parseJsonWithDebugLog('Codex JSON response', content);
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
    logAiRouter(`OpenAI JSON call failed (${response.status})${detail ? `: ${detail}` : ''}`);
    return null;
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    logAiRouter('OpenAI JSON response was empty.', 'debug');
    return null;
  }
  return parseJsonWithDebugLog('OpenAI JSON response', content);
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
    logAiRouter(`Anthropic JSON call failed (${response.status})${detail ? `: ${detail}` : ''}`);
    return null;
  }
  const data = (await response.json().catch(() => null)) as unknown;
  const content = extractAnthropicText(data);
  if (!content) {
    logAiRouter('Anthropic JSON response was empty.', 'debug');
    return null;
  }
  return parseJsonWithDebugLog('Anthropic JSON response', content);
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
      logAiRouter('AUTO provider fell back to OpenAI because Claude/Codex were unavailable.', 'debug');
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
        logAiRouter(`JSON fallback -> ${entry.id}`, 'debug');
      }
      const response = await entry.completeJson(systemPrompt, userPrompt).catch(() => null);
      if (response !== null) {
        if (index > 0) {
          logAiRouter(`JSON fallback succeeded with ${entry.id}`, 'debug');
        }
        return response;
      }
    }
    logAiRouter('JSON route exhausted all providers.', 'debug');
    return null;
  };

  const runTextRoute = async (prompt: string): Promise<AiAgentTextResult | null> => {
    for (let index = 0; index < chain.length; index += 1) {
      const entry = chain[index]!;
      if (index === 0) {
        logAiRouter(`Text route primary=${entry.id}`);
      } else {
        logAiRouter(`Text fallback -> ${entry.id}`, 'debug');
      }
      const response = await entry.completeText(prompt).catch(() => null);
      const trimmed = response?.trim() ?? '';
      if (trimmed.length > 0) {
        if (index > 0) {
          logAiRouter(`Text fallback succeeded with ${entry.id}`, 'debug');
        }
        return {
          provider: entry.id,
          text: trimmed,
        };
      }
    }
    logAiRouter('Text route exhausted all providers.', 'debug');
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
  trigger: Pick<TriggerPatchRequest, 'reason' | 'regenerate' | 'transcriptChunkCount'> = {
    reason: 'manual',
    regenerate: false,
  },
): AIInput => {
  const now = Date.now();
  const threshold = now - windowSeconds * 1000;
  const transcriptWindow = buildTranscriptWindow(room.transcriptChunks, threshold, trigger.transcriptChunkCount);

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
  getBoardOpsPromptTemplates();
  await primeAiPromptSession();

  const agent = getAgent();
  if (!agent) {
    return null;
  }
  const input = collectAiInput(room, request.windowSeconds ?? 30, {
    reason: request.reason,
    regenerate: request.regenerate,
    transcriptChunkCount: request.transcriptChunkCount,
  });
  const fingerprint = `${getAiFingerprint(input)}:board_ops`;
  const systemPrompt = buildBoardOpsSystemPrompt();
  const userPrompt = buildBoardOpsUserPrompt(input);

  const parsed = await agent.completeJson(systemPrompt, userPrompt).catch(() => null);

  const envelope = coerceBoardOpsEnvelope(parsed);
  if (envelope && envelope.ops.length > 0) {
    return {
      ops: envelope.ops,
      fingerprint,
    };
  }
  if (parsed !== null) {
    logAiRouter(`Board ops rejected parsed response="${stringifyForLog(parsed, 1100)}"`, 'debug');
  } else {
    logAiRouter('Board ops route returned null response.', 'debug');
  }

  const fallbackOps = buildDeterministicBoardOpsFallback(input);
  if (fallbackOps.length > 0) {
    logAiRouter(`Board ops fallback -> deterministic_transcript lines=${input.transcriptWindow.length}`, 'debug');
    return {
      ops: fallbackOps,
      fingerprint,
    };
  }
  return null;
};

export const generatePersonalizedBoardOps = async (
  room: RoomState,
  request: TriggerPatchRequest,
  options: PersonalizedBoardOptions,
): Promise<{ ops: BoardOp[]; fingerprint: string } | null> => {
  getBoardOpsPromptTemplates();
  await primeAiPromptSession();

  const input = collectAiInput(room, request.windowSeconds ?? 30, {
    reason: request.reason,
    regenerate: request.regenerate,
    transcriptChunkCount: request.transcriptChunkCount,
  });
  const normalizedContextLines = normalizePersonalizationContextLines(options.contextLines);
  const personalizationSignature = hashString(
    JSON.stringify({
      member: normalizeForMatch(options.memberName),
      context: normalizedContextLines,
    }),
  );
  const fingerprint = `${getAiFingerprint(input)}:${personalizationSignature}:personal_board_ops`;
  const agent = getAgent();
  if (!agent) {
    const fallbackWithoutAgent = buildDeterministicPersonalizedBoardOpsFallback(input, options);
    if (fallbackWithoutAgent.length > 0) {
      logAiRouter(
        `Personalized board fallback -> deterministic_no_agent member=${options.memberName || 'Member'} lines=${input.transcriptWindow.length}`,
        'debug',
      );
      return {
        ops: fallbackWithoutAgent,
        fingerprint,
      };
    }
    return null;
  }

  const systemPrompt = buildPersonalizedBoardOpsSystemPrompt(options);
  const userPrompt = buildPersonalizedBoardOpsUserPrompt(input, options);
  const parsed = await agent.completeJson(systemPrompt, userPrompt).catch(() => null);

  const envelope = coerceBoardOpsEnvelope(parsed);
  if (envelope && envelope.ops.length > 0) {
    return {
      ops: envelope.ops,
      fingerprint,
    };
  }
  if (parsed !== null) {
    logAiRouter(`Personalized board ops rejected parsed response="${stringifyForLog(parsed, 1100)}"`, 'debug');
  } else {
    logAiRouter('Personalized board ops route returned null response.', 'debug');
  }

  const fallbackOps = buildDeterministicPersonalizedBoardOpsFallback(input, options);
  if (fallbackOps.length > 0) {
    logAiRouter(
      `Personalized board fallback -> deterministic member=${options.memberName || 'Member'} lines=${input.transcriptWindow.length}`,
      'debug',
    );
    return {
      ops: fallbackOps,
      fingerprint,
    };
  }
  return null;
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
    transcriptChunkCount: request.transcriptChunkCount,
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
      logAiRouter('Diagram fallback -> codex_cli', 'debug');
      providerPatch = await maybeRunCodexCli(input).catch(() => null);
      if (providerPatch) {
        logAiRouter('Diagram fallback succeeded with codex_cli', 'debug');
      }
    }
    if (!providerPatch && provider === 'auto') {
      logAiRouter('Diagram AUTO fallback -> openai', 'debug');
      providerPatch = await maybeRunOpenAi(input).catch(() => null);
      if (providerPatch) {
        logAiRouter('Diagram fallback succeeded with openai', 'debug');
      }
    }
  } else if (provider === 'openai') {
    logAiRouter('Diagram route primary=openai');
    providerPatch = await maybeRunOpenAi(input).catch(() => null);
    if (!providerPatch) {
      logAiRouter('Diagram fallback -> codex_cli', 'debug');
      providerPatch = await maybeRunCodexCli(input).catch(() => null);
      if (providerPatch) {
        logAiRouter('Diagram fallback succeeded with codex_cli', 'debug');
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
    transcriptChunkCount: request.transcriptChunkCount,
  });
  return {
    id: newId(),
    request,
    systemPrompt: buildDiagramPatchSystemPrompt(),
    userPrompt: buildDiagramPatchUserPrompt(payload),
    payload,
  };
};
