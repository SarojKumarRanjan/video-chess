"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMatchmakingQueueName = exports.MATCHMAKING_QUEUE_PREFIX = exports.DB_WRITE_QUEUE = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = "rediss://default:AVNS_Gr1rW3yCUFbHxxZhUJi@redis-abishek7766-a16d.h.aivencloud.com:27843";
if (!redisUrl) {
    console.error("REDIS_URL environment variable is not set!");
    process.exit(1);
}
console.log(`Connecting to Redis at ${redisUrl}...`);
const redis = new ioredis_1.default(redisUrl, { lazyConnect: true });
redis.on('connect', () => console.log('Redis connected.'));
redis.on('error', (err) => console.error('Redis error:', err));
redis.connect().catch(err => console.error("Initial Redis connection failed:", err));
// --- Queue Names ---
exports.DB_WRITE_QUEUE = "chess:db_write_queue"; // Add prefix for clarity
exports.MATCHMAKING_QUEUE_PREFIX = "chess:matchmaking_queue:"; // Prefix for matchmaking queues
const getMatchmakingQueueName = (timeControl) => {
    return `${exports.MATCHMAKING_QUEUE_PREFIX}${timeControl}`;
};
exports.getMatchmakingQueueName = getMatchmakingQueueName;
exports.default = redis;
