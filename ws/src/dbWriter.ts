// src/dbWriter.ts
import redis, { DB_WRITE_QUEUE } from './lib/redis';
import prisma from './lib/prisma'; // Adjust path
import { DbWritePayload } from './types';
import { Chess } from 'chess.js'; // May need for PGN generation at end

const PROCESSING_INTERVAL = 500; // Check queue every 500ms (adjust as needed)
let isProcessing = false; // Simple lock to prevent concurrent processing runs

async function processDbWriteQueue() {
    if (isProcessing) return; // Don't run if already processing
    isProcessing = true;
    // console.log("DB Writer: Checking queue...");

    try {
        // Process one item at a time for simplicity
        // Use RPOP to get the oldest item (FIFO)
        const data = await redis.rpop(DB_WRITE_QUEUE);

        if (data) {
            console.log("DB Writer: Processing task...");
            const task = JSON.parse(data) as DbWritePayload;

            // Use Prisma Transaction for multi-step updates if needed
            // const result = await prisma.$transaction(async (tx) => { ... });

            switch (task.type) {
                case 'CREATE_MOVE':
                    const { gameId, playerId, moveNumber, moveSAN, fenAfterMove, whiteTimeLeft, blackTimeLeft, timestamp } = task.payload;
                    // 1. Create the Move record
                    await prisma.move.create({
                        data: {
                            gameId,
                            playerId,
                            moveNumber,
                            moveSAN,
                            fenAfterMove,
                            whiteTimeLeft,
                            blackTimeLeft,
                            timestamp: new Date(timestamp), // Convert JS timestamp back to Date
                        }
                    });
                    // 2. Update the Game's cached state
                    await prisma.game.update({
                        where: { id: gameId },
                        data: {
                            currentFen: fenAfterMove,
                            turn: fenAfterMove.split(' ')[1], // Extract turn from FEN
                            whiteTimeLeft: whiteTimeLeft,
                            blackTimeLeft: blackTimeLeft,
                            lastMoveTimestamp: new Date(timestamp),
                            updatedAt: new Date(), // Update timestamp
                        }
                    });
                    console.log(`DB Writer: Saved move ${moveNumber} for game ${gameId}`);
                    break;

                case 'UPDATE_GAME_STATUS':
                    const { gameId: statusGameId, status, winner, reason } = task.payload;
                    let winnerId: string | null = null;
                    let pgn: string | undefined = undefined;

                    // Fetch game to determine winnerId and potentially generate PGN
                    const gameData = await prisma.game.findUnique({
                         where: { id: statusGameId },
                         select: { whitePlayerId: true, blackPlayerId: true }
                    });

                    if (gameData) {
                        if (winner === 'w') winnerId = gameData.whitePlayerId;
                        else if (winner === 'b') winnerId = gameData.blackPlayerId;
                    }

                     // Generate PGN if game completed normally (optional)
                     if (status === 'COMPLETED') {
                         try {
                            const moves = await prisma.move.findMany({
                                where: { gameId: statusGameId },
                                orderBy: { moveNumber: 'asc' },
                                select: { moveSAN: true }
                            });
                            const chess = new Chess(); // Start from initial position
                            moves.forEach(m => { try { chess.move(m.moveSAN); } catch(e){} }); // Replay moves
                            pgn = chess.pgn();
                         } catch(pgnError) {
                             console.error(`DB Writer: Failed to generate PGN for game ${statusGameId}:`, pgnError);
                         }
                     }

                    await prisma.game.update({
                        where: { id: statusGameId },
                        data: {
                            status: status,
                            winnerId: winnerId,
                            endTime: new Date(),
                            pgn: pgn, // Store final PGN
                            updatedAt: new Date(),
                            // Ensure time isn't negative if status change is due to timeout
                            whiteTimeLeft: status === 'COMPLETED' && winner === 'b' ? 0 : undefined,
                            blackTimeLeft: status === 'COMPLETED' && winner === 'w' ? 0 : undefined,
                        }
                    });
                    console.log(`DB Writer: Updated status for game ${statusGameId} to ${status}, Winner: ${winner || 'None'}`);
                    break;

                case 'ASSIGN_PLAYER':
                     const { gameId: assignGameId, userId, color } = task.payload;
                      await prisma.game.update({
                          where: { id: assignGameId },
                          data: {
                              ...(color === 'w' && { whitePlayerId: userId }),
                              ...(color === 'b' && { blackPlayerId: userId }),
                              // Optionally update status if both players are now assigned
                              // status: 'IN_PROGRESS' // This requires checking if the *other* player is already set
                              updatedAt: new Date(),
                          }
                      });
                     console.log(`DB Writer: Assigned user ${userId} as ${color} to game ${assignGameId}`);
                    break;

                case 'CREATE_MATCHED_GAME':
                     const { gameId: matchGameId, whitePlayerId, blackPlayerId, timeControl, initialTimeMs } = task.payload;
                     await prisma.game.create({
                         data: {
                             id: matchGameId,
                             whitePlayerId: whitePlayerId,
                             blackPlayerId: blackPlayerId,
                             status: 'IN_PROGRESS', // Matched games start immediately
                             timeControl: timeControl,
                             whiteTimeLeft: initialTimeMs,
                             blackTimeLeft: initialTimeMs,
                             lastMoveTimestamp: new Date(),
                         }
                     });
                     console.log(`DB Writer: Created matched game ${matchGameId} in DB`);
                    break;

                default:
                    console.warn("DB Writer: Unknown task type received:", (task as any).type);
            }

            // Process next item immediately if one was found
             isProcessing = false; // Release lock before potentially immediate next run
             setImmediate(processDbWriteQueue); // Check again very soon

        } else {
            // Queue is empty, check again after interval
            isProcessing = false; // Release lock
            setTimeout(processDbWriteQueue, PROCESSING_INTERVAL);
        }
    } catch (error) {
        console.error("DB Writer: Error processing queue item:", error);
        // Handle error: log, potentially push to a dead-letter queue, etc.
        // const failedTask = data ? JSON.parse(data) : null;
        // console.error("Failed Task:", failedTask);
        isProcessing = false; // Release lock
        setTimeout(processDbWriteQueue, PROCESSING_INTERVAL * 2); // Wait longer after an error
    }
}

export function startDbWriter() {
    console.log("Starting DB Writer Queue Processor...");
    processDbWriteQueue(); // Start the first check
}