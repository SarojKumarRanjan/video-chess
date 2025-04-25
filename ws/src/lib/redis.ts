import Redis from 'ioredis';

const redisUrl = "rediss://default:AVNS_Gr1rW3yCUFbHxxZhUJi@redis-abishek7766-a16d.h.aivencloud.com:27843";
if (!redisUrl) {
  console.error("REDIS_URL environment variable is not set!");
  process.exit(1);
}

console.log(`Connecting to Redis at ${redisUrl}...`);
const redis = new Redis(redisUrl, { lazyConnect: true });

redis.on('connect', () => console.log('Redis connected.'));
redis.on('error', (err) => console.error('Redis error:', err));

redis.connect().catch(err => console.error("Initial Redis connection failed:", err));

// --- Queue Names ---
export const DB_WRITE_QUEUE = "chess:db_write_queue"; // Add prefix for clarity
export const MATCHMAKING_QUEUE_PREFIX = "chess:matchmaking_queue:"; // Prefix for matchmaking queues

export const getMatchmakingQueueName = (timeControl: number): string => {
    return `${MATCHMAKING_QUEUE_PREFIX}${timeControl}`;
};

export default redis;