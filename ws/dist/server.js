"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const dotenv_1 = __importDefault(require("dotenv"));
const redis_1 = __importDefault(require("./lib/redis")); // Import default export
const gameManager_1 = require("./gameManager");
const dbWriter_1 = require("./dbWriter"); // Import DB writer starter
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const url_1 = __importDefault(require("url"));
dotenv_1.default.config();
const port = parseInt(process.env.PORT || '8080', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret';
// --- Define State Maps Here ---
const users = new Map(); // userId -> WebSocket
/*

    * This map is used to track active users and their WebSocket connections.
    * It allows for sending messages to specific users and managing their connections.
    *
    * Key: userId (string)
    * Value: AuthenticatedWebSocket (WebSocket instance with userId property)
    *
    * the map looks like this:
    * {
    *   "userId1": WebSocketInstance1,
    *   "userId2": WebSocketInstance2,
    *   ...
    * }
    */
const games = new Map(); // gameId -> Runtime State
/*
    * This map is used to track active games and their runtime states.
    * It allows for managing game state, players, and time controls.
    *
    * Key: gameId (string)
    * Value: GameRuntimeState (object containing game state information)
    *
    * the map looks like this:
    * {
    *   "gameId1": GameRuntimeState1,
    *   "gameId2": GameRuntimeState2,
    *   ...
    * }
    */
// -----------------------------
const wss = new ws_1.WebSocketServer({ port });
// --- WebSocket Connection Handling ---
wss.on('connection', (ws, req) => {
    var _a;
    // ... (Authentication logic remains the same) ...
    const queryParams = url_1.default.parse(req.url || '', true).query;
    const token = queryParams.token;
    if (!token) {
        ws.close(1008, "Token required");
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const userId = decoded.userId;
        const userName = decoded.name;
        const authWs = ws;
        authWs.userId = userId;
        if (users.has(userId)) {
            console.warn(`Duplicate connection for ${userId}. Closing old one.`);
            (_a = users.get(userId)) === null || _a === void 0 ? void 0 : _a.terminate(); // Force close old one immediately
        }
        users.set(userId, authWs);
        console.log(`User connected: ${userName} (${userId}). Total users: ${users.size}`);
        authWs.on('message', (message) => {
            (0, gameManager_1.handleWebSocketMessage)(authWs, message, users, games); // Pass maps
        });
        authWs.on('close', (code, reason) => {
            console.log(`WS closed for ${userId}. Code: ${code}`);
            // Only remove user if this specific websocket instance is the one stored
            if (users.get(userId) === authWs) {
                (0, gameManager_1.handleWebSocketClose)(authWs, users, games); // Pass maps
            }
            else {
                console.log(`Closed event for an outdated websocket instance of user ${userId}. Ignoring.`);
            }
        });
        authWs.on('error', (error) => {
            console.error(`WS error for ${userId}:`, error);
            if (users.get(userId) === authWs) {
                (0, gameManager_1.handleWebSocketClose)(authWs, users, games);
            }
            if (authWs.readyState !== ws_1.WebSocket.CLOSED)
                authWs.terminate();
        });
        sendToClient(authWs, { type: 'CONNECTION_ACK', payload: { message: 'Connected' } });
    }
    catch (error) {
        console.error("WS Auth error:", error);
        ws.close(1008, "Invalid token");
    }
});
wss.on('listening', () => {
    console.log(`✅ WebSocket Server listening on port ${port}`);
    // Start background processors
    (0, dbWriter_1.startDbWriter)();
    (0, gameManager_1.startMatchmakingChecker)(users, games); // Pass necessary maps
});
wss.on('error', (error) => { console.error('🚨 WebSocket Server error:', error); });
// Ensure Redis connects
//redis.connect().catch(err => { console.error("Redis connect failed:", err); process.exit(1); });
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing WebSocket server');
    redis_1.default.disconnect();
    wss.close(() => {
        console.log('WebSocket server closed.');
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing WebSocket server');
    redis_1.default.disconnect();
    wss.close(() => {
        console.log('WebSocket server closed.');
        process.exit(0);
    });
});
function sendToClient(ws, message) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
