import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ensureAuthenticated } from './auth'; // Import auth middleware
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';


const router = Router();
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const WEBSOCKET_URL = process.env.WEBSOCKET_URL || 'ws://localhost:8080';



// POST /api/game/create/friend
// Creates a new game intended for a friend (link sharing)
router.post('/create/friend', ensureAuthenticated, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { timeControl } = req.body; // e.g., timeControl = 600
    if(!timeControl || typeof timeControl !== 'number' || timeControl <= 0) {
       res.status(400).json({ message: 'Invalid time control specified.' });
    }

    const gameId = uuidv4(); 



    try{

         const initialTimeMs = timeControl * 1000; // Convert seconds to milliseconds

         const game  = await prisma.game.create({
            data: {
                id: gameId,
                whitePlayerId: userId,
                blackPlayerId: null, 
                timeControl: timeControl,
                whiteTimeLeft: initialTimeMs,
                blackTimeLeft: initialTimeMs,
                status: 'WAITING',
                lastMoveTimestamp: new Date(),
                
            },

        });
        
        if(!game) {
            res.status(500).json({ message: 'Failed to create game in database.' });
        }
    
          const gameLink = `${CLIENT_URL}/game/${gameId}`;

          res.status(200).json({
            gameId: gameId,
            gameLink: gameLink,
            websocketUrl: WEBSOCKET_URL,
        });

    } catch (error) {
        console.error(`Error creating friend game for user ${userId}:`, error);
        res.status(500).json({ message: 'Failed to create game' });
    }
});

// POST /api/game/join/matchmaking
// Signals intent to join matchmaking queue (handled by WebSocket server)
// This HTTP endpoint might just return the WebSocket URL or confirm the request.
// The actual queue logic is better placed in the WS server.


router.post('/join/matchmaking', ensureAuthenticated, async (req: Request, res: Response) => {
    const { timeControl } = req.body;
    if (!timeControl || typeof timeControl !== 'number' || timeControl <= 0) {
         res.status(400).json({ message: 'Invalid time control specified.' });
    }
   res.status(200).json({ message: 'Connect to WebSocket to find match.', websocketUrl: WEBSOCKET_URL, timeControl: timeControl });
});


// GET /api/game/history
// Fetches completed games for the logged-in user
router.get('/history', ensureAuthenticated, async (req: Request, res: Response) => {
    const userId = req.user?.id;
    console.log(`Fetching game history for user ${userId}`);

    try {
        const games = await prisma.game.findMany({
            where: {
                OR: [
                    { whitePlayerId: userId },
                    { blackPlayerId: userId },
                ],
                status: { in: ['COMPLETED', 'ABORTED'] } // Only fetch finished games
            },
            orderBy: {
                endTime: 'desc' // Show most recent first
            },
            include: { // Include player names for display
                whitePlayer: { select: { id: true, name: true } },
                blackPlayer: { select: { id: true, name: true } },
                winner: { select: { id: true, name: true } }
            },
            take: 20, // Limit results for pagination
        });

        console.log(`Found ${games.length} games for user ${userId}`);
        res.status(200).json(games);

    } catch (error) {
        console.error(`Error fetching game history for user ${userId}:`, error);
        res.status(500).json({ message: 'Failed to fetch game history' });
    }
});

// GET /api/game/:gameId/state (Optional - might not be needed if WS handles all state)
// Could be used to fetch initial state if joining via link, but WS JOIN_GAME is better
router.get('/:gameId/load', async (req: Request, res: Response) => {
    
    const { gameId } = req.params;
    const userId = req.user!.id;

    console.log(`User ${userId} requesting to load game state for ${gameId}`);

    try {
        // Use explicit type for game data including relations
        const game: Prisma.GameGetPayload<{
            include: {
                moves: { orderBy: { moveNumber: 'asc' }, include: { player: { select: { id: true, name: true } } } },
                whitePlayer: { select: { id: true, name: true } },
                blackPlayer: { select: { id: true, name: true } },
                winner: { select: { id: true, name: true } } // Include winner info
            }
        }> | null = await prisma.game.findUnique({
            where: { id: gameId },
            include: {
                moves: { orderBy: { moveNumber: 'asc' }, include: { player: { select: { id: true, name: true } } } },
                whitePlayer: { select: { id: true, name: true } },
                blackPlayer: { select: { id: true, name: true } },
                winner: { select: { id: true, name: true } }
            }
        });

        if (!game) {
             res.status(404).json({ message: 'Game not found.' });
             return;
        }   

        if (game.whitePlayerId !== userId && game.blackPlayerId !== userId) {
            console.warn(`User ${userId} attempted to load game ${gameId} they are not part of.`);
             res.status(403).json({ message: 'You are not a player in this game.' });
        }

        // Determine initial winner state from DB record
        let winnerVal: 'w' | 'b' | 'draw' | null = null;
         if (game.status === 'COMPLETED' || game.status === 'ABORTED') {
             if (game.winnerId === game.whitePlayerId) winnerVal = 'w';
             else if (game.winnerId === game.blackPlayerId) winnerVal = 'b';
             else if (game.status === 'COMPLETED' && !game.winnerId) winnerVal = 'draw'; // Completed without winner = draw
         }

         if(game.lastMoveTimestamp === null) {
            game.lastMoveTimestamp = new Date();
         }
        // If game is still in progress, we need to set the last move timestamp
        // to the current time to ensure accurate time tracking.

        // Base state from DB cache
        const reconstructedState = {
            id: game.id,
            fen: game.currentFen,
            turn: game.turn as 'w' | 'b',
            whitePlayerId: game.whitePlayerId,
            blackPlayerId: game.blackPlayerId,
            whitePlayerName: game.whitePlayer?.name,
            blackPlayerName: game.blackPlayer?.name,
            status: game.status as 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED',
            winner: winnerVal,
            timeControl: game.timeControl,
            whiteTimeLeft: game.whiteTimeLeft,
            blackTimeLeft: game.blackTimeLeft,
            lastMoveTimestamp: game.lastMoveTimestamp.getTime(),
            createdAt: game.createdAt.getTime(),
            moves: game.moves.map(m => ({
                 number: m.moveNumber,
                 san: m.moveSAN,
                 playerId: m.playerId,
                 playerName: m.player.name,
                 whiteTimeLeft: m.whiteTimeLeft,
                 blackTimeLeft: m.blackTimeLeft,
                 timestamp: m.timestamp.getTime(),
            })),
        };

        // Adjust time if game is in progress
        let needsStatusUpdate = false;
        if (reconstructedState.status === 'IN_PROGRESS') {
            const now = Date.now();
            const elapsed = now - reconstructedState.lastMoveTimestamp;
            if (elapsed > 0) {
                if (reconstructedState.turn === 'w') {
                    reconstructedState.whiteTimeLeft -= elapsed;
                    if (reconstructedState.whiteTimeLeft <= 0) {
                        reconstructedState.status = 'COMPLETED'; // Timeout!
                        reconstructedState.winner = 'b';
                        needsStatusUpdate = true; // Mark that DB needs update
                    }
                } else {
                    reconstructedState.blackTimeLeft -= elapsed;
                     if (reconstructedState.blackTimeLeft <= 0) {
                        reconstructedState.status = 'COMPLETED'; // Timeout!
                        reconstructedState.winner = 'w';
                        needsStatusUpdate = true; // Mark that DB needs update
                    }
                }
                reconstructedState.whiteTimeLeft = Math.max(0, reconstructedState.whiteTimeLeft);
                reconstructedState.blackTimeLeft = Math.max(0, reconstructedState.blackTimeLeft);
            }
        }

        // If a timeout was detected on load, we should ideally trigger a DB update.
        // For simplicity here, we just return the timed-out state. The WS server's
        // timer or next move handler would eventually push the final state update.
        if (needsStatusUpdate) {
             console.warn(`Game ${gameId} appears timed out upon loading. Status: ${reconstructedState.status}, Winner: ${reconstructedState.winner}`);
             // In a production system, you might push a specific 'TIMEOUT_DETECTED' task
             // to the DB queue here.
        }

        console.log(`Successfully loaded state for game ${gameId}`);
        res.status(200).json(reconstructedState);
        
    } catch (error) {
        console.error(`Error fetching game state from Redis for ${gameId}:`, error);
        res.status(500).json({ message: 'Failed to fetch game state' });
    }
});


export default router;