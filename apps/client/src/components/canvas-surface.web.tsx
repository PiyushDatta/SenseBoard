import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Tldraw,
  createShapeId,
  toRichText,
  type Editor,
  type TLCreateShapePartial,
  type TLLineShapePoint,
  type TLShape,
  type TLShapeId,
} from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';

import { SENSEBOARD_AI_CONTENT_MAX_X, SENSEBOARD_AI_CONTENT_MIN_X } from '../../../shared/board-dimensions';
import type { RoomState } from '../../../shared/types';
import type { SenseTheme } from '../lib/theme';
import { createCanvasViewportStyle } from '../styles/canvas-surface-web.styles';
import { boardToTldrawDraftShapes, type TldrawDraftShape } from './canvas-surface.tldraw-adapter';

export interface CanvasSurfaceProps {
  room: RoomState | null;
  focusDrawMode: boolean;
  onFocusBoxSelected: (_box: { x: number; y: number; w: number; h: number }) => void;
  onFocusDrawModeChange: (_value: boolean) => void;
  showAiNotes: boolean;
  theme: SenseTheme;
}

const toLinePointsRecord = (points: Array<{ id: string; index: string; x: number; y: number }>): Record<string, TLLineShapePoint> => {
  return points.reduce<Record<string, TLLineShapePoint>>((acc, point) => {
    acc[point.id] = {
      id: point.id,
      index: point.index as TLLineShapePoint['index'],
      x: point.x,
      y: point.y,
    };
    return acc;
  }, {});
};

const toTlShapePartial = (draft: TldrawDraftShape): TLCreateShapePartial<TLShape> => {
  const id = createShapeId(draft.id);

  if (draft.kind === 'geo') {
    return {
      id,
      type: 'geo',
      x: draft.x,
      y: draft.y,
      props: {
        geo: draft.props.geo,
        dash: draft.props.dash,
        url: '',
        w: draft.props.w,
        h: draft.props.h,
        growY: 0,
        scale: 1,
        labelColor: draft.props.labelColor,
        color: draft.props.color,
        fill: draft.props.fill,
        size: draft.props.size,
        font: 'draw',
        align: draft.props.align,
        verticalAlign: draft.props.verticalAlign,
        richText: toRichText(draft.props.text),
      },
    };
  }

  if (draft.kind === 'frame') {
    return {
      id,
      type: 'frame',
      x: draft.x,
      y: draft.y,
      props: {
        w: draft.props.w,
        h: draft.props.h,
        name: draft.props.name,
        color: draft.props.color,
      },
    };
  }

  if (draft.kind === 'text') {
    return {
      id,
      type: 'text',
      x: draft.x,
      y: draft.y,
      props: {
        color: draft.props.color,
        size: draft.props.size,
        font: 'draw',
        textAlign: 'start',
        w: draft.props.w,
        richText: toRichText(draft.props.text),
        scale: 1,
        autoSize: draft.props.autoSize,
      },
    };
  }

  if (draft.kind === 'line') {
    return {
      id,
      type: 'line',
      x: draft.x,
      y: draft.y,
      props: {
        color: draft.props.color,
        dash: draft.props.dash,
        size: draft.props.size,
        spline: draft.props.spline,
        points: toLinePointsRecord(draft.props.points),
        scale: 1,
      },
    };
  }

  return {
    id,
    type: 'arrow',
    x: draft.x,
    y: draft.y,
    props: {
      kind: draft.props.kind,
      labelColor: draft.props.color,
      color: draft.props.color,
      fill: draft.props.fill,
      dash: draft.props.dash,
      size: draft.props.size,
      arrowheadStart: draft.props.arrowheadStart,
      arrowheadEnd: draft.props.arrowheadEnd,
      font: 'draw',
      start: draft.props.start,
      end: draft.props.end,
      bend: 0,
      richText: toRichText(''),
      labelPosition: 0.5,
      scale: 1,
      elbowMidPoint: 0.5,
    },
  };
};

const syncBoardIntoEditor = (editor: Editor, drafts: TldrawDraftShape[]) => {
  const currentIds = Array.from(editor.getCurrentPageShapeIds()) as TLShapeId[];
  const nextShapes = drafts.map(toTlShapePartial);

  editor.run(
    () => {
      if (currentIds.length > 0) {
        editor.deleteShapes(currentIds);
      }
      if (nextShapes.length > 0) {
        editor.createShapes(nextShapes);
      }
      editor.selectNone();
      editor.setCurrentTool('hand');
    },
    { history: 'ignore' },
  );
};

const centerCameraOnAiLane = (editor: Editor) => {
  const container = editor.getContainer();
  const viewportWidth = container?.clientWidth ?? 0;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return;
  }

  const laneWidth = Math.max(1, SENSEBOARD_AI_CONTENT_MAX_X - SENSEBOARD_AI_CONTENT_MIN_X);
  const x = Math.min(0, Math.round((viewportWidth - laneWidth) / 2 - SENSEBOARD_AI_CONTENT_MIN_X));
  editor.setCamera({ x, y: 0, z: 1 }, { force: true });
};

export const CanvasSurface = ({ room, showAiNotes, theme }: CanvasSurfaceProps) => {
  const editorRef = useRef<Editor | null>(null);
  const centeredRef = useRef(false);

  const drafts = useMemo(() => boardToTldrawDraftShapes(room?.board, showAiNotes), [room?.board, showAiNotes]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      syncBoardIntoEditor(editor, drafts);

      if (!centeredRef.current) {
        centerCameraOnAiLane(editor);
        centeredRef.current = true;
      }

      return () => {
        if (editorRef.current === editor) {
          editorRef.current = null;
        }
      };
    },
    [drafts],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    syncBoardIntoEditor(editor, drafts);
  }, [drafts]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || centeredRef.current) {
      return;
    }
    centerCameraOnAiLane(editor);
    centeredRef.current = true;
  }, [room?.board?.revision]);

  return (
    <div style={createCanvasViewportStyle()}>
      <Tldraw hideUi={true} autoFocus={false} inferDarkMode={theme.id === 'dark'} onMount={handleMount} />
    </div>
  );
};
