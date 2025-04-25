import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { MessagePayload, FullGameState } from '../types';
import { handleIncomingWebRTCMessage, closePeerConnection } from '../lib/webrtc';

export function useWebSocket(url: string, token: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const webSocketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelay = useRef(1000);

  const {
    setConnectionStatus,
    setCurrentGame,
    updateCurrentGame,
    addChatMessage,
    setOpponent,
    setOpponentConnected,
    setVideoCallActive,
    setRemoteStream,
    resetGame,
    setGameLoading,
  } = useGameStore();

  const { user } = useUserStore();

  const sendMessage = useCallback((message: MessagePayload) => {
    const ws = webSocketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      console.error('Cannot send message: WebSocket is not open.');
    }
  }, []);

  const startVideoCall = useCallback(async () => {
    const { initializePeerConnection, createOffer, getLocalStream } = await import('../lib/webrtc');
    const peerConnection = initializePeerConnection(sendMessage);
    if (!peerConnection) return;

    const stream = await getLocalStream();
    if (stream) {
      useGameStore.getState().setLocalStream(stream);
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
      await createOffer(peerConnection, sendMessage);
      setVideoCallActive(true);

      const currentGameId = useGameStore.getState().currentGame?.id;
      if (currentGameId && user?.id) {
        sendMessage({ type: 'START_VIDEO', payload: { gameId: currentGameId, userId: user.id } });
      }
    }
  }, [sendMessage, setVideoCallActive, user?.id]);

  const stopVideoCall = useCallback(() => {
    closePeerConnection();
    setVideoCallActive(false);

    const currentGameId = useGameStore.getState().currentGame?.id;
    if (currentGameId && user?.id) {
      sendMessage({ type: 'END_VIDEO', payload: { gameId: currentGameId, userId: user.id } });
    }
  }, [sendMessage, setVideoCallActive, user?.id]);

  const connect = useCallback(() => {
    if (webSocketRef.current || isConnecting || !token) {
      if (!token) console.warn('useWebSocket: Cannot connect without a token.');
      return;
    }

    console.log('useWebSocket: Attempting to connect...');
    setIsConnecting(true);
    setConnectionStatus({ isConnecting: true, isConnected: false });

    const wsUrl = `${url}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    webSocketRef.current = ws;

    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionStatus({ isConnecting: false, isConnected: true });
      reconnectDelay.current = 1000;
      if (reconnectAttemptRef.current) {
        clearTimeout(reconnectAttemptRef.current);
        reconnectAttemptRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message: MessagePayload = JSON.parse(event.data as string);
        console.log('Received WS message:', message.type, message.payload);

        switch (message.type) {
          case 'CONNECTION_ACK':
            console.log('Server acknowledged connection:', message.payload.message);
            break;

          case 'FULL_GAME_STATE': {
            console.log('Received full game state');
            setCurrentGame(message.payload as FullGameState);
            setGameLoading(false);

            const opponentId = user?.id === message.payload.whitePlayerId
              ? message.payload.blackPlayerId
              : message.payload.whitePlayerId;
            const opponentName = user?.id === message.payload.whitePlayerId
              ? message.payload.blackPlayerName
              : message.payload.whitePlayerName;

            if (opponentId && opponentName) {
              setOpponent({ id: opponentId, name: opponentName, isGuest: false });
              setOpponentConnected(true);
            } else {
              setOpponent(null);
              setOpponentConnected(false);
            }
            break;
          }

          case 'GAME_STATE_UPDATE': {
            if (message.payload.currentFen && message.payload.status) {
              // full state in update
              const opponentId = user?.id === message.payload.whitePlayerId
                ? message.payload.blackPlayerId
                : message.payload.whitePlayerId;
              const opponentName = user?.id === message.payload.whitePlayerId
                ? message.payload.blackPlayerId
                : message.payload.whitePlayerId;

              if (opponentId && opponentName) {
                setOpponent({ id: opponentId, name: opponentName, isGuest: false });
                setOpponentConnected(true);
              }

              setCurrentGame(message.payload as FullGameState);
            } else {
              updateCurrentGame(message.payload);
            }
            break;
          }

          case 'TIMER_UPDATE':
            updateCurrentGame({
              whiteTimeLeft: message.payload.whiteTimeLeft,
              blackTimeLeft: message.payload.blackTimeLeft,
            });
            break;

          case 'GAME_OVER':
            updateCurrentGame({ status: 'COMPLETED', winner: message.payload.winner });
            alert(`Game Over! ${message.payload.reason}`);
            stopVideoCall();
            break;

          case 'CHAT_MESSAGE':
            addChatMessage({
              userId: message.payload.userId,
              name: message.payload.name,
              message: message.payload.message,
            });
            break;

          case 'USER_JOINED':
            if (message.payload.userId !== user?.id) {
              console.log(`Opponent ${message.payload.name} joined.`);
              setOpponent({ id: message.payload.userId, name: message.payload.name, isGuest: false });
              setOpponentConnected(true);
            }
            break;

          case 'USER_LEFT':
            if (message.payload.userId !== user?.id) {
              console.log(`Opponent ${message.payload.userId} left.`);
              setOpponent(null);
              setOpponentConnected(false);
              stopVideoCall();
              alert('Opponent disconnected.');
            }
            break;

          case 'MATCH_FOUND':
            console.log(`Match found! Game ID: ${message.payload.gameId}, Opponent: ${message.payload.opponentName}`);
            setOpponent({ id: 'temp-opponent-id', name: message.payload.opponentName, isGuest: false });
            window.location.href = `/game/${message.payload.gameId}`;
            break;

          case 'ERROR':
            console.error('Received error from server:', message.payload.message);
            alert(`Server Error: ${message.payload.message}`);
            break;

          case 'VIDEO_OFFER':
          case 'VIDEO_ANSWER':
          case 'VIDEO_ICE':
            if (message.payload.userId !== user?.id) {
              handleIncomingWebRTCMessage(message, sendMessage);
            }
            break;

          case 'START_VIDEO':
            if (message.payload.userId !== user?.id) {
              alert('Opponent wants to start video call!');
            }
            break;

          case 'END_VIDEO':
            if (message.payload.userId !== user?.id) {
              stopVideoCall();
            }
            break;

          default:
            console.warn('Unknown message type:', message.type);
        }
      } catch (err) {
        console.error('WS message parse/handle error:', err);
      }
    };

    ws.onclose = (event) => {
      console.warn(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
      setIsConnected(false);
      setIsConnecting(false);
      setConnectionStatus({ isConnecting: false, isConnected: false });
      setOpponentConnected(false);
      stopVideoCall();
      webSocketRef.current = null;

      if (event.code === 1008) return;

      if (!event.wasClean && token) {
        const delay = Math.min(reconnectDelay.current * 2, 30000);
        reconnectAttemptRef.current = setTimeout(connect, delay);
        reconnectDelay.current = delay;
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
    };
  }, [
    url,
    token,
    isConnecting,
    setConnectionStatus,
    user?.id,
    setCurrentGame,
    updateCurrentGame,
    addChatMessage,
    setOpponent,
    setOpponentConnected,
    setVideoCallActive,
    setGameLoading,
    stopVideoCall,
  ]);

  const disconnect = useCallback(() => {
    if (reconnectAttemptRef.current) {
      clearTimeout(reconnectAttemptRef.current);
      reconnectAttemptRef.current = null;
    }
    const ws = webSocketRef.current;
    if (ws) {
      ws.close(1000, 'User initiated disconnect');
      webSocketRef.current = null;
      setIsConnected(false);
      setIsConnecting(false);
      setConnectionStatus({ isConnecting: false, isConnected: false });
      setOpponentConnected(false);
      stopVideoCall();
      resetGame();
    }
  }, [setConnectionStatus, setOpponentConnected, resetGame, stopVideoCall]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { isConnected, isConnecting, connect, disconnect, sendMessage, startVideoCall, stopVideoCall };
}
