import express, { Router, Request, Response } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import jwt from 'jsonwebtoken'; // Using JWT for WS authentication

const router = Router();

const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret';
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret'; // Secret for WS tokens
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

if (SESSION_SECRET === 'default_secret' || JWT_SECRET === 'default_jwt_secret') {
    console.warn("WARNING: Using default secrets for session/JWT. Set SESSION_SECRET and JWT_SECRET environment variables.");
}



passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: `${process.env.SERVER_URL}/api/auth/google/callback`,
    scope: ['profile', 'email']
},
    async (accessToken, refreshToken, profile, done) => {
        try {
            console.log("Google Profile received:", profile.id, profile.displayName, profile.emails?.[0]?.value);
            let user = await prisma.user.findUnique({
                where: { googleId: profile.id }
            });

            if (!user) {
                // If user doesn't exist, create a new one
                user = await prisma.user.create({
                    data: {
                        googleId: profile.id,
                        name: profile.displayName || 'Google User',
                        email: profile.emails?.[0]?.value,
                        isGuest: false,
                    }
                });
                console.log(`New user created via Google: ${user.id} - ${user.name}`);
            } else {
                console.log(`Existing user found via Google: ${user.id} - ${user.name}`);
            }
            // Pass the user object to serializeUser
            done(null, user);
        } catch (err: any) {
            console.error("Error during Google OAuth:", err);
            done(err, undefined);
        }
    }
));

// --- User Serialization/Deserialization (for session) ---
passport.serializeUser((user: any, done) => {
    console.log("Serializing user:", user.id);
    done(null, user.id); // Store only user ID in session
});

passport.deserializeUser(async (id: string, done) => {
    console.log("Deserializing user:", id);
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user); // Attach user object to req.user
    } catch (err) {
        console.error("Error deserializing user:", err);
        done(err, null);
    }
});

// --- Auth Routes ---

// 1. Initiate Google Login
router.get('/google', passport.authenticate('google'));

// 2. Google Callback
router.get('/google/callback',
    passport.authenticate('google', {
        failureRedirect: `${CLIENT_URL}/login?error=google_failed`, // Redirect to frontend login page on failure
        // successRedirect: CLIENT_URL, // Redirect to frontend home on success handled below
    }),
    (req: Request, res: Response) => {
        // Successful authentication
        console.log("Google callback successful, user:", req.user);
        // Redirect back to the frontend, it will then fetch user status
        res.redirect(CLIENT_URL || '/');
    }
);

// 3. Play as Guest
router.post('/guest', async (req: Request, res: Response) => {
    try {
        const guestId = `guest_${uuidv4()}`;
        const guestUser = await prisma.user.create({
            data: {
                name: `Guest ${guestId.substring(0, 6)}`,
                isGuest: true,
                // No email or googleId for guests
            }
        });
        console.log(`Guest user created: ${guestUser.id} - ${guestUser.name}`);

        // Manually log in the guest user for session purposes (optional, JWT is primary)
        req.login(guestUser, (err) => {
            if (err) {
                console.error("Error logging in guest user:", err);
                return res.status(500).json({ message: "Failed to create guest session" });
            }

            // Generate JWT token for WebSocket authentication
            const tokenPayload = { userId: guestUser.id, name: guestUser.name, isGuest: true };
            const wsToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' }); // Token valid for 1 day

            res.status(200).json({
                message: 'Guest login successful',
                user: { id: guestUser.id, name: guestUser.name, isGuest: true },
                wsToken: wsToken
            });
        });

    } catch (err) {
        console.error("Error creating guest user:", err);
        res.status(500).json({ message: 'Failed to create guest user' });
    }
});

// 4. Check Auth Status & Get WS Token
router.get('/status', (req: Request, res: Response) => {
    if (req.isAuthenticated() && req.user) {
        console.log("Auth status check: User is authenticated", req.user);
        const user = req.user as any; // Type assertion after isAuthenticated check

        // Generate JWT token for WebSocket authentication
        const tokenPayload = { userId: user.id, name: user.name, isGuest: user.isGuest };
        const wsToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' }); // Token valid for 1 day

        res.status(200).json({
            isAuthenticated: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                isGuest: user.isGuest
            },
            wsToken: wsToken // Send token to client
        });
    } else {
        console.log("Auth status check: User is not authenticated");
        res.status(200).json({ isAuthenticated: false, user: null, wsToken: null });
    }
});

// 5. Logout
router.post('/logout', (req: Request, res: Response, next) => {
    console.log("Logout requested for user:", req.user?.id);
    req.logout((err) => {
        if (err) {
            console.error("Error during logout:", err);
            return next(err);
        }
        req.session.destroy((err) => {
            if (err) {
                console.error("Error destroying session:", err);
                return res.status(500).send('Could not log out.');
            }
            res.clearCookie('connect.sid'); // Clear the session cookie
            console.log("User logged out successfully.");
            res.status(200).json({ message: 'Logged out successfully' });
        });
    });
});

// Middleware to protect routes
export function ensureAuthenticated(req: Request, res: Response, next: Function) {
    if (req.isAuthenticated()) {
        console.log(`Authenticated user accessing ${req.path}:`, req.user?.id);
        return next();
    }
    console.warn(`Unauthenticated access attempt to ${req.path}`);
    res.status(401).json({ message: 'Authentication required' });
}

// Simple middleware to get userId from JWT (for non-session based requests if needed)
// Or better, rely on ensureAuthenticated which uses the session
export function getUserIdFromToken(token: string): string | null {
     if (!token) return null;
     try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        return decoded.userId;
     } catch (error) {
        console.error("Invalid JWT token:", error);
        return null;
     }
}


export default router;