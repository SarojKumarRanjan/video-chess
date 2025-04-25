import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import gameRoutes from './routes/game';
import prisma from './lib/prisma'; // Import to initialize connection early
import redis from './lib/redis'; // Import to initialize connection early
import session from 'express-session'; // Import session
import passport from 'passport'; // Import passport

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173'; // Get client URL from env

// --- Middleware ---
// 1. CORS - Allow requests from your frontend
app.use(cors({
    origin: clientUrl, // Allow only your frontend
    credentials: true, // Allow cookies/session info
}));

// 2. Body Parsers
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies


const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret';


app.use(session({
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

app.use(passport.initialize()); // Initialize Passport
app.use(passport.session());
// --- Routes ---
app.get('/api/health', (req, res) => {
    res.status(200).send('HTTP Server is healthy!');
});

app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);

// --- Basic Error Handling ---
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err.stack || err);
    res.status(err.status || 500).json({
        message: err.message || 'Internal Server Error',
        // Optionally include stack trace in development
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// --- Start Server ---
async function startServer() {
    try {
        // Ensure DB & Redis connections are attempted (ioredis connects lazily)
        await prisma.$connect();
        console.log("Prisma connected successfully.");
        await redis.ping(); // Explicitly check Redis connection
        console.log("Redis connected successfully (via ping).");

        app.listen(port, () => {
            console.log(`🚀 HTTP Backend running at http://localhost:${port}`);
            console.log(`🔑 Google OAuth Callback URL should be: ${process.env.SERVER_URL}/api/auth/google/callback`);
            console.log(`🔌 Accepting requests from: ${clientUrl}`);
        });
    } catch (error) {
        console.error("🚨 Failed to start HTTP server:", error);
        process.exit(1); // Exit if essential services fail
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await prisma.$disconnect();
    redis.disconnect();
    console.log('Prisma and Redis disconnected.');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server');
    await prisma.$disconnect();
    redis.disconnect();
    console.log('Prisma and Redis disconnected.');
    process.exit(0);
});