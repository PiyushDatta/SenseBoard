export const DRAG_THRESHOLD_PX = 4;

export const isDragGesture = (dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): boolean => {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
};

export const shouldToggleOptionsOnPress = (draggedInCurrentGesture: boolean): boolean => {
  return !draggedInCurrentGesture;
};

