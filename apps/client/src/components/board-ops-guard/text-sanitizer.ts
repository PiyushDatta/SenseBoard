import { MAX_TEXT_LENGTH } from './constants';

const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g;

export interface SanitizeTextOptions {
  allowEmpty?: boolean;
}

export interface SanitizedTextResult {
  text: string;
  changed: boolean;
  empty: boolean;
  rejected: boolean;
}

export const sanitizeBoardText = (
  value: unknown,
  options?: SanitizeTextOptions,
): SanitizedTextResult | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalizedLineEndings = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutControlChars = normalizedLineEndings.replace(CONTROL_CHAR_PATTERN, '');
  const truncated = withoutControlChars.slice(0, MAX_TEXT_LENGTH);
  const empty = truncated.trim().length === 0;
  const text = empty ? '' : truncated;
  const changed = text !== value;
  const rejected = empty && options?.allowEmpty !== true;
  return {
    text,
    changed,
    empty,
    rejected,
  };
};
