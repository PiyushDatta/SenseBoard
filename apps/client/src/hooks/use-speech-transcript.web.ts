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

const DEFAULT_CHUNK_MS = 2600;

const pickMediaMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const type of preferred) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
};

export const useSpeechTranscript = ({ onChunk, onAudioChunk, chunkMs = DEFAULT_CHUNK_MS }: Options): SpeechTranscriptController => {
  const SpeechRecognitionConstructor =
    typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
  const supportsMediaRecorder =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';
  const shouldUseAudioUpload = Boolean(onAudioChunk) && supportsMediaRecorder;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shouldKeepListening = useRef(false);
  const onChunkRef = useRef(onChunk);
  const onAudioChunkRef = useRef(onAudioChunk);
  const bufferedFinalRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadQueueRef = useRef<Array<{ blob: Blob; mimeType: string }>>([]);
  const uploadRunningRef = useRef(false);
  const lastEmittedRef = useRef('');
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const processUploadQueue = useCallback(async () => {
    if (uploadRunningRef.current) {
      return;
    }
    uploadRunningRef.current = true;
    try {
      while (uploadQueueRef.current.length > 0) {
        const next = uploadQueueRef.current.shift();
        if (!next || !onAudioChunkRef.current) {
          continue;
        }
        try {
          await onAudioChunkRef.current(next.blob, next.mimeType);
        } catch {
          setError('Audio transcription request failed.');
        }
      }
    } finally {
      uploadRunningRef.current = false;
    }
  }, []);

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

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
    if (!SpeechRecognitionConstructor || shouldUseAudioUpload) {
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
  }, [SpeechRecognitionConstructor, flushBufferedFinal, shouldUseAudioUpload]);

  const start = useCallback(() => {
    if (shouldUseAudioUpload) {
      const beginRecording = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mimeType = pickMediaMimeType();
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          streamRef.current = stream;
          recorderRef.current = recorder;

          recorder.ondataavailable = (event) => {
            if (!event.data || event.data.size === 0) {
              return;
            }
            const type = recorder.mimeType || event.data.type || 'audio/webm';
            uploadQueueRef.current.push({ blob: event.data, mimeType: type });
            void processUploadQueue();
          };

          recorder.onerror = () => {
            setError('Unable to read microphone audio stream.');
            setListening(false);
            setInterimText('');
            stopMediaStream();
          };

          recorder.onstop = () => {
            setInterimText('');
            setListening(false);
            stopMediaStream();
          };

          const cadenceMs = Math.max(1200, Math.floor(chunkMs));
          recorder.start(cadenceMs);
          setListening(true);
          setInterimText('Listening...');
          setError(null);
        } catch {
          setError('Unable to start microphone transcription.');
          setListening(false);
          setInterimText('');
          stopMediaStream();
        }
      };
      void beginRecording();
      return;
    }

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
  }, [chunkMs, processUploadQueue, shouldUseAudioUpload, stopMediaStream]);

  const stop = useCallback(() => {
    if (recorderRef.current) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.requestData();
        } catch {
          // ignore requestData failures while stopping
        }
        recorder.stop();
      }
      setListening(false);
      setInterimText('');
      return;
    }

    shouldKeepListening.current = false;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushBufferedFinal();
    recognitionRef.current?.stop();
    setListening(false);
    setInterimText('');
  }, [flushBufferedFinal]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      recorderRef.current = null;
      stopMediaStream();
    };
  }, [stopMediaStream]);

  return useMemo(
    () => ({
      supported: Boolean(shouldUseAudioUpload || SpeechRecognitionConstructor),
      listening,
      interimText,
      error,
      start,
      stop,
    }),
    [SpeechRecognitionConstructor, error, interimText, listening, shouldUseAudioUpload, start, stop],
  );
};
