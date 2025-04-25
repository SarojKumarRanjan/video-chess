import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../lib/api'; // Your axios instance
import { User } from '../types'; // Shared types

interface UserState {
  user: User | null;
  wsToken: string | null; // Token specifically for WebSocket connection
  isAuthenticated: boolean;
  isLoading: boolean; // To track loading state during auth checks
  setAuthenticatedUser: (user: User, token: string) => void;
  logoutUser: () => void;
  checkAuthStatus: () => Promise<void>; // Function to check status with backend
}

export const useUserStore = create<UserState>()(
  // Persist state to localStorage to keep user logged in across sessions
  persist(
    (set, get) => ({
      user: null,
      wsToken: null,
      isAuthenticated: false,
      isLoading: true, // Start as loading initially

      setAuthenticatedUser: (user, token) => {
        console.log("Store: Setting authenticated user:", user.name, "with token.");
        set({ user, wsToken: token, isAuthenticated: true, isLoading: false });
      },

      logoutUser: async () => {
        console.log("Store: Logging out user...");
        const currentToken = get().wsToken; // Get token before clearing state
        set({ user: null, wsToken: null, isAuthenticated: false, isLoading: false });
        try {
             // Optional: Inform backend about logout, even if client state is cleared
            if (currentToken) { // Only call if there was a token
                 await api.post('/auth/logout');
                 console.log("Backend logout successful.");
            }
        } catch (error) {
          console.error("Error calling backend logout:", error);
          // Client-side logout still proceeds even if backend call fails
        }
      },

      checkAuthStatus: async () => {
         console.log("Store: Checking authentication status with backend...");
         // Avoid check if already loading or authenticated (unless forced)
         // if (get().isLoading || get().isAuthenticated) return;

         set({ isLoading: true });
        try {
          const response = await api.get('/auth/status');
          const { isAuthenticated, user, wsToken } = response.data;

          if (isAuthenticated && user && wsToken) {
            console.log("Store: Auth status OK. User authenticated.", user.name);
            set({ user, wsToken, isAuthenticated: true, isLoading: false });
          } else {
             console.log("Store: Auth status indicates user is not authenticated.");
             // Ensure local state reflects logged-out status if backend says so
             if (get().isAuthenticated) {
                 set({ user: null, wsToken: null, isAuthenticated: false });
             }
             set({ isLoading: false });
          }
        } catch (error) {
          console.error("Store: Error checking auth status:", error);
           // Assume not authenticated on error, clear local state
           if (get().isAuthenticated) {
               set({ user: null, wsToken: null, isAuthenticated: false });
           }
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'user-auth-storage', // Name of the item in storage
      storage: createJSONStorage(() => localStorage), // Use localStorage
       partialize: (state) => ({ user: state.user, wsToken: state.wsToken, isAuthenticated: state.isAuthenticated }), // Only persist these fields
    }
  )
);