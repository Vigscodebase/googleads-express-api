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

// async function fetchGoogleProfile(accessToken) {
//     try {
//         const profileRes = await axios.get(
//             "https://www.googleapis.com/oauth2/v2/userinfo",
//             { headers: { Authorization: `Bearer ${accessToken}` } }
//         );
//         return { email: profileRes.data.email || null, name: profileRes.data.name || null };
//     } catch {
//         return { email: null, name: null };
//     }
// }

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
// Accepts: dateRange = "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS" | "TODAY" | "custom"
//          startDate / endDate = "YYYY-MM-DD" (only when dateRange=custom)

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

        // Step 1: find oauth user
        const oauthUser = await oauth_user_model.findOne({
            googleEmail: adminEmail
        });

        if (!oauthUser) {
            console.log("❌ No oauth user found");
            return;
        }

        // Step 2: attach to admin (append safely)
        await admin_model.updateOne(
            { email: adminEmail },
            {
                $addToSet: {
                    oauthUserIds: oauthUser.userId
                }
            }
        );

        console.log("✅ OAuth user linked successfully");

    } catch (err) {
        console.error(err);
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
        const userId = "user_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");

        const [profile, customerIds] = await Promise.all([
            fetchGoogleProfile(access_token),
            fetchCustomerIds(access_token),
        ]);

        handleGoogleOAuthSuccess(profile)

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
        res.status(500).json({ error: error.response?.data || error.message });
    }
};

// ── GET /auth/accounts ────────────────────────────────────────────────────────

export const getAccounts = async (req, res) => {
    try {
        const { adminEmail } = req.query
        const userIds = []

        const oauth_user = await admin_model.findOne({ email: adminEmail })
            .select('accessUserIds');

        if (oauth_user && oauth_user.accessUserIds) {
            userIds.push(...oauth_user.accessUserIds);
        }

        const accounts = await oauth_user_model
            .find({ userId: { $in: userIds } })
            .sort({ created: -1 })
            .select("userId googleEmail googleName customerIds tokenRefreshedAt created updated accessRoles");

        // Enrich with admin email labels for the access roles
        const adminIds = [...new Set(
            accounts.flatMap(a => (a.accessRoles || []).map(r => r.adminId?.toString()))
                .filter(Boolean)
        )];

        let adminMap = {};
        if (adminIds.length) {
            const admins = await admin_model.find({ _id: { $in: adminIds } }).select("_id email fullname");
            admins.forEach(adm => { adminMap[adm._id.toString()] = adm; });
        }

        const enriched = accounts.map(acc => {
            const a = acc.toObject();
            a.accessRoles = (a.accessRoles || []).map(r => ({
                ...r,
                adminEmail: adminMap[r.adminId?.toString()]?.email || null,
                adminFullname: adminMap[r.adminId?.toString()]?.fullname || null,
            }));
            return a;
        });

        res.json({ accounts: enriched });
    } catch (error) {
        console.error("getAccounts error:", error.message);
        res.status(500).json({ error: error.message });
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
        console.log(profile)
        if (!oauthUser.googleEmail || !oauthUser.googleName) {
            const profile = await fetchGoogleProfile(newAccessToken);
            console.log(profile)
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

// ── GET /auth/ads-listing — NOW WITH DATE RANGE ───────────────────────────────
// Query params:
//   userId, customerId   — required
//   dateRange            — "LAST_30_DAYS" (default) | "TODAY" | "LAST_7_DAYS" |
//                          "LAST_14_DAYS" | "LAST_90_DAYS" | "THIS_MONTH" |
//                          "LAST_MONTH" | "custom"
//   startDate, endDate   — "YYYY-MM-DD", required when dateRange="custom"

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

        res.json(response.data);
    } catch (error) {
        const error_data = error.response.data.error.details;

        const formattedErrors = error_data.flatMap((detail, i) =>
            detail.errors?.map((err, j) => ({
                detailIndex: i,
                errorIndex: j,
                error: err
            })) || []
        );

        res.status(500).json({
            message: "Google Ads API Error",
            errors: formattedErrors
        });
    }
};

// ══════════════════════════════════════════════════════════════
//  USER ACCESS ROLE MANAGEMENT
//  Each oauth_user document has an accessRoles array:
//  [{ adminId, role, grantedAt }]
//  Roles: "viewer" | "editor" | "owner"
// ══════════════════════════════════════════════════════════════

// ── GET /auth/accounts/:id/access — list who has access ──────────────────────

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

// ── GET /auth/admin-list — all admin users (for the grant-access dropdown) ────

export const getAdminList = async (req, res) => {
    try {
        const admins = await admin_model.find({}).select("_id email fullname role");

        const final_user = await Promise.all(
            admins.map(async ({ _id, email, fullname, role: roleSlug }) => {
                const curr_role = await role.findOne({ role_slug: roleSlug });

                return {
                    id: _id,
                    email,
                    name: fullname,
                    role: curr_role?.role_name || null
                };
            })
        );

        res.json({ final_user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── POST /auth/accounts/:id/access — grant access ────────────────────────────
// Body: { adminId, role }   role = "viewer" | "editor" | "owner"

export const grantAccountAccess = async (req, res) => {
    try {
        const { id } = req.params;
        const { adminId, role } = req.body;

        if (!adminId || !role) return res.status(400).json({ error: "adminId and role are required." });

        const validRoles = ["viewer", "editor", "owner"];
        if (!validRoles.includes(role)) return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });

        // Check admin exists
        const admin = await admin_model.findById(adminId);
        if (!admin) return res.status(404).json({ error: "Admin user not found." });

        // Upsert the role (update if already exists, add if not)
        const account = await oauth_user_model.findById(id);
        if (!account) return res.status(404).json({ error: "Account not found." });

        const existingIdx = account.accessRoles.findIndex(
            r => r.adminId?.toString() === adminId.toString()
        );

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

// ── DELETE /auth/accounts/:id/access/:adminId — revoke access ────────────────

export const revokeAccountAccess = async (req, res) => {
    try {
        const { id, adminId } = req.params;

        const account = await oauth_user_model.findById(id);
        if (!account) return res.status(404).json({ error: "Account not found." });

        const before = account.accessRoles.length;
        account.accessRoles = account.accessRoles.filter(
            r => r.adminId?.toString() !== adminId.toString()
        );

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
            const usr_data = new admin_model({
                fullname: name,
                email: email,
                password: hash,
                role: role,
            })

            const existingUser = await admin_model.findOne({ email: email });

            if (existingUser) {
                return res.status(400).json({
                    message: "User already exists"
                });
            }

            const save_usr_acc = usr_data.save();

            if (save_usr_acc) {
                return res.status(201).json({
                    success: "New user created successfully."
                })

            }
            else {
                return res.status(400).json({
                    message: 'Something went wrong!'
                })
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export const updateUsr = async (req, res) => {
    try {
        const user_ID = req.params.usr_ID;
        const { name, email, password, role } = req.body;
        const saltRounds = 10;

        if (password === undefined || password === null) {

            const edit_usr = await admin_model.updateOne(
                { _id: user_ID },
                {
                    $set: {
                        fullname: name,
                        email: email,
                        role: role,
                    }
                }
            );

            if (edit_usr.acknowledged) {
                res.status(200).json({
                    message: "Updated user successfully"
                })
            } else {
                res.status(400).json({
                    message: 'Something went wrong!'
                })
            }


        } else {

            bcrypt.hash(password, saltRounds, async function (err, hash) {
                const edit_usr = await admin_model.updateOne(
                    { _id: user_ID },
                    {
                        $set: {
                            email: email,
                            fullname: name,
                            password: hash,
                            role: role,
                        }
                    }
                );

                if (edit_usr.acknowledged) {
                    res.status(200).json({
                        message: "Updated user successfully"
                    })
                } else {
                    res.status(400).json({
                        message: 'Something went wrong!'
                    })
                }
            });

        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export const getSingleUser = async (req, res) => {
    try {

        const usr_ID = req.params.usr_ID;
        const sing_usr = await admin_model.findOne({ _id: usr_ID })

        if (sing_usr) {
            res.status(200).json({
                data: sing_usr,
                message: "Single user fetched successfully"
            })
        }
        else {
            res.status(400).json({
                message: 'Something went wrong!'
            })
        }
    } catch (error) {
        res.status(500).json({
            message: error.message
        })
    }
}

export const deletUser = async (req, res) => {
    try {

        const usr_ID = req.params.usr_ID;
        const delete_usr = await admin_model.deleteOne({ _id: usr_ID })

        if (delete_usr.acknowledged) {
            res.status(201).json({
                message: "User deleted successfully"
            })
        }
        else {
            res.status(400).json({
                message: 'Something went wrong!'
            })
        }
    } catch (error) {
        res.status(500).json({
            message: error.message
        })
    }
}

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

        await Admin.findByIdAndUpdate(req.user.id, {
            access_account: accounts
        });

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/oauth/list
export const getOauthUserIds = async (req, res) => {
    try {
        const admin = await admin_model.findById(req.params.userId);

        const oauthUsers = await oauth_user_model.find({
            userId: { $in: admin.oauthUserIds }
        });

        res.json({
            allUserIds: oauthUsers.map(u => u.userId),
            selectedUserIds: admin.accessUserIds || []
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// POST /api/oauth/add
export const addAccessUser = async (req, res) => {
    try {
        const { userId, adminId } = req.body;

        await admin_model.updateOne(
            { _id: adminId },   // ✅ FIXED
            {
                $addToSet: {
                    accessUserIds: userId
                }
            }
        );

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// POST /api/oauth/remove
export const removeAccessUser = async (req, res) => {
    try {
        const { userId, adminId } = req.body;

        await admin_model.updateOne(
            { _id: adminId },   // ✅ FIXED
            {
                $pull: {
                    accessUserIds: userId
                }
            }
        );

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET oauth user name according to userId
export const getUseridName = async (req, res) => {
    try {
        const { userId } = req.query;

        const oauth_user = await oauth_user_model.findOne({ userId: userId })
            .select('googleName');

        res.json({ data: oauth_user });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

