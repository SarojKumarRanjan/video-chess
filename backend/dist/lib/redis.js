"use strict";
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
exports.initGameInRedis = initGameInRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    console.error("REDIS_URL environment variable is not set!");
    process.exit(1);
}
console.log(`Connecting to Redis at ${redisUrl}...`);
// Use lazy connect to prevent issues during import if Redis isn't ready
const redis = new ioredis_1.default(redisUrl, { lazyConnect: true });
redis.on('connect', () => {
    console.log('Successfully connected to Redis.');
});
redis.on('error', (err) => {
    console.error('Redis connection error:', err);
    // Optional: attempt reconnection or exit
    // process.exit(1);
});
// Ensure connection is attempted
redis.connect().catch(err => console.error("Initial Redis connection failed:", err));
exports.default = redis;
// Helper function to set initial game state in Redis
function initGameInRedis(gameId, whitePlayerId, blackPlayerId, timeControl) {
    return __awaiter(this, void 0, void 0, function* () {
        const initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; // Standard starting position
        const now = Date.now();
        const initialGameState = {
            id: gameId,
            fen: initialFen,
            whitePlayerId: whitePlayerId,
            blackPlayerId: blackPlayerId,
            status: whitePlayerId && blackPlayerId ? 'IN_PROGRESS' : 'WAITING',
            turn: 'w',
            winner: null,
            timeControl: timeControl,
            whiteTimeLeft: timeControl * 1000, // Store time in milliseconds
            blackTimeLeft: timeControl * 1000,
            lastMoveTimestamp: now,
            createdAt: now,
        };
        try {
            // Use HSET to store the game state as a hash
            // Convert object values to strings for Redis hash
            const redisData = {};
            for (const [key, value] of Object.entries(initialGameState)) {
                if (value !== null && value !== undefined) {
                    redisData[key] = JSON.stringify(value); // Store everything as JSON strings
                }
            }
            yield redis.hset(`game:${gameId}`, redisData);
            console.log(`Initial state for game ${gameId} set in Redis.`);
        }
        catch (error) {
            console.error(`Error setting initial game state in Redis for game ${gameId}:`, error);
            throw error; // Re-throw to indicate failure
        }
    });
}
