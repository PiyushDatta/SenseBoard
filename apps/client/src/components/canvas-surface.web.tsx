import type { MouseEvent } from 'react';
import { useMemo, useState } from 'react';

import type { FocusBox, RoomState } from '../../../shared/types';
import type { SenseTheme } from '../lib/theme';

export interface CanvasSurfaceProps {
  room: RoomState | null;
  focusDrawMode: boolean;
  onFocusBoxSelected: (box: FocusBox) => void;
  onFocusDrawModeChange: (value: boolean) => void;
  theme: SenseTheme;
}

interface EdgeRender {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
}

const WORKSPACE_MIN_WIDTH = 1900;
const WORKSPACE_MIN_HEIGHT = 1100;

const toWorkspaceBounds = (room: RoomState) => {
  let maxX = WORKSPACE_MIN_WIDTH;
  let maxY = WORKSPACE_MIN_HEIGHT;

  for (const group of Object.values(room.diagramGroups)) {
    maxX = Math.max(maxX, group.bounds.x + group.bounds.w + 360);
    maxY = Math.max(maxY, group.bounds.y + group.bounds.h + 180);
  }
  if (room.aiConfig.focusMode && room.aiConfig.focusBox) {
    maxX = Math.max(maxX, room.aiConfig.focusBox.x + room.aiConfig.focusBox.w + 100);
    maxY = Math.max(maxY, room.aiConfig.focusBox.y + room.aiConfig.focusBox.h + 100);
  }

  return {
    width: Math.ceil(maxX),
    height: Math.ceil(maxY),
  };
};

const collectEdges = (room: RoomState): EdgeRender[] => {
  const edges: EdgeRender[] = [];
  for (const group of Object.values(room.diagramGroups)) {
    for (const edge of Object.values(group.edges)) {
      const from = group.nodes[edge.from];
      const to = group.nodes[edge.to];
      if (!from || !to) {
        continue;
      }
      edges.push({
        id: `${group.id}_${edge.id}`,
        fromX: group.bounds.x + from.x + from.width / 2,
        fromY: group.bounds.y + from.y + from.height / 2,
        toX: group.bounds.x + to.x + to.width / 2,
        toY: group.bounds.y + to.y + to.height / 2,
        label: edge.label,
      });
    }
  }
  return edges;
};

export const CanvasSurface = ({
  room,
  focusDrawMode,
  onFocusBoxSelected,
  onFocusDrawModeChange,
  theme,
}: CanvasSurfaceProps) => {
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const workspace = useMemo(() => {
    if (!room) {
      return { width: WORKSPACE_MIN_WIDTH, height: WORKSPACE_MIN_HEIGHT };
    }
    return toWorkspaceBounds(room);
  }, [room]);

  const edges = useMemo(() => (room ? collectEdges(room) : []), [room]);

  const draftBox = useMemo(() => {
    if (!dragStart || !dragCurrent) {
      return null;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    return { x, y, w, h };
  }, [dragCurrent, dragStart]);

  const getWorkspacePoint = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left + target.scrollLeft,
      y: event.clientY - bounds.top + target.scrollTop,
    };
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!focusDrawMode) {
      return;
    }
    const point = getWorkspacePoint(event);
    setDragStart(point);
    setDragCurrent(point);
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!focusDrawMode || !dragStart) {
      return;
    }
    setDragCurrent(getWorkspacePoint(event));
  };

  const finalizeFocusBox = () => {
    if (!focusDrawMode || !dragStart || !dragCurrent) {
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.max(120, Math.abs(dragCurrent.x - dragStart.x));
    const h = Math.max(120, Math.abs(dragCurrent.y - dragStart.y));
    onFocusBoxSelected({
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
    });
    onFocusDrawModeChange(false);
    setDragStart(null);
    setDragCurrent(null);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={finalizeFocusBox}
      onMouseLeave={finalizeFocusBox}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: `radial-gradient(circle at 12% 8%, ${theme.colors.panel} 0%, ${theme.colors.canvasBg} 45%, ${theme.colors.appBgSoft} 100%)`,
        boxShadow: `inset 0 0 0 1px ${theme.colors.panelBorder}`,
        cursor: focusDrawMode ? 'crosshair' : 'default',
        transition: 'background 240ms ease',
      }}>
      <div
        style={{
          position: 'relative',
          width: workspace.width,
          height: workspace.height,
          backgroundImage: `linear-gradient(${theme.colors.canvasGrid} 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.canvasGrid} 1px, transparent 1px)`,
          backgroundSize: '44px 44px',
        }}>
        <svg
          width={workspace.width}
          height={workspace.height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <defs>
            <marker
              id="senseboard-arrow-head"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill={theme.colors.nodeBorder} />
            </marker>
          </defs>
          {edges.map((edge) => (
            <g key={edge.id}>
              <line
                x1={edge.fromX}
                y1={edge.fromY}
                x2={edge.toX}
                y2={edge.toY}
                stroke={theme.colors.nodeBorder}
                strokeWidth={2.2}
                markerEnd="url(#senseboard-arrow-head)"
              />
              {edge.label ? (
                <text
                  x={(edge.fromX + edge.toX) / 2}
                  y={(edge.fromY + edge.toY) / 2 - 8}
                  fill={theme.colors.textMuted}
                  fontSize={12}
                  fontWeight={600}
                  textAnchor="middle">
                  {edge.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>

        {room
          ? Object.values(room.diagramGroups).map((group) => {
              const highlights = new Map(group.highlightOrder.map((id, index) => [id, index]));
              return (
                <div key={group.id}>
                  <div
                    style={{
                      position: 'absolute',
                      left: group.bounds.x,
                      top: group.bounds.y,
                      width: group.bounds.w,
                      height: group.bounds.h,
                      border: `2px ${group.pinned ? 'dashed' : 'solid'} ${
                        group.pinned ? theme.colors.accent : theme.colors.nodeBorder
                      }`,
                      borderRadius: 16,
                      background: group.pinned ? `${theme.colors.accentSoft}60` : `${theme.colors.panel}AA`,
                      boxShadow: `0 8px 26px ${theme.colors.appBgSoft}`,
                      transition: 'all 220ms ease',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: group.bounds.x,
                      top: group.bounds.y - 62,
                      minWidth: 240,
                      maxWidth: 560,
                      borderRadius: 14,
                      border: `1px solid ${theme.colors.panelBorder}`,
                      background: theme.colors.panel,
                      color: theme.colors.textPrimary,
                      fontWeight: 700,
                      fontSize: 19,
                      fontFamily: theme.fonts.heading,
                      padding: '12px 14px',
                      letterSpacing: '0.3px',
                    }}>
                    {group.title || group.topic}
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: group.bounds.x + group.bounds.w + 24,
                      top: group.bounds.y,
                      width: 290,
                      minHeight: 150,
                      borderRadius: 14,
                      border: `1px solid ${theme.colors.panelBorder}`,
                      background: theme.colors.panelMuted,
                      color: theme.colors.textSecondary,
                      padding: 12,
                      fontSize: 13,
                      fontFamily: theme.fonts.body,
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.35,
                      boxShadow: `0 6px 20px ${theme.colors.appBgSoft}`,
                    }}>
                    {(group.notes.length > 0 ? group.notes : ['AI notes will appear here.']).join('\n')}
                  </div>

                  {group.highlightOrder.length > 0 ? (
                    <div
                      style={{
                        position: 'absolute',
                        left: group.bounds.x + group.bounds.w + 24,
                        top: group.bounds.y + 170,
                        width: 290,
                        borderRadius: 12,
                        border: `1px solid ${theme.colors.nodeHighlightBorder}`,
                        background: theme.colors.nodeHighlightBg,
                        color: theme.colors.warning,
                        padding: 11,
                        fontSize: 12,
                        fontFamily: theme.fonts.mono,
                        whiteSpace: 'pre-wrap',
                      }}>
                      Traversal order:{'\n'}
                      {group.highlightOrder.join(' -> ')}
                    </div>
                  ) : null}

                  {Object.values(group.nodes).map((node) => {
                    const index = highlights.get(node.id);
                    const highlighted = typeof index === 'number';
                    return (
                      <div
                        key={`${group.id}_${node.id}`}
                        style={{
                          position: 'absolute',
                          left: group.bounds.x + node.x,
                          top: group.bounds.y + node.y,
                          width: node.width,
                          height: node.height,
                          borderRadius: 13,
                          border: `2px solid ${highlighted ? theme.colors.nodeHighlightBorder : theme.colors.nodeBorder}`,
                          background: highlighted ? theme.colors.nodeHighlightBg : theme.colors.nodeBg,
                          color: theme.colors.textPrimary,
                          fontWeight: 700,
                          fontSize: 15,
                          fontFamily: theme.fonts.heading,
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          textAlign: 'center',
                          padding: 6,
                          boxSizing: 'border-box',
                          boxShadow: `0 5px 16px ${theme.colors.appBgSoft}`,
                          transition: 'all 220ms ease',
                        }}>
                        {highlighted ? `${index + 1}. ${node.label}` : node.label}
                      </div>
                    );
                  })}
                </div>
              );
            })
          : null}

        {room?.aiConfig.focusMode && room.aiConfig.focusBox ? (
          <div
            style={{
              position: 'absolute',
              left: room.aiConfig.focusBox.x,
              top: room.aiConfig.focusBox.y,
              width: room.aiConfig.focusBox.w,
              height: room.aiConfig.focusBox.h,
              border: `2px dashed ${theme.colors.accent}`,
              background: `${theme.colors.accentSoft}70`,
              borderRadius: 8,
              pointerEvents: 'none',
            }}
          />
        ) : null}

        {focusDrawMode && draftBox ? (
          <div
            style={{
              position: 'absolute',
              left: draftBox.x,
              top: draftBox.y,
              width: draftBox.w,
              height: draftBox.h,
              border: `2px dashed ${theme.colors.accent}`,
              background: `${theme.colors.accentSoft}A0`,
              borderRadius: 8,
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </div>
    </div>
  );
};
