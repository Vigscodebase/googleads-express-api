import express from "express";
import { fetchrole } from "../controllers/role.js"

const role_rout = express.Router();

role_rout.get("/all-roles", fetchrole)

export default role_rout;