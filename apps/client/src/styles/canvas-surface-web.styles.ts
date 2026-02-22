import type { CSSProperties } from 'react';

export const createCanvasViewportStyle = (): CSSProperties => ({
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: '#FAFBFC',
});
