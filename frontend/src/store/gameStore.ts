import { create } from 'zustand';
import { GameState, User } from '../types'; // Shared types

interface GameStoreState {
  currentGame: GameState | null;
  opponent: User | null; // Store opponent details if available
  chatMessages: Array<{ userId: string; name: string; message: string; timestamp: number }>;
  isConnecting: boolean;
  isConnected: boolean; // WebSocket connection status from useWebSocket hook
  isGameLoading: boolean; // Loading state for fetching/joining game
  isOpponentConnected: boolean; // Track if opponent is connected via WS events
  videoCallActive: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  // Actions
  setCurrentGame: (gameState: GameState | null) => void;
  updateCurrentGame: (updates: Partial<GameState>) => void;
  addChatMessage: (message: { userId: string; name: string; message: string }) => void;
  setConnectionStatus: (status: { isConnecting: boolean; isConnected: boolean }) => void;
  setGameLoading: (isLoading: boolean) => void;
  setOpponentConnected: (isConnected: boolean) => void;
  setOpponent: (opponent: User | null) => void;
  resetGame: () => void; // Reset state when leaving/finishing game
  setVideoCallActive: (isActive: boolean) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
}

const initialState = {
    currentGame: null,
    opponent: null,
    chatMessages: [],
    isConnecting: false,
    isConnected: false,
    isGameLoading: false,
    isOpponentConnected: false,
    videoCallActive: false,
    localStream: null,
    remoteStream: null,
};

export const useGameStore = create<GameStoreState>((set, get) => ({
  ...initialState,

  setCurrentGame: (gameState) => {
    console.log("Store: Setting current game:", gameState?.id);
    set({ currentGame: gameState, isGameLoading: false });
    // Potentially update opponent based on gameState here
  },

  updateCurrentGame: (updates) => {
    console.log("Store: Updating current game state:", Object.keys(updates));
    set((state) => ({
      currentGame: state.currentGame ? { ...state.currentGame, ...updates } : null,
    }));
  },

  addChatMessage: (message) => {
    console.log(`Store: Adding chat message from ${message.name}: ${message.message}`);
    set((state) => ({
      chatMessages: [...state.chatMessages, { ...message, timestamp: Date.now() }],
    }));
  },

  setConnectionStatus: ({ isConnecting, isConnected }) => {
    // console.log(`Store: WS Connection Status - Connecting: ${isConnecting}, Connected: ${isConnected}`); // Can be noisy
    set({ isConnecting, isConnected });
  },

   setGameLoading: (isLoading) => {
      console.log(`Store: Setting game loading state to ${isLoading}`);
      set({ isGameLoading: isLoading });
   },

   setOpponentConnected: (isConnected) => {
        console.log(`Store: Setting opponent connected state to ${isConnected}`);
       set({ isOpponentConnected: isConnected });
   },

   setOpponent: (opponent) => {
       console.log(`Store: Setting opponent:`, opponent?.name);
       set({ opponent });
   },

   setVideoCallActive: (isActive) => {
       console.log(`Store: Setting video call active state to ${isActive}`);
       set({ videoCallActive: isActive });
       // If stopping call, clear streams
       if (!isActive) {
           get().localStream?.getTracks().forEach(track => track.stop());
           set({ localStream: null, remoteStream: null });
       }
   },

   setLocalStream: (stream) => {
        // Stop previous stream if exists
        get().localStream?.getTracks().forEach(track => track.stop());
        console.log("Store: Setting local video stream");
        set({ localStream: stream });
   },

   setRemoteStream: (stream) => {
       console.log("Store: Setting remote video stream");
        set({ remoteStream: stream });
   },

  resetGame: () => {
    console.log("Store: Resetting game state.");
     // Ensure streams are stopped and cleared
     get().localStream?.getTracks().forEach(track => track.stop());
     // Reset all game-related state to initial values
    set(initialState);
  },
}));