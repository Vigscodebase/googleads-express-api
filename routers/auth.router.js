import express from "express";
import {
    exchangeShortToken,
    getAds,
    getCustomerIds,
    getStaticUser,
    getAccounts,
    deleteAccount,
    refreshAccountToken,
    getAccountAccess,
    getAdminList,
    grantAccountAccess,
    revokeAccountAccess,
    createUsers,
} from "../controllers/auth.controller.js";
import { requireLogin } from "../controllers/login.controller.js";
import bodyParser from "body-parser";
var jsonParser = bodyParser.json();

const tokenrout = express.Router();

// OAuth callback — no login required
tokenrout.get("/oauth/callback", exchangeShortToken);

// Campaign data
tokenrout.get("/static-user", requireLogin, getStaticUser);
tokenrout.get("/customers", requireLogin, getCustomerIds);
tokenrout.get("/ads-listing", requireLogin, getAds);          // now accepts dateRange, startDate, endDate

// Account management
tokenrout.get("/accounts", requireLogin, getAccounts);
tokenrout.delete("/accounts/:id", requireLogin, deleteAccount);
tokenrout.post("/refresh/:id", requireLogin, jsonParser, refreshAccountToken);

// User access roles
tokenrout.get("/admin-list", requireLogin, getAdminList);
tokenrout.get("/accounts/:id/access", requireLogin, getAccountAccess);
tokenrout.post("/accounts/:id/access", requireLogin, jsonParser, grantAccountAccess);
tokenrout.delete("/accounts/:id/access/:adminId", requireLogin, revokeAccountAccess);

//User Add
tokenrout.post("/create-user", requireLogin, jsonParser, createUsers);

export default tokenrout;
