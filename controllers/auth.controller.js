import axios from "axios";
import bcrypt from "bcrypt";
import oauth_user_model from "../models/oauth_user.model.js";
import admin_model from "../models/admin.model.js";
import role from "../models/role.js"
import crypto from "crypto";

// ── Token refresh helper ──────────────────────────────────────────────────────

async function refreshAccessToken(oauthUser) {
    const params = new URLSearchParams();
    params.append("client_id", process.env.GOOGLE_CLIENT_ID);
    params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
    params.append("refresh_token", oauthUser.refresh_token);
    params.append("grant_type", "refresh_token");
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

async function fetchCustomerIds(accessToken) {
    try {
        const response = await axios.get(
            "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
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

async function fetchGoogleProfile(accessToken) {
    const res = await axios.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }
    );
    return res.data;
}

// ── Build GAQL date condition from query params ───────────────────────────────
function buildDateCondition(dateRange, startDate, endDate) {
    if (dateRange === "custom" && startDate && endDate) {
        return `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
    }
    const allowed = ["TODAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "LAST_MONTH"];
    const range = allowed.includes(dateRange) ? dateRange : "LAST_30_DAYS";
    return `segments.date DURING ${range}`;
}

async function handleGoogleOAuthSuccess(profile) {
    try {
        const adminEmail = profile.email;
        const oauthUser = await oauth_user_model.findOne({ googleEmail: adminEmail });
        if (!oauthUser) { console.log("❌ No oauth user found"); return; }
        await admin_model.updateOne(
            { email: adminEmail },
            { $addToSet: { oauthUserIds: oauthUser.userId } }
        );
        console.log("✅ OAuth user linked successfully");
    } catch (err) {
        console.error(err);
    }
}

async function fetchCustomerNames(accessToken, loginCustomerId) {
    try {
        const query = `
            SELECT
                customer_client.id,
                customer_client.descriptive_name,
                customer_client.level,
                customer_client.manager
            FROM customer_client
            WHERE customer_client.level <= 1
        `;
        const response = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${loginCustomerId}/googleAds:search`,
            { query },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                    "login-customer-id": loginCustomerId
                },
            }
        );
        return response.data.results.map(r => ({
            id: r.customerClient.id,
            name: r.customerClient.descriptiveName || `Customer ${r.customerClient.id}`
        }));
    } catch (err) {
        console.warn("fetchCustomerNames error:", err.response?.data || err.message);
        throw err.response?.data || { message: err.message };
    }
}

// ── GET /auth/oauth/callback ──────────────────────────────────────────────────

export const exchangeShortToken = async (req, res) => {
    try {
        const code = req.query.code;
        const params = new URLSearchParams();
        params.append("code", code);
        params.append("client_id", process.env.GOOGLE_CLIENT_ID);
        params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
        params.append("redirect_uri", process.env.REDIRECT_URI);
        params.append("grant_type", "authorization_code");

        const tokenRes = await axios.post(
            "https://oauth2.googleapis.com/token",
            params,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        const { access_token, refresh_token } = tokenRes.data;

        const [profile, customerIds] = await Promise.all([
            fetchGoogleProfile(access_token),
            fetchCustomerIds(access_token),
        ]);

        await handleGoogleOAuthSuccess(profile);

        const { email: googleEmail, name: googleName } = profile;

        let existingUser = await oauth_user_model.findOne({ googleEmail });
        const userId = existingUser?.userId ||
            "user_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");

        if (googleEmail) {
            await oauth_user_model.findOneAndUpdate(
                { googleEmail },
                { userId, access_token, refresh_token, googleName, customerIds, tokenRefreshedAt: new Date() },
                { upsert: true, new: true }
            );
        } else {
            await new oauth_user_model({ userId, access_token, refresh_token, customerIds }).save();
        }

        res.redirect(`${process.env.FRONTEND_URL}/accountaccess.html?userId=${userId}`);
    } catch (error) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/static-user ─────────────────────────────────────────────────────

export const getStaticUser = async (req, res) => {
    try {
        const oauthUser = await oauth_user_model.findOne({}).sort({ created: 1 });
        if (!oauthUser) return res.status(404).json({ error: "No OAuth user found." });
        res.json({ userId: oauthUser.userId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── GET /auth/accounts ────────────────────────────────────────────────────────
// Super admin → returns ALL oauth accounts (no filter)
// Regular admin → only accounts from their customerAccess list

export const getAccounts = async (req, res) => {
    try {
        const admin = await admin_model.findById(req.sessionAdmin.id);

        // ✅ SUPER ADMIN: global access — return every connected Google account
        if (admin.role === "super_admin") {
            const accounts = await oauth_user_model.find({}).sort({ created: -1 });
            return res.json({ accounts });
        }

        // Regular admin: filter by their assigned customerAccess
        const allowedUserIds = (admin.customerAccess || []).map(x => x.userId);
        if (!allowedUserIds.length) {
            return res.json({ accounts: [] });
        }

        const accounts = await oauth_user_model
            .find({ userId: { $in: allowedUserIds } })
            .sort({ created: -1 });

        res.json({ accounts });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── GET /auth/customers ───────────────────────────────────────────────────────
// Regular admin → intersection of Google API customers with their DB customerAccess
// Super admin → all customers from Google API (no intersection filter)

export const getCustomerIds = async (req, res) => {
    try {
        const { userId } = req.query;

        const admin = await admin_model.findById(req.sessionAdmin.id);

        const oauthUser = await oauth_user_model.findOne({ userId });
        if (!oauthUser) {
            return res.status(404).json({ error: "OAuth user not found." });
        }

        const accessToken = await refreshAccessToken(oauthUser);
        const googleCustomerIds = await fetchCustomerIds(accessToken);

        let finalIds;

        if (admin.role === "super_admin") {
            // ✅ SUPER ADMIN: use all customer IDs Google returns — no DB intersection
            // finalIds = googleCustomerIds.length ? googleCustomerIds : (oauthUser.customerIds || []);
            finalIds = googleCustomerIds.length ? googleCustomerIds : ([]);
        } else {
            // Regular admin: intersect with their allowed customerAccess
            const dbCustomerIds =
                (admin.customerAccess || [])
                    .filter(x => x.userId === userId)
                    .flatMap(x => x.customerIds);

            finalIds = googleCustomerIds.filter(id => dbCustomerIds.includes(id));
        }

        if (!finalIds.length) {
            return res.json({ customers: [] });
        }

        const customers = [];
        for (const cid of finalIds) {
            try {
                const list = await fetchCustomerNames(accessToken, cid);
                const found = list.find(c => c.id === cid);
                customers.push({
                    id: cid,
                    name: found?.name || `Customer ${cid}`,
                    status: "success"
                });
            } catch (e) {
                customers.push({
                    id: cid,
                    name: `Customer ${cid}`,
                    status: "error",
                    error: e?.error?.message || e?.message || JSON.stringify(e) || "Google API error"
                });
            }
        }

        res.json({ customers });

    } catch (error) {
        res.status(500).json({ error: error.message || "Failed to fetch customers" });
    }
};

// ── GET /auth/customers-all ───────────────────────────────────────────────────
// Super admin exclusive: returns ALL customers for a userId directly from
// oauthUser.customerIds (stored during OAuth), with names fetched from Google.
// Bypasses customerAccess entirely — used by adminview page.

export const getAllCustomersForSuperAdmin = async (req, res) => {
    try {
        const { userId } = req.query;

        const admin = await admin_model.findById(req.sessionAdmin.id);

        // Guard: only super_admin can call this endpoint
        if (admin.role !== "super_admin") {
            return res.status(403).json({ error: "Access denied. Super admin only." });
        }

        const oauthUser = await oauth_user_model.findOne({ userId });
        if (!oauthUser) {
            return res.status(404).json({ error: "OAuth user not found." });
        }

        const accessToken = await refreshAccessToken(oauthUser);

        // Use freshly fetched Google IDs, fallback to stored customerIds
        let customerIds = await fetchCustomerIds(accessToken);
        if (!customerIds.length) {
            customerIds = oauthUser.customerIds || [];
        }

        if (!customerIds.length) {
            return res.json({ customers: [] });
        }

        const customers = [];
        for (const cid of customerIds) {
            try {
                const list = await fetchCustomerNames(accessToken, cid);
                const found = list.find(c => c.id === cid);
                customers.push({
                    id: cid,
                    name: found?.name || `Customer ${cid}`,
                    status: "success"
                });
            } catch (e) {
                customers.push({
                    id: cid,
                    name: `Customer ${cid}`,
                    status: "error",
                    error: e?.error?.message || e?.message || "Google API error"
                });
            }
        }

        res.json({ customers });

    } catch (err) {
        console.error("getAllCustomersForSuperAdmin error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch customers" });
    }
};

export const getCustomersForUserManagement = async (req, res) => {
    try {
        const { userId } = req.query;

        const oauthUser = await oauth_user_model.findOne({ userId });
        if (!oauthUser) {
            return res.status(404).json({ error: "OAuth user not found." });
        }

        const accessToken = await refreshAccessToken(oauthUser);
        const customerIds = await fetchCustomerIds(accessToken);

        if (!customerIds.length) {
            return res.json({ customers: [] });
        }

        const customers = [];

        for (const cid of customerIds) {
            try {
                const list = await fetchCustomerNames(accessToken, cid);

                const found = list.find(c => c.id === cid);

                customers.push({
                    id: cid,
                    name: found?.name || `Customer ${cid}`,
                    status: "success"
                });

            } catch (e) {
                customers.push({
                    id: cid,
                    name: `Customer ${cid}`,
                    status: "error",
                    error:
                        e?.error?.message ||
                        e?.message ||
                        JSON.stringify(e) ||
                        "Google API error"
                });
            }
        }

        res.json({ customers });

    } catch (err) {
        console.error("Customer fetch error:", err);
        res.status(500).json({
            error: err.message || "Failed to fetch customers"
        });
    }
};

// ── DELETE /auth/accounts/:id ─────────────────────────────────────────────────

export const deleteAccount = async (req, res) => {
    try {
        const deleted = await oauth_user_model.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Account not found." });
        res.json({ message: "Account removed successfully.", userId: deleted.userId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── POST /auth/refresh/:id ────────────────────────────────────────────────────

export const refreshAccountToken = async (req, res) => {
    try {
        const oauthUser = await oauth_user_model.findById(req.params.id);
        if (!oauthUser) return res.status(404).json({ error: "Account not found." });
        if (!oauthUser.refresh_token) return res.status(400).json({ error: "No refresh token stored." });

        const newAccessToken = await refreshAccessToken(oauthUser);
        const customerIds = await fetchCustomerIds(newAccessToken);
        const updateFields = {};
        if (customerIds.length) updateFields.customerIds = customerIds;

        const profile = await fetchGoogleProfile(newAccessToken);
        if (!oauthUser.googleEmail || !oauthUser.googleName) {
            if (profile.email) updateFields.googleEmail = profile.email;
            if (profile.name) updateFields.googleName = profile.name;
        }

        if (Object.keys(updateFields).length) {
            await oauth_user_model.updateOne({ _id: oauthUser._id }, updateFields);
        }

        res.json({ message: "Token refreshed successfully.", userId: oauthUser.userId });
    } catch (error) {
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/ads-listing ─────────────────────────────────────────────────────

export const getAds = async (req, res) => {
    try {
        const { userId, customerId, dateRange, startDate, endDate } = req.query;
        if (!customerId) return res.status(400).json({ error: "customerId is required" });

        const oauthUser = await oauth_user_model.findOne({ userId });
        if (!oauthUser) return res.status(404).json({ error: "OAuth user not found." });

        const accessToken = await refreshAccessToken(oauthUser);
        const dateCondition = buildDateCondition(dateRange, startDate, endDate);

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
                        metrics.ctr,
                        metrics.conversions_value
                    FROM campaign
                    WHERE ${dateCondition}
                    ORDER BY metrics.cost_micros DESC
                `
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.data.results || response.data.results.length === 0) {
            return res.json({ results: [], status: "empty" });
        }

        res.json(response.data);
    } catch (error) {
        console.error("Google Ads API ERROR:", error.response?.data || error.message);
        const googleError = error.response?.data?.error?.message || error.message || "Google Ads API error";
        const details = error.response?.data?.error?.details || [];
        const formattedErrors = details.flatMap((detail, i) =>
            detail.errors?.map((err, j) => ({ detailIndex: i, errorIndex: j, error: err })) || []
        );
        res.status(500).json({ message: googleError, errors: formattedErrors });
    }
};

// ── GET /auth/accounts/:id/access ────────────────────────────────────────────

export const getAccountAccess = async (req, res) => {
    try {
        const account = await oauth_user_model.findById(req.params.id).select("accessRoles googleEmail userId");
        if (!account) return res.status(404).json({ error: "Account not found." });

        const roles = account.accessRoles || [];
        const adminIds = roles.map(r => r.adminId).filter(Boolean);
        const admins = adminIds.length
            ? await admin_model.find({ _id: { $in: adminIds } }).select("_id email fullname")
            : [];
        const adminMap = {};
        admins.forEach(a => { adminMap[a._id.toString()] = a; });

        const enriched = roles.map(r => ({
            adminId: r.adminId,
            role: r.role,
            grantedAt: r.grantedAt,
            adminEmail: adminMap[r.adminId?.toString()]?.email || null,
            adminFullname: adminMap[r.adminId?.toString()]?.fullname || null,
        }));

        res.json({ accountId: account._id, accessRoles: enriched });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getAdminList = async (req, res) => {
    try {
        const admins = await admin_model.find({}).select("_id email fullname role");

        const final_user = await Promise.all(
            admins.map(async ({ _id, email, fullname, role: roleSlug }) => {
                const curr_role = await role.findOne({ role_slug: roleSlug });
                return { _id, email, fullname, role: curr_role?.role_name || null };
            })
        );

        res.json({ admins: final_user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── POST /auth/accounts/:id/access ───────────────────────────────────────────

export const grantAccountAccess = async (req, res) => {
    try {
        const { id } = req.params;
        const { adminId, role } = req.body;

        if (!adminId || !role) return res.status(400).json({ error: "adminId and role are required." });

        const validRoles = ["viewer", "editor", "owner"];
        if (!validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });

        const admin = await admin_model.findById(adminId);
        if (!admin) return res.status(404).json({ error: "Admin user not found." });

        const account = await oauth_user_model.findById(id);
        if (!account) return res.status(404).json({ error: "Account not found." });

        const existingIdx = account.accessRoles.findIndex(r => r.adminId?.toString() === adminId.toString());
        if (existingIdx >= 0) {
            account.accessRoles[existingIdx].role = role;
            account.accessRoles[existingIdx].grantedAt = new Date();
        } else {
            account.accessRoles.push({ adminId, role, grantedAt: new Date() });
        }

        await account.save();
        res.json({ message: `Access granted: ${admin.email} → ${role}`, accessRoles: account.accessRoles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── DELETE /auth/accounts/:id/access/:adminId ────────────────────────────────

export const revokeAccountAccess = async (req, res) => {
    try {
        const { id, adminId } = req.params;

        const account = await oauth_user_model.findById(id);
        if (!account) return res.status(404).json({ error: "Account not found." });

        const before = account.accessRoles.length;
        account.accessRoles = account.accessRoles.filter(r => r.adminId?.toString() !== adminId.toString());

        if (account.accessRoles.length === before) {
            return res.status(404).json({ error: "Access entry not found." });
        }

        await account.save();
        res.json({ message: "Access revoked successfully." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const createUsers = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const saltRounds = 10;

        bcrypt.hash(password, saltRounds, async function (err, hash) {
            const existingUser = await admin_model.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ message: "User already exists" });
            }

            const usr_data = new admin_model({ fullname: name, email, password: hash, role });
            const save_usr_acc = await usr_data.save();

            if (save_usr_acc) {
                return res.status(201).json({ success: "New user created successfully." });
            } else {
                return res.status(400).json({ message: 'Something went wrong!' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const updateUsr = async (req, res) => {
    try {
        const user_ID = req.params.usr_ID;
        const { name, email, password, role, canAccessAdminView } = req.body;
        const saltRounds = 10;

        if (password === undefined || password === null) {
            const edit_usr = await admin_model.updateOne(
                { _id: user_ID },
                { $set: { fullname: name, email, role, canAccessAdminView: !!canAccessAdminView } }
            );
            if (edit_usr.acknowledged) {
                res.status(200).json({ message: "Updated user successfully" });
            } else {
                res.status(400).json({ message: 'Something went wrong!' });
            }
        } else {
            bcrypt.hash(password, saltRounds, async function (err, hash) {
                const edit_usr = await admin_model.updateOne(
                    { _id: user_ID },
                    { $set: { email, fullname: name, password: hash, role, canAccessAdminView: !!canAccessAdminView } }
                );
                if (edit_usr.acknowledged) {
                    res.status(200).json({ message: "Updated user successfully" });
                } else {
                    res.status(400).json({ message: 'Something went wrong!' });
                }
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getSingleUser = async (req, res) => {
    try {
        const usr_ID = req.params.usr_ID;
        const sing_usr = await admin_model.findOne({ _id: usr_ID })
            .select("fullname email role accessUserIds customerAccess canAccessAdminView");

        if (sing_usr) {
            res.status(200).json({ data: sing_usr, message: "Single user fetched successfully" });
        } else {
            res.status(400).json({ message: 'Something went wrong!' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deletUser = async (req, res) => {
    try {
        const usr_ID = req.params.usr_ID;
        const delete_usr = await admin_model.deleteOne({ _id: usr_ID });

        if (delete_usr.acknowledged) {
            res.status(201).json({ message: "User deleted successfully" });
        } else {
            res.status(400).json({ message: 'Something went wrong!' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getCampaignDetails = async (req, res) => {
    try {
        const { campaignId, customerId, userId } = req.query;

        const oauthUser = await oauth_user_model.findOne({ userId });
        const accessToken = await refreshAccessToken(oauthUser);

        const response = await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
            {
                query: `
                    SELECT
                        campaign.id,
                        campaign.name,
                        campaign.status,
                        campaign_budget.amount_micros
                    FROM campaign
                    WHERE campaign.id = ${campaignId}
                `
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                },
            }
        );

        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateCampaign = async (req, res) => {
    try {
        const { campaignId, status, userId, customerId } = req.body;

        const oauthUser = await oauth_user_model.findOne({ userId });
        const accessToken = await refreshAccessToken(oauthUser);

        await axios.post(
            `https://googleads.googleapis.com/v23/customers/${customerId}/campaigns:mutate`,
            {
                operations: [
                    {
                        update: {
                            resourceName: `customers/${customerId}/campaigns/${campaignId}`,
                            status: status
                        },
                        updateMask: "status"
                    }
                ]
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
                },
            }
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateAccessAccounts = async (req, res) => {
    try {
        const { accounts } = req.body;
        await admin_model.findByIdAndUpdate(req.sessionAdmin.id, { access_account: accounts });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getOauthUserIds = async (req, res) => {
    try {
        const admin = await admin_model.findById(req.params.userId);
        const oauthUsers = await oauth_user_model.find({ userId: { $in: admin.oauthUserIds } });
        res.json({
            allUserIds: oauthUsers.map(u => u.userId),
            selectedUserIds: admin.accessUserIds || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const addAccessUser = async (req, res) => {
    try {
        const { userId, adminId } = req.body;
        await admin_model.updateOne({ _id: adminId }, { $addToSet: { accessUserIds: userId } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const removeAccessUser = async (req, res) => {
    try {
        const { userId, adminId } = req.body;
        await admin_model.updateOne({ _id: adminId }, { $pull: { accessUserIds: userId } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getUseridName = async (req, res) => {
    try {
        const { userId } = req.query;
        const oauth_user = await oauth_user_model.findOne({ userId }).select('googleName');
        res.json({ data: oauth_user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getAccessMatrix = async (req, res) => {
    try {
        const admins = await admin_model.find({}).select("_id email fullname accessUserIds role");
        const oauthUsers = await oauth_user_model.find({}).select("userId googleEmail googleName customerIds");
        res.json({ admins, oauthUsers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const toggleAccess = async (req, res) => {
    try {
        const { adminId, userId, enable } = req.body;

        if (enable) {
            await admin_model.updateOne({ _id: adminId }, { $addToSet: { accessUserIds: userId } });
        } else {
            await admin_model.updateOne({ _id: adminId }, { $pull: { accessUserIds: userId } });
            await admin_model.updateOne({ _id: adminId }, { $pull: { customerAccess: { userId } } });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const bulkAssignAccess = async (req, res) => {
    try {
        const { adminId, userIds } = req.body;

        const admin = await admin_model.findById(req.sessionAdmin.id);
        if (admin.role !== "super_admin") {
            return res.status(403).json({ error: "Only super admin allowed" });
        }

        await admin_model.updateOne(
            { _id: adminId },
            { $addToSet: { accessUserIds: { $each: userIds } } }
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const toggleCustomerAccess = async (req, res) => {
    try {
        const { adminId, userId, customerId, checked } = req.body;

        if (!adminId || !userId || !customerId) {
            return res.status(400).json({ message: "Missing fields" });
        }

        const admin = await admin_model.findById(adminId);
        if (!admin) return res.status(404).json({ message: "Admin not found" });

        let entry = admin.customerAccess.find(e => e.userId === userId);

        if (checked) {
            if (!entry) {
                admin.customerAccess.push({ userId, customerIds: [customerId] });
            } else {
                if (!entry.customerIds.includes(customerId)) {
                    entry.customerIds.push(customerId);
                }
            }
            if (!admin.accessUserIds.includes(userId)) {
                admin.accessUserIds.push(userId);
            }
        } else {
            if (entry) {
                entry.customerIds = entry.customerIds.filter(id => id !== customerId);
                if (entry.customerIds.length === 0) {
                    admin.customerAccess = admin.customerAccess.filter(e => e.userId !== userId);
                    admin.accessUserIds = admin.accessUserIds.filter(id => id !== userId);
                }
            }
        }

        admin.accessUserIds = admin.accessUserIds.filter(id => id.startsWith("user_"));
        await admin.save();

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── POST /auth/toggle-adminview-access ───────────────────────────────────────
// Body: { adminId, checked }
// Instantly saves canAccessAdminView for a given admin user.
export const toggleAdminViewAccess = async (req, res) => {
    try {
        const { adminId, checked } = req.body;
        if (!adminId) return res.status(400).json({ message: 'adminId is required' });

        const result = await admin_model.updateOne(
            { _id: adminId },
            { $set: { canAccessAdminView: !!checked } }
        );

        if (result.acknowledged) {
            res.status(200).json({ success: true, canAccessAdminView: !!checked });
        } else {
            res.status(400).json({ message: 'Update failed' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
