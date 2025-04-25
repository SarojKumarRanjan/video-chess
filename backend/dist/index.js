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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const game_1 = __importDefault(require("./routes/game"));
const prisma_1 = __importDefault(require("./lib/prisma")); // Import to initialize connection early
const redis_1 = __importDefault(require("./lib/redis")); // Import to initialize connection early
const express_session_1 = __importDefault(require("express-session")); // Import session
const passport_1 = __importDefault(require("passport")); // Import passport
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173'; // Get client URL from env
// --- Middleware ---
// 1. CORS - Allow requests from your frontend
app.use((0, cors_1.default)({
    origin: clientUrl, // Allow only your frontend
    credentials: true, // Allow cookies/session info
}));
// 2. Body Parsers
app.use(express_1.default.json()); // Parse JSON bodies
app.use(express_1.default.urlencoded({ extended: true })); // Parse URL-encoded bodies
const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret';
app.use((0, express_session_1.default)({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false, // Important: Only save sessions if modified (e.g., logged in)
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        httpOnly: true, // Prevent client-side access to session cookie
        maxAge: 24 * 60 * 60 * 1000 // 1 day (matches auth.ts setting)
    }
    // Optional: Add Redis store for session persistence across restarts/scaling
    // store: new RedisStore({ client: redis }), // Requires 'connect-redis' package
}));
app.use(passport_1.default.initialize()); // Initialize Passport
app.use(passport_1.default.session());
// --- Routes ---
app.get('/api/health', (req, res) => {
    res.status(200).send('HTTP Server is healthy!');
});
app.use('/api/auth', auth_1.default);
app.use('/api/game', game_1.default);
// --- Basic Error Handling ---
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err.stack || err);
    res.status(err.status || 500).json(Object.assign({ message: err.message || 'Internal Server Error' }, (process.env.NODE_ENV === 'development' && { stack: err.stack })));
});
// --- Start Server ---
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Ensure DB & Redis connections are attempted (ioredis connects lazily)
            yield prisma_1.default.$connect();
            console.log("Prisma connected successfully.");
            yield redis_1.default.ping(); // Explicitly check Redis connection
            console.log("Redis connected successfully (via ping).");
            app.listen(port, () => {
                console.log(`🚀 HTTP Backend running at http://localhost:${port}`);
                console.log(`🔑 Google OAuth Callback URL should be: ${process.env.SERVER_URL}/api/auth/google/callback`);
                console.log(`🔌 Accepting requests from: ${clientUrl}`);
            });
        }
        catch (error) {
            console.error("🚨 Failed to start HTTP server:", error);
            process.exit(1); // Exit if essential services fail
        }
    });
}
startServer();
// Graceful shutdown
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('SIGTERM signal received: closing HTTP server');
    yield prisma_1.default.$disconnect();
    redis_1.default.disconnect();
    console.log('Prisma and Redis disconnected.');
    process.exit(0);
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('SIGINT signal received: closing HTTP server');
    yield prisma_1.default.$disconnect();
    redis_1.default.disconnect();
    console.log('Prisma and Redis disconnected.');
    process.exit(0);
}));
