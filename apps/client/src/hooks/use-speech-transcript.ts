import { useMemo } from 'react';

interface Options {
  onChunk: (text: string) => void;
  onAudioChunk?: (audioChunk: Blob, mimeType: string) => Promise<void> | void;
  chunkMs?: number;
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
      error: 'Microphone transcription is only available on web browsers.',
      start: () => {},
      stop: () => {},
    }),
    [],
  );
};
