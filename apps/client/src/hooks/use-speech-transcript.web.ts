import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

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

export const useSpeechTranscript = ({ onChunk }: Options): SpeechTranscriptController => {
  const SpeechRecognitionConstructor =
    typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldKeepListening = useRef(false);
  const onChunkRef = useRef(onChunk);
  const bufferedFinalRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef('');
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  const flushBufferedFinal = useCallback(() => {
    const text = bufferedFinalRef.current.trim().replace(/\s+/g, ' ');
    bufferedFinalRef.current = '';
    if (!text) {
      return;
    }
    if (lastEmittedRef.current === text) {
      return;
    }
    lastEmittedRef.current = text;
    onChunkRef.current(text);
  }, []);

  useEffect(() => {
    if (!SpeechRecognitionConstructor) {
      return;
    }
    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      let committed = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) {
          continue;
        }
        if (result.isFinal) {
          committed += `${transcript} `;
        } else {
          interim += `${transcript} `;
        }
      }
      setInterimText(interim.trim());
      if (committed.trim()) {
        bufferedFinalRef.current = `${bufferedFinalRef.current} ${committed}`.trim();
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
        }
        flushTimerRef.current = setTimeout(() => {
          flushBufferedFinal();
        }, 900);
      }
    };

    recognition.onerror = (event) => {
      setError(event.error);
      setListening(false);
    };

    recognition.onend = () => {
      setInterimText('');
      if (shouldKeepListening.current) {
        try {
          recognition.start();
        } catch {
          setListening(false);
        }
      } else {
        flushBufferedFinal();
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      shouldKeepListening.current = false;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushBufferedFinal();
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [SpeechRecognitionConstructor, flushBufferedFinal]);

  const start = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }
    try {
      shouldKeepListening.current = true;
      bufferedFinalRef.current = '';
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      recognitionRef.current.start();
      setListening(true);
      setError(null);
    } catch {
      setError('Unable to start microphone transcription.');
    }
  }, []);

  const stop = useCallback(() => {
    shouldKeepListening.current = false;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushBufferedFinal();
    recognitionRef.current?.stop();
    setListening(false);
  }, [flushBufferedFinal]);

  return useMemo(
    () => ({
      supported: Boolean(SpeechRecognitionConstructor),
      listening,
      interimText,
      error,
      start,
      stop,
    }),
    [SpeechRecognitionConstructor, listening, interimText, error, start, stop],
  );
};
