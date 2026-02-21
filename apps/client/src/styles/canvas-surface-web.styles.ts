import type { CSSProperties } from 'react';

const BOARD_WIDTH = 9000;
const BOARD_HEIGHT = 6000;

export const CANVAS_BOARD_DIMENSIONS = {
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
} as const;

export const createCanvasViewportStyle = (panning: boolean): CSSProperties => ({
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: '#FAFBFC',
  cursor: panning ? 'grabbing' : 'grab',
});

export const createCanvasBoardStyle = (panX: number, panY: number, zoom: number): CSSProperties => ({
  transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
  transformOrigin: '0 0',
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
  background: '#FDFEFE',
});

export const canvasSvgStyle: CSSProperties = {
  display: 'block',
};
