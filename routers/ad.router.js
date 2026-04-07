import express from "express";
import { getAds, getIntegratedReport } from "../controllers/ad.controller.js"

const adrout = express.Router();

adrout.get("/ads-listing", getAds);
adrout.post("/integrated-report", getIntegratedReport);

export default adrout; 