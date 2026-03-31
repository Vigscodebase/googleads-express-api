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

// ── Helper: fetch customer IDs from Google Ads API ────────────────────────────

async function fetchCustomerIds(accessToken) {
    try {
        const response = await axios.get(
            "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
            {
                headers: {
                    Authorization:     `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                },
            }
        );
        return response.data.resourceNames.map(r => r.replace("customers/", ""));
    } catch (err) {
        console.warn("fetchCustomerIds warning:", err.response?.data || err.message);
        return [];
    }
}

// ── Helper: fetch Google profile for an access token ─────────────────────────

async function fetchGoogleProfile(accessToken) {
    try {
        const profileRes = await axios.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        return {
            email: profileRes.data.email || null,
            name:  profileRes.data.name  || null,
        };
    } catch {
        return { email: null, name: null };
    }
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

        // Fetch Google profile & customer IDs in parallel
        const [profile, customerIds] = await Promise.all([
            fetchGoogleProfile(access_token),
            fetchCustomerIds(access_token),
        ]);

        const { email: googleEmail, name: googleName } = profile;

        if (googleEmail) {
            await oauth_user_model.findOneAndUpdate(
                { googleEmail },
                { userId, access_token, refresh_token, googleName, customerIds, tokenRefreshedAt: new Date() },
                { upsert: true, new: true }
            );
        } else {
            await new oauth_user_model({ userId, access_token, refresh_token, customerIds }).save();
        }

        res.redirect(`${process.env.FRONTEND_URL}/dashboard.html?userId=${userId}`);

    } catch (error) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/static-user ─────────────────────────────────────────────────────

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

        const customerIds = await fetchCustomerIds(accessToken);
        if (customerIds.length) {
            await oauth_user_model.updateOne({ _id: oauthUser._id }, { customerIds });
        }

        res.json({ customerIds: customerIds.length ? customerIds : oauthUser.customerIds });

    } catch (error) {
        console.error("getCustomerIds error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/accounts ────────────────────────────────────────────────────────
// Returns all connected OAuth accounts for the Account Management page.
// IMPORTANT: Also returns `userId` so the frontend can show it as a fallback
// when googleEmail / googleName are null (old records created before those
// fields existed in the schema).

export const getAccounts = async (req, res) => {
    try {
        const accounts = await oauth_user_model
            .find({})
            .sort({ created: -1 })
            .select("userId googleEmail googleName customerIds tokenRefreshedAt created updated");

        res.json({ accounts });
    } catch (error) {
        console.error("getAccounts error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// ── DELETE /auth/accounts/:id ─────────────────────────────────────────────────

export const deleteAccount = async (req, res) => {
    try {
        const { id } = req.params;

        const deleted = await oauth_user_model.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ error: "Account not found." });
        }

        res.json({ message: "Account removed successfully.", userId: deleted.userId });
    } catch (error) {
        console.error("deleteAccount error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// ── POST /auth/refresh/:id ────────────────────────────────────────────────────
// Refreshes the access token, re-syncs customerIds, AND back-fills
// googleEmail / googleName for old records that were created before those
// fields existed (this is the self-healing migration path).

export const refreshAccountToken = async (req, res) => {
    try {
        const { id } = req.params;

        const oauthUser = await oauth_user_model.findById(id);
        if (!oauthUser) {
            return res.status(404).json({ error: "Account not found." });
        }

        if (!oauthUser.refresh_token) {
            return res.status(400).json({ error: "No refresh token stored for this account." });
        }

        const newAccessToken = await refreshAccessToken(oauthUser);

        // Re-sync customer IDs
        const customerIds = await fetchCustomerIds(newAccessToken);

        // Back-fill profile info if missing (migrates old records)
        const updateFields = {};
        if (customerIds.length) updateFields.customerIds = customerIds;

        if (!oauthUser.googleEmail || !oauthUser.googleName) {
            const profile = await fetchGoogleProfile(newAccessToken);
            if (profile.email) updateFields.googleEmail = profile.email;
            if (profile.name)  updateFields.googleName  = profile.name;
        }

        if (Object.keys(updateFields).length) {
            await oauth_user_model.updateOne({ _id: oauthUser._id }, updateFields);
        }

        res.json({ message: "Token refreshed successfully.", userId: oauthUser.userId });
    } catch (error) {
        console.error("refreshAccountToken error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/ads-listing ─────────────────────────────────────────────────────

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
                },
            }
        );

        res.json(response.data);

    } catch (error) {
        console.error("getAds error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};
