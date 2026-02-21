import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ContextPriority, ContextScope, NoteKind, RoomState } from '../../shared/types';
import { createEmptyBoardState } from '../../shared/board-state';
import { CanvasSurface } from './components/canvas-surface';
import { FloatingOptions } from './components/floating-options';
import { JoinScreen } from './components/join-screen';
import { Sidebar, type SidebarTab } from './components/sidebar';
import { useRoomSocket } from './hooks/use-room-socket';
import { useSpeechTranscript } from './hooks/use-speech-transcript';
import { createRoom, getRoom, transcribeAudioChunk, triggerAiPatch } from './lib/api';
import { THEMES, clampThemeMode, resolveThemeMode, type ThemeMode } from './lib/theme';

interface ContextDraft {
  title: string;
  content: string;
  priority: ContextPriority;
  scope: ContextScope;
  pinned: boolean;
}

const initialContextDraft = (): ContextDraft => ({
  title: '',
  content: '',
  priority: 'normal',
  scope: 'topic',
  pinned: true,
});

const emptyRoomFallback = (roomId: string): RoomState => ({
  id: roomId,
  createdAt: Date.now(),
  members: [],
  transcriptChunks: [],
  chatMessages: [],
  contextItems: [],
  visualHint: '',
  aiConfig: {
    frozen: false,
    focusMode: false,
    focusBox: null,
    pinnedGroupIds: [],
    status: 'idle',
  },
  diagramGroups: {},
  activeGroupId: '',
  archivedGroups: [],
  aiHistory: [],
  lastAiPatchAt: 0,
  lastAiFingerprint: '',
  board: createEmptyBoardState(),
});

const THEME_STORAGE_KEY = 'senseboard.theme.mode';

const getInitialThemeMode = (): ThemeMode => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return 'auto';
  }
  try {
    return clampThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
};

const getInitialPrefersDark = (): boolean => {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export const SenseBoardApp = () => {
  const [displayName, setDisplayName] = useState('Host');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>('transcript');
  const [chatDraft, setChatDraft] = useState('');
  const [chatKind, setChatKind] = useState<NoteKind>('normal');
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [contextDraft, setContextDraft] = useState<ContextDraft>(initialContextDraft);
  const [focusDrawMode, setFocusDrawMode] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showAiNotes, setShowAiNotes] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [prefersDark, setPrefersDark] = useState(getInitialPrefersDark);

  const handleSnapshot = useCallback((snapshot: RoomState) => {
    setRoom(snapshot);
  }, []);

  const handleSocketError = useCallback((message: string) => {
    setError(message);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };
    setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // localStorage might be blocked in private mode; ignore for MVP.
    }
  }, [themeMode]);

  const resolvedTheme = useMemo(() => resolveThemeMode(themeMode, prefersDark), [themeMode, prefersDark]);
  const theme = useMemo(() => THEMES[resolvedTheme], [resolvedTheme]);

  const joinRoomById = useCallback(
    async (nextRoomId: string) => {
      const normalizedRoomId = nextRoomId.trim().toUpperCase();
      if (!normalizedRoomId) {
        setError('Room code is required.');
        return;
      }
      if (!displayName.trim()) {
        setError('Display name is required.');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const fetchedRoom = await getRoom(normalizedRoomId);
        setRoom(fetchedRoom);
        setRoomId(normalizedRoomId);
        setRoomInput(normalizedRoomId);
      } catch (joinError) {
        setError(joinError instanceof Error ? joinError.message : 'Unable to join room.');
      } finally {
        setLoading(false);
      }
    },
    [displayName],
  );

  const onCreateRoom = useCallback(async () => {
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await createRoom();
      setRoom(result.room);
      setRoomId(result.roomId);
      setRoomInput(result.roomId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create room.');
    } finally {
      setLoading(false);
    }
  }, [displayName]);

  const currentRoom = room ?? (roomId ? emptyRoomFallback(roomId) : null);

  const { connected, send } = useRoomSocket({
    roomId,
    displayName,
    enabled: Boolean(roomId),
    onSnapshot: handleSnapshot,
    onError: handleSocketError,
  });

  const pushTranscriptChunk = useCallback(
    (text: string, source: 'mic' | 'manual') => {
      if (!roomId || !text.trim()) {
        return;
      }
      send({
        type: 'transcript:add',
        payload: {
          text: text.trim(),
          source,
        },
      });
    },
    [roomId, send],
  );

  const handleSpeechChunk = useCallback(
    (text: string) => {
      pushTranscriptChunk(text, 'mic');
    },
    [pushTranscriptChunk],
  );

  const handleMicAudioChunk = useCallback(
    async (audioChunk: Blob, mimeType: string) => {
      if (!roomId) {
        return;
      }
      const response = await transcribeAudioChunk(roomId, displayName, audioChunk, mimeType);
      if (!response.ok) {
        throw new Error(response.error || 'Transcription failed.');
      }
    },
    [displayName, roomId],
  );

  const speech = useSpeechTranscript({
    onChunk: handleSpeechChunk,
    onAudioChunk: handleMicAudioChunk,
    chunkMs: 2600,
  });

  useEffect(() => {
    if (speech.error) {
      setError(speech.error);
    }
  }, [speech.error]);

  const runAiPatch = useCallback(
    async (reason: 'tick' | 'correction' | 'context' | 'regenerate' | 'manual', regenerate = false) => {
      if (!roomId) {
        return;
      }
      try {
        await triggerAiPatch(roomId, { reason, regenerate });
      } catch (patchError) {
        setError(patchError instanceof Error ? patchError.message : 'Failed to run AI patch.');
      }
    },
    [roomId],
  );

  useEffect(() => {
    if (!roomId || !currentRoom || currentRoom.aiConfig.frozen) {
      return;
    }
    const timer = setInterval(() => {
      runAiPatch('tick');
    }, 5000);
    return () => clearInterval(timer);
  }, [roomId, currentRoom?.aiConfig.frozen, runAiPatch]);

  const onSendManualTranscript = useCallback(() => {
    if (!transcriptDraft.trim()) {
      return;
    }
    pushTranscriptChunk(transcriptDraft, 'manual');
    setTranscriptDraft('');
  }, [pushTranscriptChunk, transcriptDraft]);

  const onSendChat = useCallback(() => {
    if (!chatDraft.trim()) {
      return;
    }
    send({
      type: 'chat:add',
      payload: {
        text: chatDraft.trim(),
        kind: chatKind,
      },
    });
    const shouldPatchNow = chatKind === 'correction';
    setChatDraft('');
    setChatKind('normal');
    if (shouldPatchNow) {
      setTimeout(() => {
        runAiPatch('correction');
      }, 120);
    }
  }, [chatDraft, chatKind, runAiPatch, send]);

  const onAddContext = useCallback(() => {
    if (!contextDraft.title.trim() && !contextDraft.content.trim()) {
      return;
    }
    send({
      type: 'context:add',
      payload: {
        title: contextDraft.title.trim() || 'Context',
        content: contextDraft.content.trim(),
        priority: contextDraft.priority,
        scope: contextDraft.scope,
        pinned: contextDraft.pinned,
      },
    });
    const shouldPatchNow = contextDraft.pinned || contextDraft.priority === 'high';
    setContextDraft(initialContextDraft());
    if (shouldPatchNow) {
      setTimeout(() => {
        runAiPatch('context');
      }, 120);
    }
  }, [contextDraft, runAiPatch, send]);

  const toggleMic = useCallback(() => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.start();
  }, [speech]);

  const toggleFreeze = useCallback(() => {
    if (!currentRoom) {
      return;
    }
    send({
      type: 'aiConfig:update',
      payload: {
        frozen: !currentRoom.aiConfig.frozen,
      },
    });
  }, [currentRoom, send]);

  const toggleFocusMode = useCallback(() => {
    if (!currentRoom) {
      return;
    }
    if (currentRoom.aiConfig.focusMode || focusDrawMode) {
      setFocusDrawMode(false);
      send({
        type: 'aiConfig:update',
        payload: {
          focusMode: false,
          focusBox: null,
        },
      });
      return;
    }
    setFocusDrawMode(true);
    send({
      type: 'aiConfig:update',
      payload: {
        focusMode: true,
      },
    });
  }, [currentRoom, focusDrawMode, send]);

  const onSetFocusBox = useCallback(
    (focusBox: { x: number; y: number; w: number; h: number }) => {
      send({
        type: 'aiConfig:update',
        payload: {
          focusMode: true,
          focusBox,
        },
      });
    },
    [send],
  );

  const leaveRoom = useCallback(() => {
    speech.stop();
    setRoomId('');
    setRoom(null);
    setError(null);
    setFocusDrawMode(false);
    setDebugPanelOpen(false);
    setPanelsOpen(false);
    setShowOptions(false);
  }, [speech]);

  const totalConnectedMembers = currentRoom?.members.length ?? 0;

  if (!roomId) {
    return (
      <JoinScreen
        displayName={displayName}
        roomId={roomInput}
        error={error}
        loading={loading}
        theme={theme}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        onThemeModeChange={setThemeMode}
        onDisplayNameChange={setDisplayName}
        onRoomIdChange={setRoomInput}
        onCreateRoom={onCreateRoom}
        onJoinRoom={() => {
          void joinRoomById(roomInput);
        }}
      />
    );
  }

  if (!currentRoom) {
    return (
      <View style={[styles.loadingPage, { backgroundColor: theme.colors.appBg }]}>
        <Text style={[styles.loadingText, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>
          Connecting to room {roomId}...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: theme.colors.appBg }]}>
      <View style={styles.main}>
        {Platform.OS === 'web' ? (
          <CanvasSurface
            room={currentRoom}
            focusDrawMode={focusDrawMode}
            onFocusBoxSelected={onSetFocusBox}
            onFocusDrawModeChange={setFocusDrawMode}
            showAiNotes={showAiNotes}
            theme={theme}
          />
        ) : (
          <CanvasSurface unsupportedReason="SenseBoard MVP is web-first for this demo." theme={theme} />
        )}
      </View>

      {panelsOpen ? (
        <View style={styles.sidebarBackdrop}>
          <Pressable
            onPress={() => setPanelsOpen(false)}
            style={[styles.sidebarScrim, { backgroundColor: theme.id === 'dark' ? '#00000066' : '#0B1A2A33' }]}
          />
          <View style={styles.sidebarOverlayWrap}>
            <Sidebar
              room={currentRoom}
              activeTab={activeTab}
              interimTranscript={speech.interimText}
              transcriptDraft={transcriptDraft}
              chatDraft={chatDraft}
              chatKind={chatKind}
              contextDraft={contextDraft}
              theme={theme}
              overlay
              onClose={() => setPanelsOpen(false)}
              onTabChange={setActiveTab}
              onTranscriptDraftChange={setTranscriptDraft}
              onSendManualTranscript={onSendManualTranscript}
              onChatDraftChange={setChatDraft}
              onChatKindChange={setChatKind}
              onSendChat={onSendChat}
              onContextDraftChange={setContextDraft}
              onAddContext={onAddContext}
            />
          </View>
        </View>
      ) : null}

      <View style={[styles.statusPill, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
        <Text style={[styles.statusText, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>Room {roomId}</Text>
        <Text style={[styles.statusSubText, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>
          Current user: {displayName || 'Guest'}
        </Text>
        <Text style={[styles.statusSubText, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>
          Total members connected: {totalConnectedMembers}
        </Text>
        <Text style={[styles.statusSubText, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>
          {connected ? 'Connected' : 'Reconnecting'} | AI {currentRoom.aiConfig.status}
        </Text>
      </View>

      <FloatingOptions
        open={showOptions}
        panelsOpen={panelsOpen}
        micListening={speech.listening}
        micSupported={speech.supported}
        freezeAi={currentRoom.aiConfig.frozen}
        focusMode={currentRoom.aiConfig.focusMode || focusDrawMode}
        showAiNotes={showAiNotes}
        chatHistory={currentRoom.chatMessages}
        archivedCount={currentRoom.archivedGroups.length}
        debugPanelOpen={debugPanelOpen}
        themeMode={themeMode}
        theme={theme}
        onToggleOpen={() => setShowOptions((value) => !value)}
        onTogglePanels={() => setPanelsOpen((value) => !value)}
        onToggleMic={toggleMic}
        onToggleFreeze={toggleFreeze}
        onPinDiagram={() => {
          send({ type: 'diagram:pinCurrent', payload: {} });
        }}
        onToggleFocusMode={toggleFocusMode}
        onRegenerate={() => {
          void runAiPatch('regenerate', true);
        }}
        onClearBoard={() => {
          send({ type: 'diagram:clearBoard', payload: {} });
        }}
        onUndoAi={() => {
          send({ type: 'diagram:undoAi', payload: {} });
        }}
        onRestoreArchived={() => {
          send({ type: 'diagram:restoreArchived', payload: {} });
        }}
        onToggleShowAiNotes={() => setShowAiNotes((value) => !value)}
        onThemeModeChange={setThemeMode}
        onSendQuickChat={(text) => {
          send({
            type: 'chat:add',
            payload: {
              text,
              kind: 'correction',
            },
          });
          setTimeout(() => {
            void runAiPatch('correction');
          }, 120);
        }}
        onToggleDebugPanel={() => setDebugPanelOpen((value) => !value)}
        onLeaveRoom={leaveRoom}
      />

      {debugPanelOpen ? (
        <View style={[styles.debugPanel, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
          <Text style={[styles.debugTitle, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>Debug</Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Active group: {currentRoom.activeGroupId}
          </Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Pinned groups: {currentRoom.aiConfig.pinnedGroupIds.length}
          </Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Transcript chunks: {currentRoom.transcriptChunks.length}
          </Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Chat messages: {currentRoom.chatMessages.length}
          </Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Context items: {currentRoom.contextItems.length}
          </Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Diagram groups: {Object.keys(currentRoom.diagramGroups).length}
          </Text>
          <Text style={[styles.debugBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono }]}>
            Archived groups: {currentRoom.archivedGroups.length}
          </Text>
          {error ? <Text style={[styles.debugError, { color: theme.colors.danger, fontFamily: theme.fonts.body }]}>Error: {error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  main: {
    flex: 1,
  },
  sidebarBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  sidebarScrim: {
    flex: 1,
  },
  sidebarOverlayWrap: {
    width: 420,
    maxWidth: '95%',
    height: '100%',
    paddingLeft: 10,
    paddingTop: 10,
    paddingBottom: 10,
  },
  loadingPage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    maxWidth: 620,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusSubText: {
    fontSize: 12,
  },
  debugPanel: {
    position: 'absolute',
    left: 12,
    bottom: 52,
    width: 320,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  debugTitle: {
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  debugBody: {
    fontSize: 12,
  },
  debugError: {
    marginTop: 4,
    fontSize: 12,
  },
});
