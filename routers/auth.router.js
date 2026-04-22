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
    updateUsr,
    getSingleUser,
    deletUser,
    getCampaignDetails,
    updateCampaign,
    updateAccessAccounts,
    getOauthUserIds,
    addAccessUser,
    removeAccessUser,
    getUseridName,
    getAccessMatrix,
    toggleAccess,
    getCustomersForUserManagement,
    toggleCustomerAccess
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

//User CRUD
tokenrout.get("/single-user/:usr_ID", requireLogin, getSingleUser)
tokenrout.post("/create-user", requireLogin, jsonParser, createUsers);
tokenrout.patch("/update-single-user/:usr_ID", jsonParser, updateUsr);
tokenrout.delete("/delete-user/:usr_ID", deletUser);

tokenrout.get("/single-campaign/", requireLogin, getCampaignDetails);
tokenrout.post("/update-campaign/:campaignId", requireLogin, jsonParser, updateCampaign);
tokenrout.post("/update-access-accounts", requireLogin, jsonParser, updateAccessAccounts);
tokenrout.get("/oauth/list/:userId", requireLogin, getOauthUserIds);
tokenrout.post("/oauth/add", requireLogin, jsonParser, addAccessUser);
tokenrout.post("/oauth/remove", requireLogin, jsonParser, removeAccessUser);
tokenrout.get("/get-oauth-name/", requireLogin, getUseridName)
tokenrout.get("/access-matrix", requireLogin, getAccessMatrix);
tokenrout.post("/oauth/toggle-access", requireLogin, jsonParser, toggleAccess);
tokenrout.get("/customers-lite", requireLogin, getCustomersForUserManagement);
tokenrout.post("/oauth/toggle-customer-access", requireLogin, jsonParser, toggleCustomerAccess);

export default tokenrout;