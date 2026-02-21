import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import type { NoteKind, RoomState } from '../../shared/types';
import { CanvasSurface } from './components/canvas-surface';
import { DebugPanel } from './components/debug-panel';
import { FloatingOptions } from './components/floating-options';
import { JoinScreen } from './components/join-screen';
import { RoomStatusPill } from './components/room-status-pill';
import { Sidebar, type SidebarTab } from './components/sidebar';
import { useRoomSocket } from './hooks/use-room-socket';
import { useSpeechTranscript } from './hooks/use-speech-transcript';
import { useThemeMode } from './hooks/use-theme-mode';
import { createRoom, getRoom, transcribeAudioChunk, triggerAiPatch } from './lib/api';
import { createEmptyRoomFallback, createInitialContextDraft, type ContextDraft } from './lib/room-ui-state';
import { createSenseBoardAppThemeStyles, senseboardAppStyles } from './styles/senseboard-app.styles';

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
  const [contextDraft, setContextDraft] = useState<ContextDraft>(createInitialContextDraft);
  const [focusDrawMode, setFocusDrawMode] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showAiNotes, setShowAiNotes] = useState(true);

  const { themeMode, setThemeMode, resolvedTheme, theme } = useThemeMode();
  const appThemeStyles = createSenseBoardAppThemeStyles(theme);

  const handleSnapshot = useCallback((snapshot: RoomState) => {
    setRoom(snapshot);
  }, []);

  const handleSocketError = useCallback((message: string) => {
    setError(message);
  }, []);

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

  const currentRoom = room ?? (roomId ? createEmptyRoomFallback(roomId) : null);

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
    setContextDraft(createInitialContextDraft());
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
      <View style={[senseboardAppStyles.loadingPage, appThemeStyles.loadingPage]}>
        <Text style={[senseboardAppStyles.loadingText, appThemeStyles.loadingText]}>Connecting to room {roomId}...</Text>
      </View>
    );
  }

  return (
    <View style={[senseboardAppStyles.page, appThemeStyles.page]}>
      <View style={senseboardAppStyles.main}>
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
        <View style={senseboardAppStyles.sidebarBackdrop}>
          <Pressable onPress={() => setPanelsOpen(false)} style={[senseboardAppStyles.sidebarScrim, appThemeStyles.sidebarScrim]} />
          <View style={senseboardAppStyles.sidebarOverlayWrap}>
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

      <RoomStatusPill
        roomId={roomId}
        displayName={displayName}
        totalConnectedMembers={totalConnectedMembers}
        connected={connected}
        aiStatus={currentRoom.aiConfig.status}
        theme={theme}
      />

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

      {debugPanelOpen ? <DebugPanel room={currentRoom} error={error} theme={theme} /> : null}
    </View>
  );
};
