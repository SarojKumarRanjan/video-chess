// src/gameManager.ts
import { WebSocket } from 'ws';
import { Chess, Move, Square } from 'chess.js';
import { v4 as uuidv4 } from 'uuid';
import {
    AuthenticatedWebSocket, GameRuntimeState, MessagePayload, User, FullGameState, DbWritePayload
} from './types';
import redis, { DB_WRITE_QUEUE, getMatchmakingQueueName } from './lib/redis';
import prisma from './lib/prisma'; // Adjust path

// --- Type definitions for Maps ---
type UsersMap = Map<string, AuthenticatedWebSocket>;
type GamesMap = Map<string, GameRuntimeState>; // Maps gameId to runtime state

// --- Helper Functions ---

function safeJsonParse(data: string): MessagePayload | null {
    try {
        return JSON.parse(data);
    } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
        return null;
    }
}
function sendToClient(ws: AuthenticatedWebSocket, message: MessagePayload) {
    if (ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify(message));
    } else {
        console.warn(`Attempted to send message to closed WebSocket for user ${ws.userId}`);
    }
}
// Broadcast to players within a specific game's runtime state
function broadcastToGame(gameRuntimeState: GameRuntimeState | undefined, message: MessagePayload, senderWs?: AuthenticatedWebSocket) {
    if (!gameRuntimeState) return;
    const messageString = JSON.stringify(message);
    gameRuntimeState.players.forEach(client => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

// Push task onto DB write queue
async function enqueueDbTask(task: DbWritePayload) {
    try {
        await redis.lpush(DB_WRITE_QUEUE, JSON.stringify(task));
    } catch (error) {
        console.error("Failed to enqueue DB task:", error, task);
        // Handle failure - log, alert, retry?
    }
}

// --- Timer Logic (Operates on GameRuntimeState) ---

function stopGameTimer(gameRuntimeState: GameRuntimeState | undefined) {
    if (gameRuntimeState?.timerInterval) {
        clearInterval(gameRuntimeState.timerInterval);
        gameRuntimeState.timerInterval = undefined;
        console.log(`Stopped timer for game ${gameRuntimeState.gameId}`);
    }
}

function startGameTimer(gameRuntimeState: GameRuntimeState, games: GamesMap) {
    if (gameRuntimeState.timerInterval || gameRuntimeState.status !== 'IN_PROGRESS') {
        return; // Already running or game not active
    }

    console.log(`Starting timer for game ${gameRuntimeState.gameId}`);

    gameRuntimeState.timerInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - gameRuntimeState.lastMoveTimestamp;
        let needsBroadcast = false;

        // Update in-memory time
        if (gameRuntimeState.turn === 'w') {
            gameRuntimeState.whiteTimeLeft -= elapsed;
            if (gameRuntimeState.whiteTimeLeft < 0) gameRuntimeState.whiteTimeLeft = 0;
        } else {
            gameRuntimeState.blackTimeLeft -= elapsed;
            if (gameRuntimeState.blackTimeLeft < 0) gameRuntimeState.blackTimeLeft = 0;
        }
        gameRuntimeState.lastMoveTimestamp = now; // Update timestamp for next interval calculation
        needsBroadcast = true;

        let winner: 'w' | 'b' | null = null;
        let reason = "";

        // Check for timeout
        if (gameRuntimeState.whiteTimeLeft <= 0) {
            winner = 'b'; reason = `${gameRuntimeState.whitePlayerId}'s time ran out`;
        } else if (gameRuntimeState.blackTimeLeft <= 0) {
            winner = 'w'; reason = `${gameRuntimeState.blackPlayerId}'s time ran out`;
        }

        if (winner) {
            console.log(`Game ${gameRuntimeState.gameId} ended via timer. ${reason}`);
            gameRuntimeState.status = 'COMPLETED'; // Update in-memory status
            stopGameTimer(gameRuntimeState); // Stop this timer

            // Enqueue DB update for game status
            enqueueDbTask({
                type: 'UPDATE_GAME_STATUS',
                payload: { gameId: gameRuntimeState.gameId, status: 'COMPLETED', winner: winner, reason: reason }
            });

            // Broadcast GAME_OVER
            broadcastToGame(gameRuntimeState, { type: 'GAME_OVER', payload: { gameId: gameRuntimeState.gameId, winner, reason } });

        } else if (needsBroadcast) {
            // Broadcast TIMER_UPDATE
            broadcastToGame(gameRuntimeState, {
                type: 'TIMER_UPDATE',
                payload: {
                    gameId: gameRuntimeState.gameId,
                    whiteTimeLeft: gameRuntimeState.whiteTimeLeft,
                    blackTimeLeft: gameRuntimeState.blackTimeLeft
                }
            });
        }

    }, 1000); // Update every second
}


// --- Message Handlers ---

// Handles user joining/rejoining a game
async function handleJoinGame(
    ws: AuthenticatedWebSocket,
    payload: { gameId: string },
    users: UsersMap,
    games: GamesMap
) {
    const { gameId } = payload;
    const userId = ws.userId;

    if (!userId) {
        sendToClient(ws, { type: 'ERROR', payload: { message: 'Authentication error.' } });
        return;
    }

    console.log(`User ${userId} attempting to join/rejoin game ${gameId}`);

    // 1. Load full game state from DB via HTTP endpoint (simulated here, ideally use internal function/prisma)
    let fullGameState: FullGameState | null = null;
    try {
        // In a real app, you might call the HTTP service or use Prisma directly
        // Simulating fetch from DB:
        const gameWithDetails = await prisma.game.findUnique({
            where: { id: gameId },
            include: {
                moves: { orderBy: { moveNumber: 'asc' }, include: { player: { select: { id: true, name: true } } } },
                whitePlayer: { select: { id: true, name: true } },
                blackPlayer: { select: { id: true, name: true } },
                winner: { select: { id: true, name: true } }
            }
        });

        if (!gameWithDetails) {
             sendToClient(ws, { type: 'ERROR', payload: { message: 'Game not found.' } });
             return;
        }
        if (gameWithDetails.whitePlayerId !== userId && gameWithDetails.blackPlayerId !== userId && gameWithDetails.status !== 'WAITING') {
             sendToClient(ws, { type: 'ERROR', payload: { message: 'You are not a player in this game.' } });
             return;
        }

        // Reconstruct state (similar to HTTP /load endpoint)
        let winnerVal: 'w' | 'b' | 'draw' | null = null;
        // ... (winner determination logic as in HTTP /load) ...
         if (gameWithDetails.status === 'COMPLETED' || gameWithDetails.status === 'ABORTED') {
            if (gameWithDetails.winnerId === gameWithDetails.whitePlayerId) winnerVal = 'w';
            else if (gameWithDetails.winnerId === gameWithDetails.blackPlayerId) winnerVal = 'b';
            else if (gameWithDetails.status === 'COMPLETED' && !gameWithDetails.winnerId) winnerVal = 'draw';
        }

        if(!gameWithDetails.lastMoveTimestamp){
            gameWithDetails.lastMoveTimestamp = new Date(0); // Default to epoch if not set
        }

        fullGameState = {
            id: gameWithDetails.id,
            fen: gameWithDetails.currentFen as any,
            turn: gameWithDetails.turn as 'w' | 'b',
            whitePlayerId: gameWithDetails.whitePlayerId,
            blackPlayerId: gameWithDetails.blackPlayerId,
            whitePlayerName: gameWithDetails.whitePlayer?.name,
            blackPlayerName: gameWithDetails.blackPlayer?.name,
            status: gameWithDetails.status as any,
            winner: winnerVal,
            timeControl: gameWithDetails.timeControl,
            whiteTimeLeft: gameWithDetails.whiteTimeLeft,
            blackTimeLeft: gameWithDetails.blackTimeLeft,
            lastMoveTimestamp: gameWithDetails.lastMoveTimestamp.getTime(),
            createdAt: gameWithDetails.createdAt.getTime(),
            moves: gameWithDetails.moves.map(m => ({ /* ... map move fields ... */
                 number: m.moveNumber, san: m.moveSAN, playerId: m.playerId, playerName: m.player.name,
                 whiteTimeLeft: m.whiteTimeLeft, blackTimeLeft: m.blackTimeLeft, timestamp: m.timestamp.getTime(),
             })),
        };

        if(!fullGameState) {
            sendToClient(ws, { type: 'ERROR', payload: { message: 'Failed to load game state.' } });
            return;
        }

        // Adjust time for current state if in progress
        if (fullGameState.status === 'IN_PROGRESS') {
            const now = Date.now();
            const elapsed = now - fullGameState.lastMoveTimestamp;
            if (elapsed > 0) {
                if (fullGameState.turn === 'w') fullGameState.whiteTimeLeft -= elapsed;
                else fullGameState.blackTimeLeft -= elapsed;

                // Check for timeout on join (server side check)
                 if (fullGameState.whiteTimeLeft <= 0 || fullGameState.blackTimeLeft <= 0) {
                      const timedOutWinner = fullGameState.whiteTimeLeft <= 0 ? 'b' : 'w';
                      const timedOutReason = `Timeout detected on join for ${timedOutWinner === 'b' ? 'White' : 'Black'}`;
                      console.warn(`Game ${gameId} timed out for ${timedOutWinner === 'b' ? 'White' : 'Black'} on join.`);
                      fullGameState.status = 'COMPLETED';
                      fullGameState.winner = timedOutWinner;
                      // Enqueue status update
                      enqueueDbTask({ type: 'UPDATE_GAME_STATUS', payload: { gameId, status: 'COMPLETED', winner: timedOutWinner, reason: timedOutReason } });
                 }

                fullGameState.whiteTimeLeft = Math.max(0, fullGameState.whiteTimeLeft);
                fullGameState.blackTimeLeft = Math.max(0, fullGameState.blackTimeLeft);
            }
        }

    } catch (error) {
        console.error(`Error loading game ${gameId} for user ${userId}:`, error);
        sendToClient(ws, { type: 'ERROR', payload: { message: 'Failed to load game state.' } });
        return;
    }

    // 2. Manage In-Memory Runtime State
    let gameRuntimeState = games.get(gameId);
    let isNewJoiner = false;

    if (!gameRuntimeState) {
        // First player joining this server instance for this game
        gameRuntimeState = {
            gameId: fullGameState.id,
            players: new Set(),
            currentFen: fullGameState.fen,
            turn: fullGameState.turn,
            whitePlayerId: fullGameState.whitePlayerId,
            blackPlayerId: fullGameState.blackPlayerId,
            whiteTimeLeft: fullGameState.whiteTimeLeft, // Use calculated time
            blackTimeLeft: fullGameState.blackTimeLeft,
            lastMoveTimestamp: Date.now(), // Reset runtime timestamp to now
            timeControl: fullGameState.timeControl,
            status: fullGameState.status,
        };
        games.set(gameId, gameRuntimeState);
        console.log(`Initialized runtime state for game ${gameId}`);
        isNewJoiner = true;
    } else {
        // Game already active in memory, update from loaded state if needed (e.g., status changed)
        // This ensures consistency if DB state changed while no one was connected here
        gameRuntimeState.currentFen = fullGameState.fen;
        gameRuntimeState.turn = fullGameState.turn;
        gameRuntimeState.whiteTimeLeft = fullGameState.whiteTimeLeft; // Update with calculated time
        gameRuntimeState.blackTimeLeft = fullGameState.blackTimeLeft;
        gameRuntimeState.status = fullGameState.status;
        gameRuntimeState.lastMoveTimestamp = Date.now(); // Reset runtime timestamp
        gameRuntimeState.whitePlayerId = fullGameState.whitePlayerId; // Ensure player IDs are current
        gameRuntimeState.blackPlayerId = fullGameState.blackPlayerId;
         if (gameRuntimeState.status !== 'IN_PROGRESS') {
             stopGameTimer(gameRuntimeState); // Stop timer if game ended while user was away
         }
    }

    // 3. Add Player to Runtime State
    ws.gameId = gameId; // Associate WS with game
    gameRuntimeState.players.add(ws);
    console.log(`User ${userId} added to runtime game ${gameId}. Players: ${gameRuntimeState.players.size}`);


    // 4. Handle Player Assignment and Status Update (via DB Queue)
    let needsPlayerAssignment = false;
    let assignedColor: 'w' | 'b' | null = null;
    if (gameRuntimeState.status === 'WAITING') {
        if (!gameRuntimeState.whitePlayerId) {
            gameRuntimeState.whitePlayerId = userId;
            fullGameState.whitePlayerId = userId; // Update the state we send back
            needsPlayerAssignment = true;
            assignedColor = 'w';
        } else if (!gameRuntimeState.blackPlayerId && gameRuntimeState.whitePlayerId !== userId) {
            gameRuntimeState.blackPlayerId = userId;
            fullGameState.blackPlayerId = userId; // Update the state we send back
            needsPlayerAssignment = true;
            assignedColor = 'b';
        }

        if (needsPlayerAssignment && assignedColor) {
             enqueueDbTask({ type: 'ASSIGN_PLAYER', payload: { gameId, userId, color: assignedColor } });
        }

        // Check if game can start
        if (gameRuntimeState.whitePlayerId && gameRuntimeState.blackPlayerId) {
            console.log(`Game ${gameId} starting!`);
            gameRuntimeState.status = 'IN_PROGRESS';
            fullGameState.status = 'IN_PROGRESS'; // Update state to send
            gameRuntimeState.lastMoveTimestamp = Date.now(); // Set start time for timer
            fullGameState.lastMoveTimestamp = gameRuntimeState.lastMoveTimestamp;

             // Enqueue status update to IN_PROGRESS
            enqueueDbTask({ type: 'UPDATE_GAME_STATUS', payload: { gameId, status: 'IN_PROGRESS', winner: null, reason: 'Game started' } });

            // Start the in-memory timer
            startGameTimer(gameRuntimeState, games);
        }
    }

    // 5. Send Full State to Joining Player
    // Send the potentially time-adjusted and status-updated state
    sendToClient(ws, { type: 'FULL_GAME_STATE', payload: fullGameState });

    // 6. Notify Other Players
    const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    broadcastToGame(gameRuntimeState, { type: 'USER_JOINED', payload: { gameId, userId, name: userRecord?.name ?? 'Player' } }, ws);

    // 7. Start Timer if game is already in progress and timer isn't running
    if (gameRuntimeState.status === 'IN_PROGRESS' && !gameRuntimeState.timerInterval) {
         console.log(`Restarting timer for ongoing game ${gameId} on player join.`);
         gameRuntimeState.lastMoveTimestamp = Date.now(); // Reset timer base
        startGameTimer(gameRuntimeState, games);
    }
}


// Handles validating and processing a move
async function handleMakeMove(
    ws: AuthenticatedWebSocket,
    payload: { gameId: string; move: string | Move },
    users: UsersMap,
    games: GamesMap
) {
    const { gameId, move } = payload;
    const userId = ws.userId;
    if (!userId) return; // Should not happen if ws is authenticated

    const gameRuntimeState = games.get(gameId);

    // --- Pre-computation Checks (Use In-Memory State) ---
    if (!gameRuntimeState) {
        sendToClient(ws, { type: 'ERROR', payload: { message: 'Game not found in active runtime.' } });
        return;
    }
    if (gameRuntimeState.status !== 'IN_PROGRESS') {
         sendToClient(ws, { type: 'ERROR', payload: { message: 'Game is not in progress.' } });
        return;
    }
    const playerColor = gameRuntimeState.whitePlayerId === userId ? 'w' : (gameRuntimeState.blackPlayerId === userId ? 'b' : null);
    if (!playerColor || playerColor !== gameRuntimeState.turn) {
        sendToClient(ws, { type: 'ERROR', payload: { message: 'Not your turn.' } });
        return;
    }

    // --- Validate Move ---
    const chess = new Chess(gameRuntimeState.currentFen);
    let validMove: Move | null = null;
    try {
        validMove = chess.move(move);
    } catch (error) {
        console.warn(`Invalid move format from ${userId} in game ${gameId}:`, move);
    }
    if (!validMove) {
        sendToClient(ws, { type: 'ERROR', payload: { message: 'Invalid move.' } });
        return;
    }

    // --- Calculate Time ---
    const now = Date.now();
    const elapsed = now - gameRuntimeState.lastMoveTimestamp;
    let whiteTimeAfterMove = gameRuntimeState.whiteTimeLeft;
    let blackTimeAfterMove = gameRuntimeState.blackTimeLeft;

    if (gameRuntimeState.turn === 'w') {
        whiteTimeAfterMove -= elapsed;
    } else {
        blackTimeAfterMove -= elapsed;
    }
    // Ensure time doesn't go negative before saving
    whiteTimeAfterMove = Math.max(0, whiteTimeAfterMove);
    blackTimeAfterMove = Math.max(0, blackTimeAfterMove);

    // --- Check Game Over ---
    const newFen = chess.fen();
    const newTurn = chess.turn();
    let newStatus = 'IN_PROGRESS';
    let winner: 'w' | 'b' | 'draw' | null = null;
    let gameOverReason = "";

    if (chess.isGameOver()) {
        newStatus = 'COMPLETED';
        stopGameTimer(gameRuntimeState);
        if (chess.isCheckmate()) {
            winner = gameRuntimeState.turn; // Player whose turn it *was* wins by checkmate
            gameOverReason = `Checkmate! ${winner === 'w' ? gameRuntimeState.whitePlayerId : gameRuntimeState.blackPlayerId} wins.`;
        } else {
            winner = 'draw';
            gameOverReason = chess.isStalemate() ? "Draw by Stalemate!" :
                            chess.isThreefoldRepetition() ? "Draw by Threefold Repetition!" :
                            chess.isInsufficientMaterial() ? "Draw by Insufficient Material!" :
                            "Draw by 50-move rule!"; // Simplified draw reason
        }
        console.log(`Game ${gameId} ended: ${gameOverReason}`);
        // Enqueue DB update for game status
         enqueueDbTask({
             type: 'UPDATE_GAME_STATUS',
             payload: { gameId, status: newStatus, winner: winner, reason: gameOverReason }
         });
    }

    // --- Enqueue Move Save Task ---
    const moveNumber = Math.floor(chess.history().length / 2) + (chess.history().length % 2); // Calculate move number
    enqueueDbTask({
        type: 'CREATE_MOVE',
        payload: {
            gameId: gameId,
            playerId: userId,
            moveNumber: moveNumber,
            moveSAN: validMove.san,
            fenAfterMove: newFen,
            whiteTimeLeft: whiteTimeAfterMove, // Time left *after* this move
            blackTimeLeft: blackTimeAfterMove,
            timestamp: now, // Record server processing time
        }
    });

    // --- Update In-Memory Runtime State ---
    gameRuntimeState.currentFen = newFen;
    gameRuntimeState.turn = newTurn;
    gameRuntimeState.whiteTimeLeft = whiteTimeAfterMove;
    gameRuntimeState.blackTimeLeft = blackTimeAfterMove;
    gameRuntimeState.lastMoveTimestamp = now; // Reset for the next player's turn
    gameRuntimeState.status = newStatus as any; // Update status if changed

    // --- Broadcast Update to Clients ---
    const updatePayload: Partial<GameRuntimeState> & { lastMoveSan?: string } = {
        gameId: gameId,
        currentFen: newFen,
        turn: newTurn,
        whiteTimeLeft: whiteTimeAfterMove,
        blackTimeLeft: blackTimeAfterMove,
        lastMoveSan: validMove.san, // Send the move made
        status: newStatus as any,
    };
    broadcastToGame(gameRuntimeState, { type: 'GAME_STATE_UPDATE', payload: updatePayload });

    if (newStatus === 'COMPLETED') {
        broadcastToGame(gameRuntimeState, { type: 'GAME_OVER', payload: { gameId, winner, reason: gameOverReason } });
    }

    console.log(`Processed move ${validMove.san} by ${userId} in game ${gameId}`);
}


// --- Matchmaking ---
const MATCHMAKING_CHECK_INTERVAL = 2000; // Check every 2 seconds

async function tryMatchmaking(users: UsersMap, games: GamesMap) {
    // Iterate over potential time controls (or get known ones from Redis?)
    // For simplicity, assume a few standard time controls
    const timeControls = [60, 180, 300, 600, 900, 1800];

    for (const tc of timeControls) {
        const queueName = getMatchmakingQueueName(tc);
        try {
            // Check queue length efficiently (LLEN) before attempting pops
             const queueLength = await redis.llen(queueName);
             if (queueLength < 2) continue; // Not enough players

            // Pop two players non-blockingly (LPOP)
            const player1Id = await redis.lpop(queueName);
            const player2Id = await redis.lpop(queueName);

            if (player1Id && player2Id) {
                console.log(`Matchmaking: Found potential match for ${tc}s: ${player1Id} vs ${player2Id}`);
                const player1Ws = users.get(player1Id);
                const player2Ws = users.get(player2Id);

                // Check if players are still connected
                if (player1Ws && player1Ws.readyState === WebSocket.OPEN && player2Ws && player2Ws.readyState === WebSocket.OPEN) {
                    // --- Create Game via DB Queue ---
                    const gameId = uuidv4();
                    const initialTimeMs = tc * 1000;
                    const player1Name = (await prisma.user.findUnique({where: {id: player1Id}, select: {name: true}}))?.name ?? 'Player 1';
                    const player2Name = (await prisma.user.findUnique({where: {id: player2Id}, select: {name: true}}))?.name ?? 'Player 2';

                    // Assign colors randomly
                    const whitePlayerId = Math.random() < 0.5 ? player1Id : player2Id;
                    const blackPlayerId = whitePlayerId === player1Id ? player2Id : player1Id;
                    const whitePlayerName = whitePlayerId === player1Id ? player1Name : player2Name;
                    const blackPlayerName = blackPlayerId === player1Id ? player1Name : player2Name;


                    // Enqueue task to create the game record
                    enqueueDbTask({
                        type: 'CREATE_MATCHED_GAME',
                        payload: {
                            gameId: gameId,
                            whitePlayerId: whitePlayerId,
                            blackPlayerId: blackPlayerId,
                            timeControl: tc,
                            initialTimeMs: initialTimeMs
                        }
                    });

                    console.log(`Matchmaking: Enqueued DB creation for game ${gameId} (${whitePlayerName} vs ${blackPlayerName})`);

                    // Notify players via WS
                    sendToClient(whitePlayerId === player1Id ? player1Ws : player2Ws, {
                        type: 'MATCH_FOUND', payload: { gameId, opponentName: blackPlayerName, color: 'w' }
                    });
                    sendToClient(blackPlayerId === player1Id ? player1Ws : player2Ws, {
                        type: 'MATCH_FOUND', payload: { gameId, opponentName: whitePlayerName, color: 'b' }
                    });

                } else {
                    console.log(`Matchmaking: One or both players disconnected (${player1Id}, ${player2Id}). Requeuing.`);
                    // Put players back if they are still connected
                    if (player1Id && (!player1Ws || player1Ws.readyState !== WebSocket.OPEN)) await redis.lpush(queueName, player1Id); // Put back at front
                    if (player2Id && (!player2Ws || player2Ws.readyState !== WebSocket.OPEN)) await redis.lpush(queueName, player2Id);
                }
            } else {
                // If only one player was popped, put them back
                if (player1Id) await redis.lpush(queueName, player1Id);
            }
        } catch (error) {
            console.error(`Matchmaking: Error processing queue ${queueName}:`, error);
        }
    }
}

export function startMatchmakingChecker(users: UsersMap, games: GamesMap) {
     console.log("Starting Matchmaking Queue Checker...");
    setInterval(() => tryMatchmaking(users, games), MATCHMAKING_CHECK_INTERVAL);
}

// --- Main Message Handler ---
export async function handleWebSocketMessage(
    ws: AuthenticatedWebSocket, message: Buffer | string, users: UsersMap, games: GamesMap
) {
    // ... (initial parsing and auth check as before) ...
    const messageString = message.toString();
    const parsedMessage = safeJsonParse(messageString);
    if (!parsedMessage || !ws.userId) return; // Basic checks

    // Add userId from ws if missing in payload (convenience)
    if (!(parsedMessage.payload as any).userId) {
         (parsedMessage.payload as any).userId = ws.userId;
    } else if ((parsedMessage.payload as any).userId !== ws.userId) {
         console.warn(`Message userId mismatch for user ${ws.userId}. Ignoring.`);
         return; // Don't process if payload userId doesn't match socket
    }


    try {
        switch (parsedMessage.type) {
            case 'JOIN_GAME':
                await handleJoinGame(ws, parsedMessage.payload, users, games);
                break;
            case 'MAKE_MOVE':
                await handleMakeMove(ws, parsedMessage.payload, users, games);
                break;
             case 'FIND_MATCH':
                 const queueName = getMatchmakingQueueName(parsedMessage.payload.timeControl);
                 console.log(`User ${ws.userId} entering matchmaking queue ${queueName}`);
                 await redis.lpush(queueName, ws.userId);
                 // Optional: send confirmation to user
                 // Trigger an immediate check after adding
                 tryMatchmaking(users, games);
                 break;
            case 'CHAT_MESSAGE':
                 const chatGameRuntime = games.get(parsedMessage.payload.gameId);
                 if(chatGameRuntime && parsedMessage.payload.name) {
                      broadcastToGame(chatGameRuntime, {
                         type: 'CHAT_MESSAGE',
                         payload: { ...parsedMessage.payload, userId: ws.userId } // Ensure userId is correct
                      }, ws);
                 }
                break;
            // --- Video Signaling Handlers (Broadcast within game runtime) ---
             case 'VIDEO_OFFER':
             case 'VIDEO_ANSWER':
             case 'VIDEO_ICE':
             case 'START_VIDEO':
             case 'END_VIDEO':
                 const signalGameId = parsedMessage.payload.gameId;
                 const signalGameRuntime = games.get(signalGameId);
                  if(signalGameRuntime) {
                      // Add userId to payload before broadcasting if missing
                      const payloadWithUser = { ...parsedMessage.payload, userId: ws.userId };
                      broadcastToGame(signalGameRuntime, { type: parsedMessage.type, payload: payloadWithUser } as MessagePayload, ws);
                  }
                 break;
            default:
                console.warn(`Unhandled message type: ${parsedMessage.type}`);
                sendToClient(ws, { type: 'ERROR', payload: { message: `Unknown message type` } });
        }
    } catch (error) {
        console.error(`Error handling message ${parsedMessage.type} for user ${ws.userId}:`, error);
        sendToClient(ws, { type: 'ERROR', payload: { message: 'Internal server error.' } });
    }
}

// --- Cleanup Logic ---
export function handleWebSocketClose( ws: AuthenticatedWebSocket, users: UsersMap, games: GamesMap ) {
    const userId = ws.userId;
    const gameId = ws.gameId;

    if (userId) {
        console.log(`WebSocket closed for user: ${userId}`);
        users.delete(userId);

        // Remove from matchmaking queues
        const timeControls = [60, 180, 300, 600, 900, 1800]; // Assumed TCs
        timeControls.forEach(tc => {
            redis.lrem(getMatchmakingQueueName(tc), 0, userId)
                 .then(removedCount => {
                     if (removedCount > 0) console.log(`Removed user ${userId} from matchmaking queue ${tc}s`);
                 })
                 .catch(err => console.error(`Error removing ${userId} from queue ${tc}s:`, err));
        });
    }

    if (gameId && games.has(gameId)) {
        const gameRuntimeState = games.get(gameId)!;
        gameRuntimeState.players.delete(ws);
        console.log(`Removed user ${userId || 'unknown'} from runtime game ${gameId}. Players left: ${gameRuntimeState.players.size}`);

        if (gameRuntimeState.players.size === 0) {
            // Last player left the runtime instance
            console.log(`Last player left runtime for game ${gameId}. Cleaning up runtime state.`);
            stopGameTimer(gameRuntimeState); // Stop timer if running
            games.delete(gameId); // Remove from in-memory map
        } else {
            // Others still connected, notify them
            broadcastToGame(gameRuntimeState, { type: 'USER_LEFT', payload: { gameId, userId: userId || 'unknown' } });
        }
    }
     console.log(`Current active runtime games: ${games.size}, Connected users: ${users.size}`);
}