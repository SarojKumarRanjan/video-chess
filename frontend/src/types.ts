
import { Move } from "chess.js"; // Needed in WS backend and maybe Frontend

export interface User {
  id: string;
  name: string;
  email?: string | null;
  googleId?: string | null;
  isGuest: boolean;
}



// Represents the fully reconstructed state sent to client (from DB load)
export interface FullGameState {
    id: string;
    fen: string;
    turn: 'w' | 'b';
    whitePlayerId: string | null;
    blackPlayerId: string | null;
    whitePlayerName?: string;
    blackPlayerName?: string;
    status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED';
    winner: 'w' | 'b' | 'draw' | null;
    timeControl: number;
    whiteTimeLeft: number; // Milliseconds
    blackTimeLeft: number; // Milliseconds
    lastMoveTimestamp: number; // JS Timestamp (ms)
    createdAt: number; // JS Timestamp (ms)
    moves: MoveRecord[];
}

export interface MoveRecord {
    number: number;
    san: string;
    playerId: string;
    playerName?: string;
    whiteTimeLeft: number; // Milliseconds
    blackTimeLeft: number; // Milliseconds
    timestamp: number; // JS Timestamp (ms)
}


// Represents the *runtime* state held in memory for an active game
export interface GameRuntimeState {
    gameId: string;
    players: Set<AuthenticatedWebSocket>;
    currentFen: string;
    turn: 'w' | 'b';
    whitePlayerId: string | null;
    blackPlayerId: string | null;
    // Runtime calculated time:
    whiteTimeLeft: number; // Milliseconds
    blackTimeLeft: number; // Milliseconds
    lastMoveTimestamp: number; // JS Timestamp (ms) - when last move *started* this turn
    timeControl: number; // In seconds
    status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED';
    timerInterval?: NodeJS.Timeout;
    moveHistory?: MoveRecord[]; // Optional: keep recent history in memory? Or rely on client having it.
                                // Let's omit for now to rely on DB state.
}

export interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    gameId?: string; // Track which game the connection is associated with
}

// For the DB Write Queue Payload
export interface DbWritePayload {
    type: 'CREATE_MOVE' | 'UPDATE_GAME_STATUS' | 'ASSIGN_PLAYER' | 'CREATE_MATCHED_GAME';
    payload: any; // Define specific payload structures later
}

// WebSocket Message Payloads (Simplified)
export type MessagePayload =
  | { type: 'JOIN_GAME'; payload: { gameId: string } } // Client provides gameId
  | { type: 'MAKE_MOVE'; payload: { gameId: string; move: string | Move } } // userId comes from ws object
  | { type: 'CHAT_MESSAGE'; payload: { gameId: string; message: string; name: string , userId:string} } // userId from ws, name needed
  | { type: 'FIND_MATCH'; payload: { timeControl: number } } // userId from ws
  // Video signaling remains the same for now...
  | { type: 'VIDEO_OFFER'; payload: { gameId: string; offer: RTCSessionDescriptionInit,userId:string } }
  | { type: 'VIDEO_ANSWER'; payload: { gameId: string; answer: RTCSessionDescriptionInit,userId:string } }
  | { type: 'VIDEO_ICE'; payload: { gameId: string; candidate: RTCIceCandidateInit,userId:string } }
  | { type: 'START_VIDEO'; payload: { gameId: string,userId:string } }
  | { type: 'END_VIDEO'; payload: { gameId: string,userId:string } }
  // Server -> Client Messages
  | { type: 'GAME_STATE_UPDATE'; payload: Partial<GameRuntimeState> & { lastMoveSan?: string } } // Send runtime updates
  | { type: 'FULL_GAME_STATE'; payload: FullGameState } // Send full state on join/reconnect
  | { type: 'TIMER_UPDATE'; payload: { gameId: string; whiteTimeLeft: number; blackTimeLeft: number } }
  | { type: 'GAME_OVER'; payload: { gameId: string; winner: 'w' | 'b' | 'draw' | null; reason: string } }
  | { type: 'MATCH_FOUND'; payload: { gameId: string; opponentName: string; color: 'w' | 'b' } }
  | { type: 'USER_JOINED'; payload: { gameId: string; userId: string; name: string } }
  | { type: 'USER_LEFT'; payload: { gameId: string; userId: string } }
  | { type: 'ERROR'; payload: { message: string } }
  | { type: 'CONNECTION_ACK'; payload: { message: string } }
