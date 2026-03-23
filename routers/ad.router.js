import express from "express";
import { getAds } from "../controllers/ad.controller.js"

const adrout = express.Router();

adrout.get("/ads-listing", getAds);

export default adrout;