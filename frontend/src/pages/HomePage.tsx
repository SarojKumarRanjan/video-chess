import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUserStore } from '@/store/userStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { api } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/components/ui/use-toast";

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const HomePage: React.FC = () => {
    const { user, logoutUser } = useUserStore();
    const { sendMessage, isConnected } = useWebSocket(import.meta.env.VITE_WS_URL, useUserStore.getState().wsToken);
    const navigate = useNavigate();
    const { toast } = useToast();
    const [isFindingMatch, setIsFindingMatch] = useState(false);
     const [timeControl, setTimeControl] = useState<string>("600"); // Default 10 minutes (in seconds as string)

    const handleCreateFriendGame = async () => {
        console.log("Creating friend game...");
        if (!timeControl) {
             toast({ title: "Error", description: "Please select a time control.", variant: "destructive" });
             return;
        }
        try {
            const response = await api.post('/game/create/friend', { timeControl: parseInt(timeControl, 10) });
            const { gameId, gameLink } = response.data;
             console.log(`Friend game created: ${gameId}`);
             toast({
                 title: "Friend Game Created!",
                 description: `Share this link: ${gameLink}`, // Show link or copy button
             });
             // Navigate to the game page immediately for the creator
             navigate(`/game/${gameId}`);
        } catch (error: any) {
             console.error("Failed to create friend game:", error);
              toast({
                 title: "Error",
                 description: error.response?.data?.message || "Could not create friend game.",
                 variant: "destructive",
             });
        }
    };

    const handleFindMatch = () => {
        if (!isConnected) {
            toast({ title: "Error", description: "Not connected to server. Please wait.", variant: "destructive" });
            return;
        }
         if (!timeControl) {
             toast({ title: "Error", description: "Please select a time control.", variant: "destructive" });
             return;
         }
        console.log(`Finding match with time control ${timeControl}s...`);
        sendMessage({
            type: 'FIND_MATCH',
            payload: {
                userId: user!.id, // User should exist if on this page
                timeControl: parseInt(timeControl, 10),
                 // Token might not be needed here if WS connection is already authenticated
            }
        });
         setIsFindingMatch(true);
         toast({ title: "Searching for Match", description: `Looking for a ${parseInt(timeControl)/60} minute game...` });
         // Server will send 'MATCH_FOUND' message which is handled by useWebSocket hook to navigate
    };

    const handleLogout = () => {
        logoutUser();
         navigate('/login'); // Redirect to login after logout
    };

    // Add Game History Fetching Here (useEffect)

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">Welcome, {user?.name}!</h1>
                <Button onClick={handleLogout} variant="outline">Logout</Button>
            </div>

             <p>WebSocket Connected: {isConnected ? 'Yes' : 'No'}</p>

             <Card>
                 <CardHeader>
                     <CardTitle>Start a New Game</CardTitle>
                     <CardDescription>Choose time control and opponent type.</CardDescription>
                 </CardHeader>
                 <CardContent className="space-y-4">
                     <div>
                         <Label htmlFor="time-control">Time Control (per player)</Label>
                         <Select value={timeControl} onValueChange={setTimeControl}>
                            <SelectTrigger id="time-control" className="w-[180px]">
                                <SelectValue placeholder="Select time" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="60">1 Minute</SelectItem>
                                <SelectItem value="180">3 Minutes</SelectItem>
                                <SelectItem value="300">5 Minutes</SelectItem>
                                <SelectItem value="600">10 Minutes</SelectItem>
                                <SelectItem value="900">15 Minutes</SelectItem>
                                <SelectItem value="1800">30 Minutes</SelectItem>
                            </SelectContent>
                        </Select>
                     </div>

                     <div className="flex space-x-4">
                         <Button onClick={handleCreateFriendGame} disabled={isFindingMatch}>
                             Create Friend Game
                         </Button>
                         <Button onClick={handleFindMatch} disabled={isFindingMatch || !isConnected}>
                             {isFindingMatch ? 'Searching...' : 'Find Match'}
                         </Button>
                     </div>
                      {isFindingMatch && <p className='text-sm text-muted-foreground'>Waiting for server to find an opponent...</p>}
                 </CardContent>
             </Card>

            {/* Game History Section (Placeholder) */}
            <Card>
                <CardHeader>
                    <CardTitle>Game History</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Your past games will appear here.</p>
                    {/* TODO: Fetch and display game history from /api/game/history */}
                </CardContent>
            </Card>
        </div>
    );
};

export default HomePage;