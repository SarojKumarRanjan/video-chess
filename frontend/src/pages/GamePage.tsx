import React, { useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChessBoardComponent } from '@/components/ChessBoardComponent';
import { ChatBox } from '@/components/ChatBox';
import { VideoCall } from '@/components/VideoCall';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ClockIcon } from 'lucide-react';

// Helper to format time (MM:SS)
const formatTime = (milliseconds: number): string => {
  if (milliseconds < 0) milliseconds = 0;
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const GamePage: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, wsToken } = useUserStore();
  const {
    currentGame,
    opponent,
    isGameLoading,
    setGameLoading,
    resetGame,
    setOpponentConnected,
    setCurrentGame,
  } = useGameStore();

  const {
    sendMessage,
    isConnected,
    startVideoCall,
    stopVideoCall,
    connect,
    disconnect,
  } = useWebSocket(import.meta.env.VITE_WS_URL, wsToken);

  // Prevent duplicate JOIN_GAME
  const isJoiningRef = useRef(false);

  // Connect/disconnect WS and cleanup on unmount
  useEffect(() => {
    if (wsToken && !isConnected) {
      console.log('GamePage: Connecting WebSocket...');
      connect();
    } else if (!wsToken && isConnected) {
      console.log('GamePage: Disconnecting WebSocket...');
      disconnect();
    }

    return () => {
      console.log('GamePage: Cleaning up...');
      resetGame();
      if (isConnected && !wsToken) {
        disconnect();
      }
    };
  }, [wsToken, isConnected, connect, disconnect, resetGame]);

  // Single effect to join game when ready
  const joinGame = useCallback(() => {
    if (!gameId || !user || !isConnected || isJoiningRef.current) return;

    console.log(`GamePage: JOIN_GAME -> gameId=${gameId}, userId=${user.id}`);
    isJoiningRef.current = true;
    setGameLoading(true);

    sendMessage({
      type: 'JOIN_GAME',
      payload: { gameId, userId: user.id },
    });
  }, [gameId, user, isConnected, sendMessage, setGameLoading]);

  useEffect(() => {
    if (gameId && user && isConnected && currentGame?.id !== gameId) {
      joinGame();
    }
  }, [gameId, user, isConnected, currentGame?.id, joinGame]);

  // Clear joining flag once game state arrives
  useEffect(() => {
    if (currentGame?.id === gameId) {
      isJoiningRef.current = false;
    }
  }, [currentGame, gameId]);

  const handleLeaveGame = () => {
    resetGame();
    navigate('/');
    toast({ title: 'Left Game', description: `You have left game ${gameId}.` });
  };

  const userColor =
    currentGame?.whitePlayerId === user?.id
      ? 'w'
      : currentGame?.blackPlayerId === user?.id
      ? 'b'
      : undefined;
  const isUserTurn =
    userColor === currentGame?.turn && currentGame?.status === 'IN_PROGRESS';

  if (isGameLoading && !currentGame) {
    return <div className="flex justify-center items-center h-screen">Loading game...</div>;
  }

  if (!currentGame && !isGameLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-screen space-y-4">
        <p>Could not load game data for {gameId}.</p>
        <p>Ensure you are connected and the game exists.</p>
        <Button onClick={() => navigate('/')}>Go Home</Button>
        {isConnected && user && <Button onClick={joinGame}>Retry Join</Button>}
      </div>
    );
  }

  const whitePlayerName = currentGame?.whitePlayerName || 'Waiting...';
  const blackPlayerName = currentGame?.blackPlayerName || 'Waiting...';
  const whiteTime = formatTime(currentGame?.whiteTimeLeft ?? 0);
  const blackTime = formatTime(currentGame?.blackTimeLeft ?? 0);
  const isGameOver = ['COMPLETED', 'ABORTED'].includes(currentGame?.status || '');

  let statusMessage = `Game ID: ${gameId}`;
  if (currentGame?.status === 'WAITING') statusMessage = 'Waiting for opponent...';
  else if (currentGame?.status === 'IN_PROGRESS')
    statusMessage = isUserTurn ? 'Your Turn' : "Opponent's Turn";
  else if (isGameOver) {
    statusMessage = currentGame.winner === 'draw'
      ? 'Game Over: Draw'
      : `Game Over: ${currentGame.winner === 'w' ? whitePlayerName : blackPlayerName} wins!`;
  }

  return (
    <div className="container mx-auto p-4 flex flex-col lg:flex-row gap-4">
      <div className="flex-grow flex flex-col items-center space-y-4">
        {/* Opponent Info */}
        <Card className="w-full max-w-md">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Avatar>
                <AvatarImage src={`https://api.dicebear.com/7.x/adventurer/png?seed=${userColor === 'w' ? blackPlayerName : whitePlayerName}`} />
                <AvatarFallback>{(userColor === 'w' ? blackPlayerName : whitePlayerName).substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{userColor === 'w' ? blackPlayerName : whitePlayerName}</p>
                <p className={`text-xs ${useGameStore.getState().isOpponentConnected ? 'text-green-500' : 'text-muted-foreground'}`}>                
                  {useGameStore.getState().isOpponentConnected ? 'Connected' : 'Disconnected'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-xl font-mono bg-secondary p-2 rounded">
              <ClockIcon className="h-5 w-5 text-muted-foreground" />
              <span>{userColor === 'w' ? blackTime : whiteTime}</span>
            </div>
          </CardContent>
        </Card>

        {/* Chess Board */}
        <div className="w-full max-w-md aspect-square">
          {currentGame && (
            <ChessBoardComponent
              fen={currentGame.fen}
              playerColor={userColor}
              onMove={(move) => {
                if (gameId && user && isUserTurn) {
                  sendMessage({ type: 'MAKE_MOVE', payload: { gameId, userId: user.id, move } });
                } else {
                  toast({ title: 'Invalid Action', description: "It's not your turn.", variant: 'destructive' });
                }
              }}
              isGameOver={isGameOver}
            />
          )}
        </div>

        {/* Player Info */}
        <Card className="w-full max-w-md">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Avatar>
                <AvatarImage src={`https://api.dicebear.com/7.x/adventurer/png?seed=${userColor === 'w' ? whitePlayerName : blackPlayerName}`} />
                <AvatarFallback>{(userColor === 'w' ? whitePlayerName : blackPlayerName).substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{userColor === 'w' ? whitePlayerName : blackPlayerName} (You)</p>
                <p className={`text-xs ${isConnected ? 'text-green-500' : 'text-muted-foreground'}`}>{isConnected ? 'Connected' : 'Disconnected'}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-xl font-mono bg-secondary p-2 rounded">
              <ClockIcon className="h-5 w-5 text-muted-foreground" />
              <span>{userColor === 'w' ? whiteTime : blackTime}</span>
            </div>
          </CardContent>
        </Card>
        <p className="text-center font-medium">{statusMessage}</p>
        <Button onClick={handleLeaveGame} variant="outline" size="sm">
          Leave Game
        </Button>
      </div>

      {/* Right Side: Video and Chat */}
      <div className="w-full lg:w-80 flex-shrink-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Video Call</CardTitle>
          </CardHeader>
          <CardContent>
            <VideoCall onStartCall={startVideoCall} onEndCall={stopVideoCall} />
          </CardContent>
        </Card>

        <Card className="h-96 flex flex-col">
          <CardHeader>
            <CardTitle>Chat</CardTitle>
          </CardHeader>
          <CardContent className="flex-grow overflow-hidden">
            <ChatBox gameId={gameId!} userId={user?.id} userName={user?.name} sendMessage={sendMessage} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GamePage;
