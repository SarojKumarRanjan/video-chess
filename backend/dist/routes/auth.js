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
exports.ensureAuthenticated = ensureAuthenticated;
exports.getUserIdFromToken = getUserIdFromToken;
const express_1 = require("express");
const passport_1 = __importDefault(require("passport"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const uuid_1 = require("uuid");
const prisma_1 = __importDefault(require("../lib/prisma"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken")); // Using JWT for WS authentication
const router = (0, express_1.Router)();
const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret';
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret'; // Secret for WS tokens
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
if (SESSION_SECRET === 'default_secret' || JWT_SECRET === 'default_jwt_secret') {
    console.warn("WARNING: Using default secrets for session/JWT. Set SESSION_SECRET and JWT_SECRET environment variables.");
}
passport_1.default.use(new passport_google_oauth20_1.Strategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.SERVER_URL}/api/auth/google/callback`,
    scope: ['profile', 'email']
}, (accessToken, refreshToken, profile, done) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        console.log("Google Profile received:", profile.id, profile.displayName, (_b = (_a = profile.emails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.value);
        let user = yield prisma_1.default.user.findUnique({
            where: { googleId: profile.id }
        });
        if (!user) {
            // If user doesn't exist, create a new one
            user = yield prisma_1.default.user.create({
                data: {
                    googleId: profile.id,
                    name: profile.displayName || 'Google User',
                    email: (_d = (_c = profile.emails) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.value,
                    isGuest: false,
                }
            });
            console.log(`New user created via Google: ${user.id} - ${user.name}`);
        }
        else {
            console.log(`Existing user found via Google: ${user.id} - ${user.name}`);
        }
        // Pass the user object to serializeUser
        done(null, user);
    }
    catch (err) {
        console.error("Error during Google OAuth:", err);
        done(err, undefined);
    }
})));
// --- User Serialization/Deserialization (for session) ---
passport_1.default.serializeUser((user, done) => {
    console.log("Serializing user:", user.id);
    done(null, user.id); // Store only user ID in session
});
passport_1.default.deserializeUser((id, done) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Deserializing user:", id);
    try {
        const user = yield prisma_1.default.user.findUnique({ where: { id } });
        done(null, user); // Attach user object to req.user
    }
    catch (err) {
        console.error("Error deserializing user:", err);
        done(err, null);
    }
}));
// --- Auth Routes ---
// 1. Initiate Google Login
router.get('/google', passport_1.default.authenticate('google'));
// 2. Google Callback
router.get('/google/callback', passport_1.default.authenticate('google', {
    failureRedirect: `${CLIENT_URL}/login?error=google_failed`, // Redirect to frontend login page on failure
    // successRedirect: CLIENT_URL, // Redirect to frontend home on success handled below
}), (req, res) => {
    // Successful authentication
    console.log("Google callback successful, user:", req.user);
    // Redirect back to the frontend, it will then fetch user status
    res.redirect(CLIENT_URL || '/');
});
// 3. Play as Guest
router.post('/guest', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const guestId = `guest_${(0, uuid_1.v4)()}`;
        const guestUser = yield prisma_1.default.user.create({
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
            const wsToken = jsonwebtoken_1.default.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' }); // Token valid for 1 day
            res.status(200).json({
                message: 'Guest login successful',
                user: { id: guestUser.id, name: guestUser.name, isGuest: true },
                wsToken: wsToken
            });
        });
    }
    catch (err) {
        console.error("Error creating guest user:", err);
        res.status(500).json({ message: 'Failed to create guest user' });
    }
}));
// 4. Check Auth Status & Get WS Token
router.get('/status', (req, res) => {
    if (req.isAuthenticated() && req.user) {
        console.log("Auth status check: User is authenticated", req.user);
        const user = req.user; // Type assertion after isAuthenticated check
        // Generate JWT token for WebSocket authentication
        const tokenPayload = { userId: user.id, name: user.name, isGuest: user.isGuest };
        const wsToken = jsonwebtoken_1.default.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' }); // Token valid for 1 day
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
    }
    else {
        console.log("Auth status check: User is not authenticated");
        res.status(200).json({ isAuthenticated: false, user: null, wsToken: null });
    }
});
// 5. Logout
router.post('/logout', (req, res, next) => {
    var _a;
    console.log("Logout requested for user:", (_a = req.user) === null || _a === void 0 ? void 0 : _a.id);
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
function ensureAuthenticated(req, res, next) {
    var _a;
    if (req.isAuthenticated()) {
        console.log(`Authenticated user accessing ${req.path}:`, (_a = req.user) === null || _a === void 0 ? void 0 : _a.id);
        return next();
    }
    console.warn(`Unauthenticated access attempt to ${req.path}`);
    res.status(401).json({ message: 'Authentication required' });
}
// Simple middleware to get userId from JWT (for non-session based requests if needed)
// Or better, rely on ensureAuthenticated which uses the session
function getUserIdFromToken(token) {
    if (!token)
        return null;
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        return decoded.userId;
    }
    catch (error) {
        console.error("Invalid JWT token:", error);
        return null;
    }
}
exports.default = router;
