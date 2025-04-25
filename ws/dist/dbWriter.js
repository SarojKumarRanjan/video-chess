"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDbWriter = startDbWriter;
// src/dbWriter.ts
const redis_1 = __importStar(require("./lib/redis"));
const prisma_1 = __importDefault(require("./lib/prisma")); // Adjust path
const chess_js_1 = require("chess.js"); // May need for PGN generation at end
const PROCESSING_INTERVAL = 500; // Check queue every 500ms (adjust as needed)
let isProcessing = false; // Simple lock to prevent concurrent processing runs
function processDbWriteQueue() {
    return __awaiter(this, void 0, void 0, function* () {
        if (isProcessing)
            return; // Don't run if already processing
        isProcessing = true;
        // console.log("DB Writer: Checking queue...");
        try {
            // Process one item at a time for simplicity
            // Use RPOP to get the oldest item (FIFO)
            const data = yield redis_1.default.rpop(redis_1.DB_WRITE_QUEUE);
            if (data) {
                console.log("DB Writer: Processing task...");
                const task = JSON.parse(data);
                // Use Prisma Transaction for multi-step updates if needed
                // const result = await prisma.$transaction(async (tx) => { ... });
                switch (task.type) {
                    case 'CREATE_MOVE':
                        const { gameId, playerId, moveNumber, moveSAN, fenAfterMove, whiteTimeLeft, blackTimeLeft, timestamp } = task.payload;
                        // 1. Create the Move record
                        yield prisma_1.default.move.create({
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
                        yield prisma_1.default.game.update({
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
                        let winnerId = null;
                        let pgn = undefined;
                        // Fetch game to determine winnerId and potentially generate PGN
                        const gameData = yield prisma_1.default.game.findUnique({
                            where: { id: statusGameId },
                            select: { whitePlayerId: true, blackPlayerId: true }
                        });
                        if (gameData) {
                            if (winner === 'w')
                                winnerId = gameData.whitePlayerId;
                            else if (winner === 'b')
                                winnerId = gameData.blackPlayerId;
                        }
                        // Generate PGN if game completed normally (optional)
                        if (status === 'COMPLETED') {
                            try {
                                const moves = yield prisma_1.default.move.findMany({
                                    where: { gameId: statusGameId },
                                    orderBy: { moveNumber: 'asc' },
                                    select: { moveSAN: true }
                                });
                                const chess = new chess_js_1.Chess(); // Start from initial position
                                moves.forEach(m => { try {
                                    chess.move(m.moveSAN);
                                }
                                catch (e) { } }); // Replay moves
                                pgn = chess.pgn();
                            }
                            catch (pgnError) {
                                console.error(`DB Writer: Failed to generate PGN for game ${statusGameId}:`, pgnError);
                            }
                        }
                        yield prisma_1.default.game.update({
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
                        yield prisma_1.default.game.update({
                            where: { id: assignGameId },
                            data: Object.assign(Object.assign(Object.assign({}, (color === 'w' && { whitePlayerId: userId })), (color === 'b' && { blackPlayerId: userId })), { 
                                // Optionally update status if both players are now assigned
                                // status: 'IN_PROGRESS' // This requires checking if the *other* player is already set
                                updatedAt: new Date() })
                        });
                        console.log(`DB Writer: Assigned user ${userId} as ${color} to game ${assignGameId}`);
                        break;
                    case 'CREATE_MATCHED_GAME':
                        const { gameId: matchGameId, whitePlayerId, blackPlayerId, timeControl, initialTimeMs } = task.payload;
                        yield prisma_1.default.game.create({
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
                        console.warn("DB Writer: Unknown task type received:", task.type);
                }
                // Process next item immediately if one was found
                isProcessing = false; // Release lock before potentially immediate next run
                setImmediate(processDbWriteQueue); // Check again very soon
            }
            else {
                // Queue is empty, check again after interval
                isProcessing = false; // Release lock
                setTimeout(processDbWriteQueue, PROCESSING_INTERVAL);
            }
        }
        catch (error) {
            console.error("DB Writer: Error processing queue item:", error);
            // Handle error: log, potentially push to a dead-letter queue, etc.
            // const failedTask = data ? JSON.parse(data) : null;
            // console.error("Failed Task:", failedTask);
            isProcessing = false; // Release lock
            setTimeout(processDbWriteQueue, PROCESSING_INTERVAL * 2); // Wait longer after an error
        }
    });
}
function startDbWriter() {
    console.log("Starting DB Writer Queue Processor...");
    processDbWriteQueue(); // Start the first check
}
