import { useMemo } from 'react';

interface Options {
  onChunk: (text: string) => void;
}

export interface SpeechTranscriptController {
  supported: boolean;
  listening: boolean;
  interimText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export const useSpeechTranscript = (_options: Options): SpeechTranscriptController => {
  return useMemo(
    () => ({
      supported: false,
      listening: false,
      interimText: '',
      error: 'Web Speech API is only available on web browsers.',
      start: () => {},
      stop: () => {},
    }),
    [],
  );
};

