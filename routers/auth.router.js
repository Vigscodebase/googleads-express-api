import express from "express";
import { exchangeShortToken, getAds, getCustomerIds, getStaticUser } from "../controllers/auth.controller.js";
import { requireLogin } from "../controllers/login.controller.js";

const tokenrout = express.Router();

// Google OAuth callback — no login required (this IS the oauth flow)
tokenrout.get("/oauth/callback", exchangeShortToken);

// Protected routes — valid dashboard session required
tokenrout.get("/static-user", requireLogin, getStaticUser);
tokenrout.get("/customers",   requireLogin, getCustomerIds);
tokenrout.get("/ads-listing", requireLogin, getAds);

export default tokenrout;
