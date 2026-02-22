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
  transcriptContext: string[];
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

const buildTranscriptContext = (chunks: TranscriptChunk[], transcriptChunkCount?: number): string[] => {
  const cappedChunks =
    typeof transcriptChunkCount === 'number' && Number.isFinite(transcriptChunkCount) && transcriptChunkCount >= 0
      ? chunks.slice(0, Math.max(0, Math.floor(transcriptChunkCount)))
      : chunks;

  const lines = cappedChunks
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((chunk) => {
      const cleaned = normalizeTranscriptText(chunk.text);
      if (!cleaned || !hasUsefulTranscriptSignal(cleaned)) {
        return '';
      }
      const speaker = chunk.speaker.trim() || 'Speaker';
      return `${speaker}: ${cleaned}`;
    })
    .filter((line) => line.length > 0);

  return lines.slice(-72);
};

const normalizeToken = (value: string) => value.trim().replace(/[^\w-]/g, '');

const safeJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type AIProvider = 'deterministic' | 'openai' | 'anthropic' | 'codex_cli' | 'auto';
let codexCliStatus: 'unknown' | 'ready' | 'unavailable' = 'unknown';
const CODEX_REASONING_EFFORT = 'high';
const ANTHROPIC_API_VERSION = '2023-06-01';
const PROMPTS_DIR = join(process.cwd(), 'prompts');
const BOARD_OPS_SYSTEM_PROMPT_PATH = join(PROMPTS_DIR, 'main_ai_board_system_prompt.md');
const LEGACY_BOARD_OPS_SYSTEM_PROMPT_PATH = join(PROMPTS_DIR, 'DEFAULT_BOARD_OPS_SYSTEM_PROMPT.md');
const BOARD_OPS_DELTA_PROMPT_PATH = join(PROMPTS_DIR, 'main_ai_board_delta_prompt.md');
const BOARD_OPS_VISUAL_SKILL_PROMPT_PATH = join(PROMPTS_DIR, 'senseboard-live-visual-notetaker', 'SKILL.md');
const BOARD_OPS_SCHEMA_VERSION = 1;

const DEFAULT_BOARD_OPS_SYSTEM_PROMPT = [
  'ROLE',
  'You are the SenseBoard board-construction engine for live conversations.',
  'Convert spoken context into a clear, visual-plus-text board update.',
  '',
  'OUTPUT CONTRACT',
  'Return JSON only. No markdown, no prose outside JSON, no code fences.',
  'Output exactly one object:',
  '{"kind":"board_ops","schemaVersion":1,"summary":"...","ops":[...],"text":"..."}',
  'Use canonical keys only: kind, schemaVersion, summary, ops, text.',
  'Do not use alias keys such as op/action/operations/shape/item.',
  '',
  'BOARD OP API (allowed ops only)',
  '- upsertElement: {type:"upsertElement", element:{id,kind,...}}',
  '- appendStrokePoints: {type:"appendStrokePoints", id, points:[[x,y],...]}',
  '- deleteElement: {type:"deleteElement", id}',
  '- offsetElement: {type:"offsetElement", id, dx, dy}',
  '- setElementGeometry: {type:"setElementGeometry", id, x?, y?, w?, h?, points?}',
  '- setElementStyle: {type:"setElementStyle", id, style:{strokeColor?,fillColor?,strokeWidth?,roughness?,fontSize?}}',
  '- setElementText: {type:"setElementText", id, text}',
  '- duplicateElement: {type:"duplicateElement", id, newId, dx?, dy?}',
  '- setElementZIndex: {type:"setElementZIndex", id, zIndex}',
  '- alignElements: {type:"alignElements", ids:[...], axis:"left|center|right|x|top|middle|bottom|y"}',
  '- distributeElements: {type:"distributeElements", ids:[...], axis:"horizontal|vertical|x|y", gap?}',
  '- clearBoard: {type:"clearBoard"}',
  '- setViewport: {type:"setViewport", viewport:{x?,y?,zoom?}}',
  '- batch: {type:"batch", ops:[...]}',
  '',
  'ELEMENT KINDS',
  'stroke, rect, ellipse, diamond, triangle, sticky, frame, arrow, line, text.',
  '',
  'ELEMENT PAYLOAD CONTRACT',
  '- text: {id, kind:"text", x, y, text}',
  '- rect|ellipse|diamond|triangle: {id, kind, x, y, w, h}',
  '- sticky: {id, kind:"sticky", x, y, w, h, text}',
  '- frame: {id, kind:"frame", x, y, w, h, title?}',
  '- stroke|line|arrow: {id, kind, points:[[x,y], ...]}',
  '',
  'PRIORITY AND TRUTH ORDER',
  '1) correctionDirectives',
  '2) pinned high context',
  '3) pinned normal context',
  '4) transcriptWindow',
  '5) visualHint',
  '',
  'DESIGN REQUIREMENTS',
  'Use mixed modality: include words and imagery together.',
  'When transcriptWindow has text, include at least one text element and at least one non-text visual element.',
  'Map each transcriptWindow line to at least one concrete drawable operation.',
  'Prefer stable IDs for ongoing concepts; evolve board incrementally.',
  'Use short, readable text labels (not long paragraphs) in ops.',
  'Keep geometry organized and visible in a normal whiteboard area.',
  'Use arrows/lines to show relationships, flow, sequence, and causality.',
  '',
  'STRICT FAILURE AVOIDANCE',
  'Never return empty ops when transcriptWindow has text.',
  'Never return metadata-only output when transcriptWindow has text.',
  'If unsure, still output simple rect + text blocks for each idea.',
  '',
  'TEXT OVERFLOW RULE',
  'If any information cannot be cleanly represented in ops, place it in top-level "text".',
  'The "text" field should be concise bullet-ready content, not essay prose.',
  '',
  'CREATIVE GUIDANCE',
  'Be visually expressive while staying legible: clusters, lanes, frames, callouts, and sequence markers are encouraged.',
  'Use setElementStyle and zIndex intentionally to clarify hierarchy.',
].join('\n');

const DEFAULT_BOARD_OPS_DELTA_PROMPT = [
  'TASK',
  'Generate the next incremental board update from the current meeting state.',
  'Read transcriptWindow as immediate signal and transcriptContext as rolling memory.',
  '',
  'MAPPING RULES',
  'For every transcriptWindow line, emit at least one concrete visual mapping.',
  'Use words + visuals together for each meaningful idea.',
  'Prefer grouped structures (frames/lanes/clusters) when ideas are related.',
  'Use arrows/lines for dependencies, chronology, and transformations.',
  'Use canonical operation keys only: type, element, id, ops, viewport, points, style.',
  'Do not emit alias keys like op/action/operations/shape/item.',
  '',
  'CREATIVE OPS',
  'Use richer operations when helpful: offsetElement, setElementGeometry, setElementStyle, setElementText, duplicateElement, setElementZIndex, alignElements, distributeElements.',
  'Use batch to package coherent sub-updates.',
  '',
  'SAFETY RULES',
  'If transcriptWindow has content, do not return empty ops.',
  'If transcriptWindow has content, do not return metadata-only operations.',
  'If uncertain, create robust placeholder visuals (rectangles + short text labels + connectors).',
  '',
  'OVERFLOW RULE',
  'If details do not fit cleanly in ops, place them in top-level "text".',
  '',
  'INCREMENTALITY',
  'Anchor updates to currentBoardHint and preserve continuity with existing concepts/IDs.',
  'Use transcriptTaskChain (task1..taskN) to keep cumulative structure, not single-line reset behavior.',
].join('\n');

const DEFAULT_BOARD_OPS_VISUAL_SKILL_PROMPT = [
  'LIVE VISUAL NOTE-TAKER SKILL',
  'Use this visual grammar while producing board_ops output.',
  '',
  `Return one JSON object: {"kind":"board_ops","schemaVersion":${BOARD_OPS_SCHEMA_VERSION},"summary":"...","ops":[...],"text":"..."}.`,
  'Use canonical keys only: kind, schemaVersion, summary, ops, text, type, element, id.',
  'Do not use alias keys such as op/action/operations/shape/item.',
  '',
  'Always map each transcriptWindow line to at least one drawable op.',
  'When transcriptWindow has text, include at least one text element and one non-text element.',
  'Prefer incremental edits anchored to currentBoardHint over full redraws.',
  '',
  'Shape recommendations:',
  '- Concepts/topics: rect + short label.',
  '- Emphasis/warnings: triangle + short label.',
  '- Notes/reminders: sticky + short text.',
  '- Group boundaries: frame with optional title.',
  '- Decisions: diamond + connectors to evidence and next step.',
  '- Action items: rect container + checklist-style short text lines.',
  '- Questions/unknowns: text label prefixed with "Open Q" and a connector.',
  '- Sequence/process: numbered rects connected by arrows.',
  '- Risks/issues: warning text label + connector to mitigation/owner.',
  '- Metrics: compact text badge with number linked to related concept.',
  '',
  'Connection recommendations:',
  '- Use arrow for causality, ownership, and flow.',
  '- Use line for weak association/grouping.',
  '',
  'Failsafe:',
  '- If unsure, draw rect + 5-12 word summary + "TBD/Open Q".',
  '- If details do not fit in ops, still draw placeholder and put overflow in top-level "text".',
].join('\n');

const BOARD_OPS_FALLBACK_MAX_LINES = 6;

let cachedBoardOpsPrompts: {
  system: string;
  delta: string;
  visualSkill: string;
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

const readPromptTemplateWithLegacy = (
  preferredPath: string,
  legacyPath: string,
  fallback: string,
  label: string,
): { text: string; sourcePath: string } => {
  const preferred = readPromptTemplate(preferredPath, '', `${label}.preferred`);
  if (preferred.length > 0) {
    return { text: preferred, sourcePath: preferredPath };
  }
  const legacy = readPromptTemplate(legacyPath, '', `${label}.legacy`);
  if (legacy.length > 0) {
    return { text: legacy, sourcePath: legacyPath };
  }
  return { text: fallback, sourcePath: '<default>' };
};

const readRequiredPromptTemplate = (filePath: string, label: string): { text: string; sourcePath: string } => {
  if (!existsSync(filePath)) {
    throw new Error(`Required prompt file missing for ${label}. path=${filePath}`);
  }
  const text = readFileSync(filePath, 'utf8').trim();
  if (!text) {
    throw new Error(`Required prompt file empty for ${label}. path=${filePath}`);
  }
  return { text, sourcePath: filePath };
};

const getBoardOpsPromptTemplates = (): { system: string; delta: string; visualSkill: string } => {
  if (cachedBoardOpsPrompts) {
    return cachedBoardOpsPrompts;
  }
  const systemPrompt = readPromptTemplateWithLegacy(
    BOARD_OPS_SYSTEM_PROMPT_PATH,
    LEGACY_BOARD_OPS_SYSTEM_PROMPT_PATH,
    DEFAULT_BOARD_OPS_SYSTEM_PROMPT,
    'board_ops.system',
  );
  const visualSkillPrompt = readRequiredPromptTemplate(BOARD_OPS_VISUAL_SKILL_PROMPT_PATH, 'board_ops.visual_skill');
  cachedBoardOpsPrompts = {
    system: systemPrompt.text,
    delta: readPromptTemplate(BOARD_OPS_DELTA_PROMPT_PATH, DEFAULT_BOARD_OPS_DELTA_PROMPT, 'board_ops.delta'),
    visualSkill: visualSkillPrompt.text,
  };
  logAiRouter(
    `Loaded board prompts system=${systemPrompt.sourcePath} delta=${BOARD_OPS_DELTA_PROMPT_PATH} visualSkill=${visualSkillPrompt.sourcePath}`,
    'debug',
  );
  return cachedBoardOpsPrompts;
};

const truncatePromptText = (value: string, maxLength = 96): string => {
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
    templates.visualSkill,
    '',
    'You are generating a personalized board for one participant.',
    `Participant: ${member}`,
    'Use mixed modality with text-forward output: short bullets plus supporting simple visuals.',
    'When transcriptWindow has content, always produce drawable operations.',
    'Clear stale personalized items if needed to keep the board focused on current discussion.',
    'If details do not fit cleanly in ops, include them in top-level "text".',
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
      transcriptContext: payload.transcriptContext,
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
    'Prefer text elements with simple supporting containers/links; avoid dense geometry unless necessary.',
    'Every transcript line should map to at least one bullet-style drawable operation.',
    'Include non-text visual support (rect/line/arrow) when possible, not only text.',
    'If something cannot be represented in ops, put it in top-level "text".',
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
  transcriptContext: ['Host: Prime board drawing cache for live transcript updates.'],
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

const tryParseJson = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const stripMarkdownJsonFence = (text: string): string => {
  const trimmed = text.trim();
  const fullyWrapped = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fullyWrapped && typeof fullyWrapped[1] === 'string') {
    return fullyWrapped[1].trim();
  }
  return trimmed.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
};

const extractBalancedJsonSlices = (
  text: string,
  options?: {
    maxSlices?: number;
    maxChars?: number;
    minLength?: number;
  },
): Array<{ start: number; slice: string }> => {
  const maxSlices = options?.maxSlices ?? 180;
  const maxChars = options?.maxChars ?? 220000;
  const minLength = options?.minLength ?? 2;
  const source = text.slice(0, maxChars);
  const stack: Array<{ kind: '{' | '['; index: number }> = [];
  const slices: Array<{ start: number; slice: string }> = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push({ kind: char, index });
      continue;
    }
    if ((char === '}' || char === ']') && stack.length > 0) {
      const expected = char === '}' ? '{' : '[';
      let startIndex = -1;
      while (stack.length > 0) {
        const top = stack.pop()!;
        if (top.kind === expected) {
          startIndex = top.index;
          break;
        }
      }
      if (startIndex >= 0) {
        const slice = source.slice(startIndex, index + 1).trim();
        if (slice.length >= minLength) {
          slices.push({ start: startIndex, slice });
          if (slices.length >= maxSlices) {
            break;
          }
        }
      }
    }
  }
  return slices;
};

const parseJsonObject = (text: string): unknown | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (value: string) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const fenceStripped = stripMarkdownJsonFence(trimmed);
  pushCandidate(trimmed);
  pushCandidate(fenceStripped);
  pushCandidate(fenceStripped.replace(/^\s*json\s*/i, ''));

  for (const candidate of candidates) {
    const direct = tryParseJson(candidate);
    if (direct !== null) {
      return direct;
    }

    const slices = extractBalancedJsonSlices(candidate, {
      maxSlices: 96,
      maxChars: 220000,
      minLength: 2,
    })
      .map((entry) => entry.slice)
      .sort((left, right) => right.length - left.length);

    for (const slice of slices) {
      const parsed = tryParseJson(slice);
      if (parsed !== null) {
        return parsed;
      }
    }

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = tryParseJson(candidate.slice(start, end + 1));
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
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

interface BoardOpsEnvelope {
  kind: 'board_ops';
  schemaVersion: number;
  summary?: string;
  text?: string;
  ops: BoardOp[];
}

const parseJsonWithDebugLog = (providerLabel: string, rawContent: string): unknown | null => {
  logAiRouter(`${providerLabel} JSON raw="${compactForLog(rawContent)}"`, 'debug');
  const parsed = parseJsonObject(rawContent);
  if (parsed !== null) {
    logAiRouter(`${providerLabel} JSON parsed="${stringifyForLog(parsed, 900)}"`, 'debug');
    return parsed;
  }

  const salvaged = salvageBoardOpsEnvelopeFromRawText(rawContent);
  if (salvaged) {
    logAiRouter(`${providerLabel} JSON parse failed; salvaged board_ops envelope.`, 'debug');
    logAiRouter(`${providerLabel} JSON salvaged="${stringifyForLog(salvaged, 900)}"`, 'debug');
    return salvaged;
  }

  logAiRouter(`${providerLabel} JSON parse failed`, 'debug');
  return null;
};

const coerceBoardOp = (value: unknown): BoardOp | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const item = value as Record<string, unknown>;
  const rawType =
    (typeof item.type === 'string' ? item.type : null) ??
    (typeof item.op === 'string' ? item.op : null) ??
    (typeof item.action === 'string' ? item.action : null) ??
    '';
  const type = rawType.trim().toLowerCase();
  const id =
    (typeof item.id === 'string' ? item.id : null) ??
    (typeof item.elementId === 'string' ? item.elementId : null) ??
    (typeof item.targetId === 'string' ? item.targetId : null);
  const toNumber = (candidate: unknown): number | undefined => {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  };
  const toStylePatch = (candidate: unknown): Partial<NonNullable<BoardOp extends { type: 'setElementStyle'; style: infer S } ? S : never>> | null => {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    const styleInput = candidate as Record<string, unknown>;
    const style: Record<string, unknown> = {};
    if (typeof styleInput.strokeColor === 'string') {
      style.strokeColor = styleInput.strokeColor;
    }
    if (typeof styleInput.fillColor === 'string') {
      style.fillColor = styleInput.fillColor;
    }
    const strokeWidth = toNumber(styleInput.strokeWidth);
    const roughness = toNumber(styleInput.roughness);
    const fontSize = toNumber(styleInput.fontSize);
    if (strokeWidth !== undefined) {
      style.strokeWidth = strokeWidth;
    }
    if (roughness !== undefined) {
      style.roughness = roughness;
    }
    if (fontSize !== undefined) {
      style.fontSize = fontSize;
    }
    return Object.keys(style).length > 0 ? (style as Partial<NonNullable<BoardOp extends { type: 'setElementStyle'; style: infer S } ? S : never>>) : null;
  };

  if (type === 'clearboard' || type === 'clear' || type === 'resetboard' || type === 'reset') {
    return { type: 'clearBoard' };
  }
  if ((type === 'deleteelement' || type === 'delete' || type === 'removeelement' || type === 'remove') && id) {
    return { type: 'deleteElement', id };
  }
  if ((type === 'offsetelement' || type === 'translateelement' || type === 'moveelement' || type === 'move') && id) {
    const dx = toNumber(item.dx) ?? toNumber(item.offsetX) ?? toNumber(item.x) ?? 0;
    const dy = toNumber(item.dy) ?? toNumber(item.offsetY) ?? toNumber(item.y) ?? 0;
    return {
      type: 'offsetElement',
      id,
      dx,
      dy,
    };
  }
  if (type === 'setelementgeometry' || type === 'setgeometry' || type === 'resizeelement' || type === 'resize') {
    if (!id) {
      return null;
    }
    const points = Array.isArray(item.points)
      ? item.points
          .filter((point) => Array.isArray(point) && point.length >= 2)
          .map((point) => [Number((point as unknown[])[0]), Number((point as unknown[])[1])] as [number, number])
          .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      : undefined;
    return {
      type: 'setElementGeometry',
      id,
      ...(toNumber(item.x) !== undefined ? { x: toNumber(item.x) } : {}),
      ...(toNumber(item.y) !== undefined ? { y: toNumber(item.y) } : {}),
      ...(toNumber(item.w) !== undefined || toNumber(item.width) !== undefined
        ? { w: toNumber(item.w) ?? toNumber(item.width) }
        : {}),
      ...(toNumber(item.h) !== undefined || toNumber(item.height) !== undefined
        ? { h: toNumber(item.h) ?? toNumber(item.height) }
        : {}),
      ...(points && points.length > 0 ? { points } : {}),
    };
  }
  if ((type === 'setelementstyle' || type === 'styleelement' || type === 'updatestyle') && id) {
    const style = toStylePatch(item.style ?? item.patch ?? item);
    if (!style) {
      return null;
    }
    return {
      type: 'setElementStyle',
      id,
      style,
    };
  }
  if ((type === 'setelementtext' || type === 'settext' || type === 'updatetext' || type === 'label') && id) {
    const text =
      (typeof item.text === 'string' ? item.text : null) ??
      (typeof item.value === 'string' ? item.value : null) ??
      (typeof item.label === 'string' ? item.label : null);
    if (!text) {
      return null;
    }
    return {
      type: 'setElementText',
      id,
      text,
    };
  }
  if ((type === 'duplicateelement' || type === 'cloneelement' || type === 'duplicate' || type === 'clone') && id) {
    const newId =
      (typeof item.newId === 'string' ? item.newId : null) ??
      (typeof item.cloneId === 'string' ? item.cloneId : null) ??
      (typeof item.id2 === 'string' ? item.id2 : null);
    if (!newId) {
      return null;
    }
    const dx = toNumber(item.dx) ?? toNumber(item.offsetX) ?? 24;
    const dy = toNumber(item.dy) ?? toNumber(item.offsetY) ?? 24;
    return {
      type: 'duplicateElement',
      id,
      newId,
      dx,
      dy,
    };
  }
  if ((type === 'setelementzindex' || type === 'setzindex' || type === 'zindex' || type === 'layer') && id) {
    const zIndex = toNumber(item.zIndex) ?? toNumber(item.value) ?? toNumber(item.layer);
    if (zIndex === undefined) {
      return null;
    }
    return {
      type: 'setElementZIndex',
      id,
      zIndex,
    };
  }
  if (type === 'alignelements' || type === 'align') {
    const idsSource =
      Array.isArray(item.ids) ? item.ids :
      Array.isArray(item.elementIds) ? item.elementIds :
      Array.isArray(item.items) ? item.items :
      [];
    const ids = idsSource
      .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
      .filter((candidate) => candidate.length > 0)
      .slice(0, 240);
    const axisRaw = typeof item.axis === 'string' ? item.axis.trim().toLowerCase() : '';
    const axis: 'left' | 'center' | 'right' | 'x' | 'top' | 'middle' | 'bottom' | 'y' =
      axisRaw === 'left' ||
      axisRaw === 'center' ||
      axisRaw === 'right' ||
      axisRaw === 'x' ||
      axisRaw === 'top' ||
      axisRaw === 'middle' ||
      axisRaw === 'bottom' ||
      axisRaw === 'y'
        ? (axisRaw as 'left' | 'center' | 'right' | 'x' | 'top' | 'middle' | 'bottom' | 'y')
        : 'center';
    if (ids.length < 2) {
      return null;
    }
    return {
      type: 'alignElements',
      ids,
      axis,
    };
  }
  if (type === 'distributeelements' || type === 'distribute') {
    const idsSource =
      Array.isArray(item.ids) ? item.ids :
      Array.isArray(item.elementIds) ? item.elementIds :
      Array.isArray(item.items) ? item.items :
      [];
    const ids = idsSource
      .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
      .filter((candidate) => candidate.length > 0)
      .slice(0, 240);
    const axisRaw = typeof item.axis === 'string' ? item.axis.trim().toLowerCase() : '';
    const axis: 'horizontal' | 'vertical' | 'x' | 'y' =
      axisRaw === 'horizontal' || axisRaw === 'vertical' || axisRaw === 'x' || axisRaw === 'y'
        ? (axisRaw as 'horizontal' | 'vertical' | 'x' | 'y')
        : 'horizontal';
    if (ids.length < 3) {
      return null;
    }
    const gap = toNumber(item.gap);
    return {
      type: 'distributeElements',
      ids,
      axis,
      ...(gap !== undefined ? { gap } : {}),
    };
  }
  if (
    (type === 'appendstrokepoints' || type === 'appendpoints' || type === 'extendstroke') &&
    id &&
    Array.isArray(item.points)
  ) {
    return {
      type: 'appendStrokePoints',
      id,
      points: item.points
        .filter((point) => Array.isArray(point) && point.length >= 2)
        .map((point) => [Number((point as unknown[])[0]), Number((point as unknown[])[1])] as [number, number])
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])),
    };
  }
  if (type === 'setviewport' || type === 'viewport' || type === 'camera') {
    const viewport =
      item.viewport && typeof item.viewport === 'object'
        ? (item.viewport as Record<string, unknown>)
        : (item as Record<string, unknown>);
    return {
      type: 'setViewport',
      viewport: {
        x: toNumber(viewport.x),
        y: toNumber(viewport.y),
        zoom: toNumber(viewport.zoom),
      },
    };
  }
  if (
    type === 'upsertelement' ||
    type === 'upsert' ||
    type === 'add' ||
    type === 'addelement' ||
    type === 'setelement'
  ) {
    const elementSource =
      item.element && typeof item.element === 'object'
        ? (item.element as Record<string, unknown>)
        : item.shape && typeof item.shape === 'object'
          ? (item.shape as Record<string, unknown>)
          : item.node && typeof item.node === 'object'
            ? (item.node as Record<string, unknown>)
            : item;
    const element = { ...elementSource } as Record<string, unknown>;
    if (typeof element.id !== 'string' && id) {
      element.id = id;
    }
    if (typeof element.kind !== 'string') {
      const hintKind = typeof item.kind === 'string' ? item.kind : typeof item.elementKind === 'string' ? item.elementKind : '';
      if (hintKind) {
        element.kind = hintKind;
      }
    }
    return {
      type: 'upsertElement',
      element: element as BoardOp extends { type: 'upsertElement'; element: infer E } ? E : never,
    };
  }
  if (type === 'batch' || type === 'group') {
    const nestedOpsSource =
      Array.isArray(item.ops) ? item.ops : Array.isArray(item.operations) ? item.operations : Array.isArray(item.items) ? item.items : [];
    return {
      type: 'batch',
      ops: nestedOpsSource.map(coerceBoardOp).filter((op): op is BoardOp => Boolean(op)).slice(0, 600),
    };
  }
  return null;
};

const coerceBoardText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized.slice(0, 2000) : undefined;
  }
  if (Array.isArray(value)) {
    const lines = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((line) => line.length > 0);
    if (lines.length > 0) {
      return lines.join('\n').slice(0, 2000);
    }
  }
  return undefined;
};

const buildBoardTextOps = (text: string): BoardOp[] => {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
  if (lines.length === 0) {
    return [];
  }

  const now = Date.now();
  const x = 280;
  const y = 220;
  const lineHeight = 34;
  const width = 980;
  const height = Math.max(120, 50 + lineHeight * lines.length);
  const ops: BoardOp[] = [
    {
      type: 'upsertElement',
      element: {
        id: 'ai:text:panel',
        kind: 'rect',
        x: x - 20,
        y: y - 40,
        w: width,
        h: height,
        createdAt: now,
        createdBy: 'ai',
        style: {
          strokeColor: '#2f4f6b',
          fillColor: '#eef5ff',
          strokeWidth: 2,
          roughness: 1.2,
        },
      },
    },
    {
      type: 'upsertElement',
      element: {
        id: 'ai:text:title',
        kind: 'text',
        x,
        y: y - 8,
        text: 'AI text notes',
        createdAt: now + 1,
        createdBy: 'ai',
        style: {
          fontSize: 22,
          strokeColor: '#1a3d59',
        },
      },
    },
  ];

  lines.forEach((line, index) => {
    ops.push({
      type: 'upsertElement',
      element: {
        id: `ai:text:line:${index}`,
        kind: 'text',
        x,
        y: y + 28 + index * lineHeight,
        text: `- ${line}`.slice(0, 220),
        createdAt: now + 2 + index,
        createdBy: 'ai',
        style: {
          fontSize: 18,
          strokeColor: '#173650',
        },
      },
    });
  });

  return ops;
};

const hasTextElementOps = (ops: BoardOp[]): boolean => {
  const visit = (op: BoardOp): boolean => {
    if (op.type === 'upsertElement') {
      return op.element.kind === 'text';
    }
    if (op.type === 'batch') {
      return op.ops.some((nested) => visit(nested));
    }
    return false;
  };
  return ops.some((op) => visit(op));
};

const flattenBoardOps = (ops: BoardOp[]): BoardOp[] => {
  const output: BoardOp[] = [];
  const visit = (op: BoardOp) => {
    output.push(op);
    if (op.type === 'batch') {
      op.ops.forEach((nested) => visit(nested));
    }
  };
  ops.forEach((op) => visit(op));
  return output;
};

interface VisualLabelAnchor {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hasIntrinsicText: boolean;
}

const buildVisualLabelAnchors = (ops: BoardOp[]): VisualLabelAnchor[] => {
  const anchors: VisualLabelAnchor[] = [];
  const flat = flattenBoardOps(ops);
  flat.forEach((op) => {
    if (op.type !== 'upsertElement') {
      return;
    }
    const element = op.element;
    if (
      element.kind !== 'rect' &&
      element.kind !== 'ellipse' &&
      element.kind !== 'diamond' &&
      element.kind !== 'triangle' &&
      element.kind !== 'sticky' &&
      element.kind !== 'frame'
    ) {
      return;
    }
    const hasIntrinsicText =
      (element.kind === 'sticky' && element.text.trim().length > 0) ||
      (element.kind === 'frame' && typeof element.title === 'string' && element.title.trim().length > 0);
    anchors.push({
      id: element.id,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      hasIntrinsicText,
    });
  });
  return anchors;
};

interface TextAnchor {
  x: number;
  y: number;
}

const buildTextAnchors = (ops: BoardOp[]): TextAnchor[] => {
  const anchors: TextAnchor[] = [];
  const flat = flattenBoardOps(ops);
  flat.forEach((op) => {
    if (op.type !== 'upsertElement') {
      return;
    }
    if (op.element.kind === 'text') {
      anchors.push({ x: op.element.x, y: op.element.y });
      return;
    }
    if (op.element.kind === 'sticky' && op.element.text.trim().length > 0) {
      anchors.push({ x: op.element.x + Math.min(40, op.element.w * 0.25), y: op.element.y + Math.min(40, op.element.h * 0.3) });
      return;
    }
    if (op.element.kind === 'frame' && typeof op.element.title === 'string' && op.element.title.trim().length > 0) {
      anchors.push({ x: op.element.x + 12, y: op.element.y - 8 });
    }
  });
  return anchors;
};

const isTextNearVisualAnchor = (textAnchor: TextAnchor, visualAnchor: VisualLabelAnchor): boolean => {
  const marginX = Math.max(120, visualAnchor.w * 0.55);
  const marginY = Math.max(90, visualAnchor.h * 0.45);
  const minX = visualAnchor.x - marginX;
  const maxX = visualAnchor.x + visualAnchor.w + marginX;
  const minY = visualAnchor.y - marginY;
  const maxY = visualAnchor.y + visualAnchor.h + marginY;
  return textAnchor.x >= minX && textAnchor.x <= maxX && textAnchor.y >= minY && textAnchor.y <= maxY;
};

const buildAutoLabelCandidates = (
  input: AIInput,
  summary?: string,
  text?: string,
): string[] => {
  const candidates: string[] = [];
  const push = (value: string | undefined, max = 80) => {
    if (!value) {
      return;
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return;
    }
    if (candidates.includes(normalized)) {
      return;
    }
    candidates.push(truncatePromptText(normalized, max));
  };

  push(summary, 110);
  if (text) {
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 6)
      .forEach((line) => push(line, 80));
  }
  input.transcriptWindow
    .map(transcriptLineToPlainText)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-8)
    .forEach((line) => push(line, 80));

  if (candidates.length === 0) {
    push('Discussion point', 80);
  }
  return candidates;
};

const addAutoLabelsToOps = (
  ops: BoardOp[],
  input: AIInput,
  summary?: string,
  text?: string,
): BoardOp[] => {
  const visualAnchors = buildVisualLabelAnchors(ops);
  if (visualAnchors.length === 0) {
    return ops;
  }

  const textAnchors = buildTextAnchors(ops);
  const unlabeledAnchors = visualAnchors.filter((anchor) => {
    if (anchor.hasIntrinsicText) {
      return false;
    }
    return !textAnchors.some((textAnchor) => isTextNearVisualAnchor(textAnchor, anchor));
  });
  if (unlabeledAnchors.length === 0) {
    return ops;
  }

  const visualCount = visualAnchors.length;
  const existingTextCount = textAnchors.length;
  const targetTextCount = Math.max(1, Math.ceil(visualCount * 0.75));
  const neededLabels = Math.min(10, Math.max(0, targetTextCount - existingTextCount));
  if (neededLabels === 0) {
    return ops;
  }

  const labelCandidates = buildAutoLabelCandidates(input, summary, text);
  const now = Date.now();
  const nextOps = [...ops];
  let candidateIndex = 0;

  for (let index = 0; index < unlabeledAnchors.length && index < neededLabels; index += 1) {
    const anchor = unlabeledAnchors[index]!;
    const label = labelCandidates[candidateIndex % labelCandidates.length]!;
    candidateIndex += 1;
    nextOps.push({
      type: 'upsertElement',
      element: {
        id: `ai:auto:label:${anchor.id}`,
        kind: 'text',
        x: anchor.x + Math.min(22, Math.max(8, anchor.w * 0.1)),
        y: anchor.y + Math.min(42, Math.max(20, anchor.h * 0.32)),
        text: truncatePromptText(label, 84),
        createdAt: now + index,
        createdBy: 'ai',
        style: {
          fontSize: 18,
          strokeColor: '#173650',
        },
      },
    });
  }

  return nextOps.slice(0, 900);
};

const coerceBoardOpsEnvelope = (value: unknown): BoardOpsEnvelope | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const kindRaw = typeof candidate.kind === 'string' ? candidate.kind.trim().toLowerCase() : 'board_ops';
  const acceptedKind =
    kindRaw === 'board_ops' ||
    kindRaw === 'board-ops' ||
    kindRaw === 'boardops' ||
    kindRaw === 'ops' ||
    kindRaw.length === 0;
  if (!acceptedKind) {
    return null;
  }
  const schemaVersionRaw =
    (typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : null) ??
    (typeof candidate.schemaVersion === 'string' ? Number(candidate.schemaVersion) : null) ??
    (typeof candidate.schema_version === 'number' ? candidate.schema_version : null) ??
    (typeof candidate.schema_version === 'string' ? Number(candidate.schema_version) : null) ??
    (typeof candidate.version === 'number' ? candidate.version : null) ??
    (typeof candidate.version === 'string' ? Number(candidate.version) : null);
  const schemaVersion =
    typeof schemaVersionRaw === 'number' && Number.isFinite(schemaVersionRaw) && schemaVersionRaw >= 1
      ? Math.floor(schemaVersionRaw)
      : BOARD_OPS_SCHEMA_VERSION;
  const opsSource =
    Array.isArray(candidate.ops) ? candidate.ops :
    Array.isArray(candidate.operations) ? candidate.operations :
    Array.isArray(candidate.boardOps) ? candidate.boardOps :
    Array.isArray(candidate.build_ops) ? candidate.build_ops :
    Array.isArray(candidate.buildOps) ? candidate.buildOps :
    Array.isArray(candidate.items) ? candidate.items :
    [];
  const ops = opsSource.map(coerceBoardOp).filter((op): op is BoardOp => Boolean(op)).slice(0, 800);
  const summary = typeof candidate.summary === 'string' ? candidate.summary.slice(0, 240) : undefined;
  const text = coerceBoardText(candidate.text) ?? coerceBoardText(candidate.notes) ?? summary;
  const textOps = text && !hasTextElementOps(ops) ? buildBoardTextOps(text) : [];
  const mergedOps = [...ops, ...textOps].slice(0, 900);
  if (mergedOps.length === 0) {
    return null;
  }
  return {
    kind: 'board_ops',
    schemaVersion,
    summary,
    text,
    ops: mergedOps,
  };
};

const BOARD_OP_TYPE_HINTS = [
  'upsertelement',
  'appendstrokepoints',
  'deleteelement',
  'clearboard',
  'offsetelement',
  'setelementgeometry',
  'setelementstyle',
  'setelementtext',
  'duplicateelement',
  'setelementzindex',
  'alignelements',
  'distributeelements',
  'setviewport',
  'batch',
];

const decodeJsonStringFragment = (value: string): string => {
  const decoded = tryParseJson(`"${value}"`);
  if (typeof decoded === 'string') {
    return decoded;
  }
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .trim();
};

const extractJsonStringField = (text: string, fields: string[]): string | undefined => {
  for (const field of fields) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strict = new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
    const strictMatch = text.match(strict);
    if (strictMatch?.[1]) {
      const decoded = decodeJsonStringFragment(strictMatch[1]).trim();
      if (decoded.length > 0) {
        return decoded.slice(0, 2000);
      }
    }
  }
  return undefined;
};

const extractBoardTextSnippets = (text: string, maxSnippets = 8): string[] => {
  const snippets: string[] = [];
  const seen = new Set<string>();
  const pattern = /"(summary|text|notes|title|topic|label)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match && snippets.length < maxSnippets) {
    const candidate = decodeJsonStringFragment(match[2] ?? '').replace(/\s+/g, ' ').trim();
    if (candidate.length > 0 && !seen.has(candidate)) {
      seen.add(candidate);
      snippets.push(candidate.slice(0, 220));
    }
    match = pattern.exec(text);
  }
  return snippets;
};

const looksLikeBoardOpsPayload = (raw: string): boolean => {
  const lower = raw.toLowerCase();
  if (lower.includes('board_ops') || lower.includes('board-ops') || lower.includes('boardops')) {
    return true;
  }
  return BOARD_OP_TYPE_HINTS.some(
    (type) => lower.includes(`"${type}"`) || lower.includes(`"type":"${type}"`) || lower.includes(`"op":"${type}"`),
  );
};

const collectCoercedBoardOps = (value: unknown, sink: BoardOp[]) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCoercedBoardOps(entry, sink));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const op = coerceBoardOp(value);
  if (op) {
    sink.push(op);
  }
  const record = value as Record<string, unknown>;
  const nestedSources: unknown[] = [
    record.ops,
    record.operations,
    record.items,
    record.build_ops,
    record.buildOps,
    record.boardOps,
  ];
  nestedSources.forEach((nested) => {
    if (Array.isArray(nested)) {
      nested.forEach((entry) => {
        const nestedOp = coerceBoardOp(entry);
        if (nestedOp) {
          sink.push(nestedOp);
        }
      });
    }
  });
};

const dedupeBoardOps = (ops: BoardOp[]): BoardOp[] => {
  const deduped: BoardOp[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    const key = (() => {
      try {
        return JSON.stringify(op);
      } catch {
        return `${op.type}:${Date.now()}:${Math.random()}`;
      }
    })();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(op);
  }
  return deduped;
};

function salvageBoardOpsEnvelopeFromRawText(rawContent: string): BoardOpsEnvelope | null {
  const stripped = stripMarkdownJsonFence(rawContent);
  if (!looksLikeBoardOpsPayload(stripped)) {
    return null;
  }

  const slices = extractBalancedJsonSlices(stripped, {
    maxSlices: 2200,
    maxChars: 260000,
    minLength: 4,
  });

  const recoveredOps: BoardOp[] = [];
  for (const entry of slices) {
    const slice = entry.slice;
    if (!slice.includes('"type"') && !slice.includes('"op"') && !slice.includes('"action"')) {
      continue;
    }
    const parsed = tryParseJson(slice);
    if (parsed === null) {
      continue;
    }
    collectCoercedBoardOps(parsed, recoveredOps);
  }

  let summary =
    extractJsonStringField(stripped, ['summary']) ??
    extractJsonStringField(stripped, ['title']) ??
    extractJsonStringField(stripped, ['topic']);
  const snippets = extractBoardTextSnippets(stripped, 10);
  let text =
    extractJsonStringField(stripped, ['text']) ??
    extractJsonStringField(stripped, ['notes']) ??
    (snippets.length > 0 ? snippets.join('\n') : undefined);

  if (!summary && snippets.length > 0) {
    summary = snippets[0]!.slice(0, 240);
  }
  if (!text && summary) {
    text = summary;
  }

  const dedupedOps = dedupeBoardOps(recoveredOps).slice(0, 800);
  const textOps = text && !hasTextElementOps(dedupedOps) ? buildBoardTextOps(text) : [];
  const mergedOps = [...dedupedOps, ...textOps].slice(0, 900);
  if (mergedOps.length === 0) {
    return null;
  }

  return {
    kind: 'board_ops',
    schemaVersion: BOARD_OPS_SCHEMA_VERSION,
    summary: summary?.slice(0, 240),
    text: text?.slice(0, 2000),
    ops: mergedOps,
  };
}

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
  const templates = getBoardOpsPromptTemplates();
  return [templates.system, templates.visualSkill].join('\n\n');
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
      transcriptContext: payload.transcriptContext,
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
    'Use transcriptContext as rolling memory while building current transcriptWindow output.',
    'Transcript mapping rule: every transcriptWindow line must map to at least one drawable operation.',
    'If transcriptWindow is not empty, output upsertElement/appendStrokePoints and not only setViewport/deleteElement metadata.',
    'Use both words and visuals: include at least one text element and at least one non-text visual element when transcriptWindow has content.',
    'If any detail cannot fit in ops, put it in top-level "text".',
    'Never return empty ops when transcriptWindow has content.',
    `Set top-level schemaVersion to ${BOARD_OPS_SCHEMA_VERSION}.`,
    'Use canonical keys only: kind, schemaVersion, summary, ops, text, type, element.',
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
  const transcriptContext = buildTranscriptContext(room.transcriptChunks, trigger.transcriptChunkCount);

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
    transcriptContext,
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
): Promise<{ ops: BoardOp[]; fingerprint: string; text?: string } | null> => {
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
    const augmentedOps = addAutoLabelsToOps(envelope.ops, input, envelope.summary, envelope.text);
    return {
      ops: augmentedOps,
      fingerprint,
      text: envelope.text,
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
): Promise<{ ops: BoardOp[]; fingerprint: string; text?: string } | null> => {
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
    const augmentedOps = addAutoLabelsToOps(envelope.ops, input, envelope.summary, envelope.text);
    return {
      ops: augmentedOps,
      fingerprint,
      text: envelope.text,
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
