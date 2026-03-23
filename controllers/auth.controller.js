import axios from "axios";
import crypto from "crypto";
import oauth_user_model from "../models/oauth_user.model.js";

// ── Token refresh helper ──────────────────────────────────────────────────────

async function refreshAccessToken(oauthUser) {
    const params = new URLSearchParams();
    params.append("client_id",     process.env.GOOGLE_CLIENT_ID);
    params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
    params.append("refresh_token", oauthUser.refresh_token);
    params.append("grant_type",    "refresh_token");

    const tokenRes = await axios.post(
        "https://oauth2.googleapis.com/token",
        params,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const newAccessToken = tokenRes.data.access_token;

    await oauth_user_model.updateOne(
        { _id: oauthUser._id },
        { access_token: newAccessToken, tokenRefreshedAt: new Date() }
    );

    return newAccessToken;
}

// ── GET /auth/oauth/callback ──────────────────────────────────────────────────

export const exchangeShortToken = async (req, res) => {
    try {
        const code = req.query.code;

        const params = new URLSearchParams();
        params.append("code",          code);
        params.append("client_id",     process.env.GOOGLE_CLIENT_ID);
        params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
        params.append("redirect_uri",  process.env.REDIRECT_URI);
        params.append("grant_type",    "authorization_code");

        const tokenRes = await axios.post(
            "https://oauth2.googleapis.com/token",
            params,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const { access_token, refresh_token } = tokenRes.data;
        const userId = "user_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");

        let googleEmail = null;
        let googleName  = null;
        try {
            const profileRes = await axios.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                { headers: { Authorization: `Bearer ${access_token}` } }
            );
            googleEmail = profileRes.data.email || null;
            googleName  = profileRes.data.name  || null;
        } catch { /* non-fatal */ }

        if (googleEmail) {
            await oauth_user_model.findOneAndUpdate(
                { googleEmail },
                { userId, access_token, refresh_token, googleName, tokenRefreshedAt: new Date() },
                { upsert: true, new: true }
            );
        } else {
            await new oauth_user_model({ userId, access_token, refresh_token }).save();
        }

        res.redirect(`${process.env.FRONTEND_URL}/home.html?userId=${userId}`);

    } catch (error) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/static-user ─────────────────────────────────────────────────────
// Returns the first (static) OAuth user seeded via init-token.js
// Dashboard calls this so it never needs ?userId= in the URL

export const getStaticUser = async (req, res) => {
    try {
        const oauthUser = await oauth_user_model.findOne({}).sort({ created: 1 });
        if (!oauthUser) {
            return res.status(404).json({ error: "No OAuth user found. Run init-token.js first." });
        }
        res.json({ userId: oauthUser.userId });
    } catch (error) {
        console.error("getStaticUser error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// ── GET /auth/customers ───────────────────────────────────────────────────────

export const getCustomerIds = async (req, res) => {
    try {
        const { userId } = req.query;

        const oauthUser = await oauth_user_model.findOne({ userId });
        if (!oauthUser) return res.status(404).json({ error: "OAuth user not found." });

        const accessToken = await refreshAccessToken(oauthUser);

        const response = await axios.get(
            "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
            {
                headers: {
                    Authorization:     `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                }
            }
        );

        const customerIds = response.data.resourceNames.map(r => r.replace("customers/", ""));
        res.json({ customerIds });

    } catch (error) {
        console.error("getCustomerIds error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/ads-listing ─────────────────────────────────────────────────────
// Returns campaigns with spend & impressions for the last 30 days

export const getAds = async (req, res) => {
    try {
        const { userId, customerId } = req.query;

        if (!customerId) return res.status(400).json({ error: "customerId is required" });

        const oauthUser = await oauth_user_model.findOne({ userId });
        if (!oauthUser) return res.status(404).json({ error: "OAuth user not found." });

        const accessToken = await refreshAccessToken(oauthUser);

        const response = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
            {
                // Fetch campaign name + metrics (spend + impressions) for last 30 days
                query: `
                    SELECT
                        campaign.id,
                        campaign.name,
                        campaign.status,
                        metrics.cost_micros,
                        metrics.impressions,
                        metrics.clicks,
                        metrics.ctr
                    FROM campaign
                    WHERE segments.date DURING LAST_30_DAYS
                    ORDER BY metrics.cost_micros DESC
                `
            },
            {
                headers: {
                    Authorization:     `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                    "Content-Type":    "application/json",
                }
            }
        );

        res.json(response.data);

    } catch (error) {
        console.error("getAds error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};
