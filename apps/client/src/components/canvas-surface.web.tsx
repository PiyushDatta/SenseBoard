import type { MouseEvent, ReactElement, WheelEvent } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { BoardElement, BoardPoint, RoomState } from '../../../shared/types';
import { SENSEBOARD_AI_CONTENT_MAX_X, SENSEBOARD_AI_CONTENT_MIN_X } from '../../../shared/board-dimensions';
import type { SenseTheme } from '../lib/theme';
import {
  CANVAS_BOARD_DIMENSIONS,
  canvasSvgStyle,
  createCanvasBoardStyle,
  createCanvasViewportStyle,
} from '../styles/canvas-surface-web.styles';

export interface CanvasSurfaceProps {
  room: RoomState | null;
  focusDrawMode: boolean;
  onFocusBoxSelected: (_box: { x: number; y: number; w: number; h: number }) => void;
  onFocusDrawModeChange: (_value: boolean) => void;
  showAiNotes: boolean;
  theme: SenseTheme;
}

const seeded = (seed: string): number => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h / (2 ** 32 - 1);
};

const jitterPoint = (x: number, y: number, seedKey: string, roughness = 2): [number, number] => {
  const rx = seeded(`${seedKey}:x`) - 0.5;
  const ry = seeded(`${seedKey}:y`) - 0.5;
  return [x + rx * roughness * 2, y + ry * roughness * 2];
};

const roughPolyline = (points: BoardPoint[], seedKey: string, roughness = 2): string => {
  if (points.length === 0) {
    return '';
  }
  const first = jitterPoint(points[0][0], points[0][1], `${seedKey}:0`, roughness);
  const rest = points
    .slice(1)
    .map((point, index) => jitterPoint(point[0], point[1], `${seedKey}:${index + 1}`, roughness))
    .map((point) => `L ${point[0]} ${point[1]}`)
    .join(' ');
  return `M ${first[0]} ${first[1]} ${rest}`.trim();
};

const wrapTextLines = (value: string, maxCharsPerLine: number, maxLines: number): string[] => {
  const lineLimit = Math.max(8, maxCharsPerLine);
  const linesLimit = Math.max(1, maxLines);
  const sourceLines = value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (sourceLines.length === 0) {
    return [];
  }

  const wrapped: string[] = [];
  for (const line of sourceLines) {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      continue;
    }
    let current = words[0] ?? '';
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index]!;
      if (current.length + word.length + 1 <= lineLimit) {
        current = `${current} ${word}`;
      } else {
        wrapped.push(current);
        current = word;
        if (wrapped.length >= linesLimit) {
          break;
        }
      }
    }
    if (wrapped.length >= linesLimit) {
      break;
    }
    wrapped.push(current);
    if (wrapped.length >= linesLimit) {
      break;
    }
  }

  if (wrapped.length === 0) {
    return [];
  }

  const fullText = sourceLines.join(' ');
  const compactWrapped = wrapped.join(' ');
  if (fullText.length > compactWrapped.length && wrapped.length > 0) {
    const tail = wrapped[wrapped.length - 1] ?? '';
    wrapped[wrapped.length - 1] = `${tail.slice(0, Math.max(0, lineLimit - 3)).trimEnd()}...`;
  }
  return wrapped.slice(0, linesLimit);
};

const renderElement = (element: BoardElement, theme: SenseTheme, showAiNotes: boolean) => {
  const stroke = element.style?.strokeColor || '#2B3540';
  const strokeWidth = element.style?.strokeWidth ?? 2;
  const fill = element.style?.fillColor || 'transparent';
  const roughness = element.style?.roughness ?? 2;

  if (element.kind === 'text') {
    if (!showAiNotes && (element.id.startsWith('notes:') || element.id.startsWith('order:'))) {
      return null;
    }
    const fontSize = element.style?.fontSize ?? 18;
    const lineHeight = Math.max(18, Math.round(fontSize * 1.24));
    const maxChars = Math.max(14, Math.round(42 - fontSize * 0.55));
    const lines = wrapTextLines(element.text, maxChars, 4);
    return (
      <text
        key={element.id}
        x={element.x}
        y={element.y}
        fill={element.style?.strokeColor || '#1E2A34'}
        fontSize={fontSize}
        fontWeight={600}
        fontFamily={theme.fonts.body}>
        {lines.length > 0
          ? lines.map((line, index) => (
              <tspan key={`${element.id}:line:${index}`} x={element.x} dy={index === 0 ? 0 : lineHeight}>
                {line}
              </tspan>
            ))
          : element.text}
      </text>
    );
  }

  if (element.kind === 'rect') {
    const p = [
      jitterPoint(element.x, element.y, `${element.id}:p1`, roughness),
      jitterPoint(element.x + element.w, element.y, `${element.id}:p2`, roughness),
      jitterPoint(element.x + element.w, element.y + element.h, `${element.id}:p3`, roughness),
      jitterPoint(element.x, element.y + element.h, `${element.id}:p4`, roughness),
      jitterPoint(element.x, element.y, `${element.id}:p5`, roughness),
    ] as BoardPoint[];
    return <path key={element.id} d={roughPolyline(p, element.id, roughness)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }

  if (element.kind === 'ellipse') {
    return (
      <ellipse
        key={element.id}
        cx={element.x + element.w / 2}
        cy={element.y + element.h / 2}
        rx={element.w / 2}
        ry={element.h / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (element.kind === 'diamond') {
    const points: BoardPoint[] = [
      [element.x + element.w / 2, element.y],
      [element.x + element.w, element.y + element.h / 2],
      [element.x + element.w / 2, element.y + element.h],
      [element.x, element.y + element.h / 2],
      [element.x + element.w / 2, element.y],
    ];
    return <path key={element.id} d={roughPolyline(points, element.id, roughness)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }

  if (element.kind === 'triangle') {
    const points: BoardPoint[] = [
      [element.x + element.w / 2, element.y],
      [element.x + element.w, element.y + element.h],
      [element.x, element.y + element.h],
      [element.x + element.w / 2, element.y],
    ];
    return <path key={element.id} d={roughPolyline(points, element.id, roughness)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }

  if (element.kind === 'frame') {
    const p = [
      jitterPoint(element.x, element.y, `${element.id}:p1`, roughness),
      jitterPoint(element.x + element.w, element.y, `${element.id}:p2`, roughness),
      jitterPoint(element.x + element.w, element.y + element.h, `${element.id}:p3`, roughness),
      jitterPoint(element.x, element.y + element.h, `${element.id}:p4`, roughness),
      jitterPoint(element.x, element.y, `${element.id}:p5`, roughness),
    ] as BoardPoint[];

    return (
      <g key={element.id}>
        <path
          d={roughPolyline(p, `${element.id}:frame`, roughness)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray="12 8"
        />
        {element.title ? (
          <text
            x={element.x + 10}
            y={element.y - 8}
            fill={element.style?.strokeColor || '#1E2A34'}
            fontSize={element.style?.fontSize ?? 16}
            fontWeight={700}
            fontFamily={theme.fonts.body}>
            {element.title}
          </text>
        ) : null}
      </g>
    );
  }

  if (element.kind === 'sticky') {
    const fold = Math.max(12, Math.min(28, Math.floor(Math.min(element.w, element.h) * 0.16)));
    const stickyFontSize = element.style?.fontSize ?? 16;
    const stickyLineHeight = Math.max(16, Math.round(stickyFontSize * 1.2));
    const stickyMaxChars = Math.max(8, Math.floor((element.w - 24) / Math.max(6, stickyFontSize * 0.54)));
    const stickyMaxLines = Math.max(1, Math.floor((element.h - 28) / stickyLineHeight));
    const stickyLines = wrapTextLines(element.text, stickyMaxChars, Math.min(6, stickyMaxLines));
    const bodyPoints: BoardPoint[] = [
      [element.x, element.y],
      [element.x + element.w - fold, element.y],
      [element.x + element.w, element.y + fold],
      [element.x + element.w, element.y + element.h],
      [element.x, element.y + element.h],
      [element.x, element.y],
    ];
    const foldPoints: BoardPoint[] = [
      [element.x + element.w - fold, element.y],
      [element.x + element.w - fold, element.y + fold],
      [element.x + element.w, element.y + fold],
      [element.x + element.w - fold, element.y],
    ];

    return (
      <g key={element.id}>
        <path
          d={roughPolyline(bodyPoints, `${element.id}:body`, roughness)}
          fill={fill === 'transparent' ? '#fff7c8' : fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
        <path
          d={roughPolyline(foldPoints, `${element.id}:fold`, roughness)}
          fill="#f2dd96"
          stroke={stroke}
          strokeWidth={Math.max(1, strokeWidth - 0.5)}
        />
        <text
          x={element.x + 12}
          y={element.y + 26}
          fill={element.style?.strokeColor || '#1E2A34'}
          fontSize={stickyFontSize}
          fontWeight={600}
          fontFamily={theme.fonts.body}>
          {(stickyLines.length > 0 ? stickyLines : [element.text]).map((line, index) => (
            <tspan key={`${element.id}:sticky:${index}`} x={element.x + 12} dy={index === 0 ? 0 : stickyLineHeight}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  }

  if (element.kind === 'line' || element.kind === 'stroke') {
    return (
      <path
        key={element.id}
        d={roughPolyline(element.points, element.id, roughness)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  if (element.kind === 'arrow') {
    const d = roughPolyline(element.points, element.id, roughness);
    const last = element.points[element.points.length - 1];
    const prev = element.points[element.points.length - 2];
    let arrowHead: ReactElement | null = null;
    if (last && prev) {
      const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
      const size = 12;
      const p1: BoardPoint = [last[0] - size * Math.cos(angle - Math.PI / 6), last[1] - size * Math.sin(angle - Math.PI / 6)];
      const p2: BoardPoint = [last[0] - size * Math.cos(angle + Math.PI / 6), last[1] - size * Math.sin(angle + Math.PI / 6)];
      arrowHead = <path d={`M ${p1[0]} ${p1[1]} L ${last[0]} ${last[1]} L ${p2[0]} ${p2[1]}`} fill="none" stroke={stroke} strokeWidth={strokeWidth} />;
    }
    return (
      <g key={element.id}>
        <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        {arrowHead}
      </g>
    );
  }

  return null;
};

export const CanvasSurface = ({ room, showAiNotes, theme }: CanvasSurfaceProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const [autoCentered, setAutoCentered] = useState(false);

  const orderedElements = useMemo(() => {
    if (!room?.board) {
      return [];
    }
    return room.board.order
      .map((id) => room.board.elements[id])
      .filter((item): item is BoardElement => Boolean(item))
      .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
  }, [room?.board]);

  const renderedElements = useMemo(
    () => orderedElements.map((element) => renderElement(element, theme, showAiNotes)),
    [orderedElements, theme, showAiNotes],
  );

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    setUserMoved(true);
    setPanning(true);
    setPanStart({
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!panning || !panStart) {
      return;
    }
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    setPan({
      x: panStart.panX + dx,
      y: panStart.panY + dy,
    });
  };

  const onMouseUp = () => {
    setPanning(false);
    setPanStart(null);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) {
      return;
    }
    setUserMoved(true);
    event.preventDefault();
    const delta = -event.deltaY;
    const factor = delta > 0 ? 1.08 : 0.92;
    setZoom((previous) => Math.max(0.3, Math.min(3.2, previous * factor)));
  };

  useLayoutEffect(() => {
    if (!viewportRef.current) {
      return;
    }
    if (userMoved || zoom !== 1) {
      return;
    }
    const viewportWidth = viewportRef.current.clientWidth;
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
      return;
    }
    const laneWidth = Math.max(1, SENSEBOARD_AI_CONTENT_MAX_X - SENSEBOARD_AI_CONTENT_MIN_X);
    const desiredX = Math.min(0, Math.round((viewportWidth - laneWidth) / 2 - SENSEBOARD_AI_CONTENT_MIN_X));
    if (!autoCentered || Math.abs(desiredX - pan.x) > 1) {
      setPan((prev) => ({ ...prev, x: desiredX }));
      setAutoCentered(true);
    }
  }, [autoCentered, pan.x, room?.board?.revision, userMoved, zoom]);

  return (
    <div
      ref={viewportRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      style={createCanvasViewportStyle(panning)}>
      <div style={createCanvasBoardStyle(pan.x, pan.y, zoom)}>
        <svg width={CANVAS_BOARD_DIMENSIONS.width} height={CANVAS_BOARD_DIMENSIONS.height} style={canvasSvgStyle}>
          {renderedElements}
        </svg>
      </div>
    </div>
  );
};
