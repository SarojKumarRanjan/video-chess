import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import GamePage from './pages/GamePage';
import { Toaster } from "@/components/ui/toaster"; 
import { useUserStore } from './store/userStore';
import { useEffect } from 'react';



function App() {
  const { user,  checkAuthStatus } = useUserStore();
  const navigate = useNavigate();
  const location = useLocation();

  // Initialize WebSocket connection using the hook
  // Pass the token from the store


  // Check authentication status on initial load or page refresh
  useEffect(() => {
    console.log("App Mounted: Checking auth status...");
    checkAuthStatus(); // This will fetch /api/auth/status
  }, [checkAuthStatus]);

  // Connect/disconnect WebSocket based on auth status (token availability)
 

  // Effect to redirect based on authentication state
  useEffect(() => {
    const publicPaths = ['/login'];
    const pathIsPublic = publicPaths.includes(location.pathname);
    const gamePathRegex = /^\/game\/[a-zA-Z0-9-]+$/; // Regex for game paths
    const pathIsGame = gamePathRegex.test(location.pathname);

    console.log(`Routing check: Path=${location.pathname}, User=${user ? user.id : 'null'}, IsPublic=${pathIsPublic}, IsGame=${pathIsGame}`);

    if (!user && !pathIsPublic && !pathIsGame) {
      // If not logged in, not on login page, and not trying to join a game directly, redirect to login
      console.log("User not logged in, redirecting to /login");
      navigate('/login');
    } else if (user && pathIsPublic) {
      // If logged in and on login page, redirect to home
      console.log("User logged in, redirecting from /login to /");
      navigate('/');
    }
    // Allow access to /game/:gameId even if not logged in initially (might login via guest or be redirected)
  }, [user, location.pathname, navigate]);


  return (
    <div className="min-h-screen bg-background text-foreground">
       {/* Add a navbar or header here if needed */}
       <main className="container mx-auto p-4">
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                {/* Protect routes that require login */}
                <Route path="/" element={user ? <HomePage /> : <LoginPage />} />
                <Route path="/game/:gameId" element={<GamePage />} />
                {/* Add other routes here */}
            </Routes>
        </main>
      <Toaster />
    </div>
  );
}

export default App;