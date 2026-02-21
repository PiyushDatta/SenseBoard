import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientMessage, RoomState, ServerMessage } from '../../../shared/types';
import { WS_URL_CANDIDATES } from '../lib/config';

interface UseRoomSocketOptions {
  roomId: string;
  displayName: string;
  enabled: boolean;
  onSnapshot: (room: RoomState) => void;
  onError: (message: string) => void;
}

export const useRoomSocket = ({
  roomId,
  displayName,
  enabled,
  onSnapshot,
  onError,
}: UseRoomSocketOptions) => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpointIndexRef = useRef(0);
  const snapshotHandlerRef = useRef(onSnapshot);
  const errorHandlerRef = useRef(onError);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    snapshotHandlerRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    errorHandlerRef.current = onError;
  }, [onError]);

  const endpointCandidates = useMemo(() => {
    if (!roomId) {
      return [] as string[];
    }
    const params = new URLSearchParams({
      roomId: roomId.toUpperCase(),
      name: displayName || 'Guest',
    });
    return WS_URL_CANDIDATES.map((baseUrl) => `${baseUrl}/ws?${params.toString()}`);
  }, [roomId, displayName]);

  useEffect(() => {
    endpointIndexRef.current = 0;
  }, [roomId, displayName]);

  useEffect(() => {
    if (!enabled || endpointCandidates.length === 0) {
      return;
    }

    let disposed = false;
    let failedAttempts = 0;

    const connect = () => {
      if (disposed) {
        return;
      }
      const endpointIndex = endpointIndexRef.current % endpointCandidates.length;
      const endpoint = endpointCandidates[endpointIndex]!;
      const ws = new WebSocket(endpoint);
      let opened = false;
      const connectWatchdog = setTimeout(() => {
        if (!opened && ws.readyState !== WebSocket.OPEN) {
          ws.close();
        }
      }, 1200);

      wsRef.current = ws;

      ws.onopen = () => {
        opened = true;
        failedAttempts = 0;
        clearTimeout(connectWatchdog);
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.type === 'room:snapshot') {
            snapshotHandlerRef.current(message.payload);
            return;
          }
          if (message.type === 'room:error') {
            errorHandlerRef.current(message.payload.message);
          }
        } catch {
          errorHandlerRef.current('Received invalid realtime payload.');
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onclose = () => {
        clearTimeout(connectWatchdog);
        setConnected(false);
        if (!disposed) {
          if (!opened) {
            failedAttempts += 1;
            endpointIndexRef.current = (endpointIndex + 1) % endpointCandidates.length;
            if (failedAttempts % endpointCandidates.length === 0) {
              errorHandlerRef.current('Realtime reconnecting across fallback server ports...');
            }
          }
          reconnectTimer.current = setTimeout(connect, opened ? 1000 : 250);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, endpointCandidates]);

  const send = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(message));
    return true;
  }, []);

  return {
    connected,
    send,
  };
};
