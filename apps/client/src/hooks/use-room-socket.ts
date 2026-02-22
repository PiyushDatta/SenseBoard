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
  const handshakeAckedRef = useRef(false);
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const snapshotHandlerRef = useRef(onSnapshot);
  const errorHandlerRef = useRef(onError);
  const [connected, setConnected] = useState(false);
  const MAX_PENDING_MESSAGES = 200;

  useEffect(() => {
    snapshotHandlerRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    errorHandlerRef.current = onError;
  }, [onError]);

  const endpointCandidates = useMemo(() => {
    const normalizedName = displayName.trim();
    if (!roomId || !normalizedName) {
      return [] as string[];
    }
    const params = new URLSearchParams({
      roomId: roomId.toUpperCase(),
      name: normalizedName,
    });
    return WS_URL_CANDIDATES.map((baseUrl) => `${baseUrl}/ws?${params.toString()}`);
  }, [roomId, displayName]);

  const flushPendingMessages = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !handshakeAckedRef.current) {
      return;
    }
    while (pendingMessagesRef.current.length > 0) {
      const next = pendingMessagesRef.current.shift();
      if (!next) {
        continue;
      }
      ws.send(JSON.stringify(next));
    }
  }, []);

  useEffect(() => {
    endpointIndexRef.current = 0;
    handshakeAckedRef.current = false;
    pendingMessagesRef.current = [];
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
      let handshakeAckedOnThisSocket = false;
      const connectWatchdog = setTimeout(() => {
        if (!opened && ws.readyState !== WebSocket.OPEN) {
          ws.close();
        }
      }, 1200);
      let handshakeWatchdog: ReturnType<typeof setTimeout> | null = null;

      wsRef.current = ws;

      ws.onopen = () => {
        opened = true;
        failedAttempts = 0;
        clearTimeout(connectWatchdog);
        setConnected(false);
        handshakeAckedRef.current = false;
        const ack: ClientMessage = {
          type: 'client:ack',
          payload: {
            protocol: 'senseboard-ws-v1',
            sentAt: Date.now(),
          },
        };
        ws.send(JSON.stringify(ack));
        handshakeWatchdog = setTimeout(() => {
          if (!handshakeAckedOnThisSocket && ws.readyState === WebSocket.OPEN) {
            errorHandlerRef.current('Realtime handshake timed out; trying next server port...');
            ws.close();
          }
        }, 1500);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.type === 'server:ack') {
            handshakeAckedOnThisSocket = true;
            handshakeAckedRef.current = true;
            setConnected(true);
            if (handshakeWatchdog) {
              clearTimeout(handshakeWatchdog);
              handshakeWatchdog = null;
            }
            flushPendingMessages();
            return;
          }
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
        if (handshakeWatchdog) {
          clearTimeout(handshakeWatchdog);
          handshakeWatchdog = null;
        }
        setConnected(false);
        handshakeAckedRef.current = false;
        if (!disposed) {
          if (!opened || !handshakeAckedOnThisSocket) {
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
      handshakeAckedRef.current = false;
      pendingMessagesRef.current = [];
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, endpointCandidates, flushPendingMessages]);

  const send = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!handshakeAckedRef.current) {
      while (pendingMessagesRef.current.length >= MAX_PENDING_MESSAGES) {
        pendingMessagesRef.current.shift();
      }
      pendingMessagesRef.current.push(message);
      return true;
    }
    ws.send(JSON.stringify(message));
    return true;
  }, [MAX_PENDING_MESSAGES]);

  return {
    connected,
    send,
  };
};
