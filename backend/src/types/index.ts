
import { Move as ChessJsMove } from 'chess.js'; // Rename to avoid clash

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



// For the DB Write Queue Payload
export interface DbWritePayload {
    type: 'CREATE_MOVE' | 'UPDATE_GAME_STATUS' | 'ASSIGN_PLAYER' | 'CREATE_MATCHED_GAME';
    payload: any; // Define specific payload structures later
}

// WebSocket Message Payloads (Simplified)
export type MessagePayload =
  | { type: 'JOIN_GAME'; payload: { gameId: string } } // Client provides gameId
  | { type: 'MAKE_MOVE'; payload: { gameId: string; move: string | ChessJsMove } } // userId comes from ws object
  | { type: 'CHAT_MESSAGE'; payload: { gameId: string; message: string; name: string } } // userId from ws, name needed
  | { type: 'FIND_MATCH'; payload: { timeControl: number } } // userId from ws
  // Video signaling remains the same for now...
  | { type: 'VIDEO_OFFER'; payload: { gameId: string; offer: RTCSessionDescriptionInit } }
  | { type: 'VIDEO_ANSWER'; payload: { gameId: string; answer: RTCSessionDescriptionInit } }
  | { type: 'VIDEO_ICE'; payload: { gameId: string; candidate: RTCIceCandidateInit } }
  | { type: 'START_VIDEO'; payload: { gameId: string } }
  | { type: 'END_VIDEO'; payload: { gameId: string } }
  // Server -> Client Messages
 