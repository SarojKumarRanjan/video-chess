import Redis from 'ioredis';
import { FullGameState } from '../types';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL environment variable is not set!");
  process.exit(1);
}

console.log(`Connecting to Redis at ${redisUrl}...`);
// Use lazy connect to prevent issues during import if Redis isn't ready
const redis = new Redis(redisUrl, { lazyConnect: true });

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


export default redis;

// Helper function to set initial game state in Redis
export async function initGameInRedis(gameId: string, whitePlayerId: string | null, blackPlayerId: string | null, timeControl: number): Promise<void> {
    const initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; // Standard starting position
    const now = Date.now();
    const initialGameState: Partial<FullGameState> = {
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
        const redisData: { [key: string]: string } = {};
        for (const [key, value] of Object.entries(initialGameState)) {
            if (value !== null && value !== undefined) {
                redisData[key] = JSON.stringify(value); // Store everything as JSON strings
            }
        }

        await redis.hset(`game:${gameId}`, redisData);
        console.log(`Initial state for game ${gameId} set in Redis.`);
    } catch (error) {
        console.error(`Error setting initial game state in Redis for game ${gameId}:`, error);
        throw error; // Re-throw to indicate failure
    }
}