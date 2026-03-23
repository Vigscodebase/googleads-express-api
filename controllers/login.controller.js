import crypto from "crypto";
import bcrypt from "bcrypt";
import admin_model from "../models/admin.model.js";

const SALT_ROUNDS    = 10;
const SESSION_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

// ── Middleware: protect routes ────────────────────────────────────────────────

export async function requireLogin(req, res, next) {
    const token = req.headers["x-session-token"] || req.query.sessionToken;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    try {
        const admin = await admin_model.findOne({ "sessions.token": token });
        if (!admin)  return res.status(401).json({ error: "Invalid or expired session" });

        const session = admin.sessions.find(s => s.token === token);
        if (Date.now() - new Date(session.createdAt).getTime() > SESSION_AGE_MS) {
            await admin_model.updateOne({ _id: admin._id }, { $pull: { sessions: { token } } });
            return res.status(401).json({ error: "Session expired, please log in again" });
        }

        req.sessionUser  = admin.email;
        req.sessionAdmin = admin;
        next();

    } catch (error) {
        console.error("requireLogin error:", error.message);
        res.status(500).json({ error: "Auth check failed" });
    }
}

// ── POST /logincheck/signup ───────────────────────────────────────────────────

export const signup = async (req, res) => {
    try {
        const { fullname, username, email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

        const existing = await admin_model.findOne({ email });
        if (existing) return res.status(400).json({ message: "Email already registered" });

        bcrypt.hash(password, SALT_ROUNDS, async (err, hash) => {
            if (err) return res.status(500).json({ message: "Password hashing failed" });
            const admin = new admin_model({ fullname, username, email, password: hash, sessions: [] });
            await admin.save();
            return res.status(200).json({ message: "Admin account created successfully" });
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ── POST /logincheck/login  (email + password) ────────────────────────────────

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

        const admin = await admin_model.findOne({ email });
        if (!admin)  return res.status(401).json({ error: "Invalid email or password" });

        const match = bcrypt.compareSync(password, admin.password);
        if (!match)  return res.status(401).json({ error: "Invalid email or password" });

        const token = generateToken();
        await admin_model.updateOne(
            { _id: admin._id },
            { $push: { sessions: { token, createdAt: new Date() } } }
        );

        res.status(200).json({ token, email: admin.email });

    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// ── POST /logincheck/logout ───────────────────────────────────────────────────

export const logout = async (req, res) => {
    const token = req.headers["x-session-token"] || req.query.sessionToken;
    if (token) {
        try {
            await admin_model.updateOne(
                { "sessions.token": token },
                { $pull: { sessions: { token } } }
            );
        } catch (error) { console.error("Logout error:", error.message); }
    }
    res.status(200).json({ message: "Logged out successfully" });
};

// ── GET /logincheck/me ────────────────────────────────────────────────────────

export const me = (req, res) => {
    res.status(200).json({ email: req.sessionUser });
};
