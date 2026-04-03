import express from "express";
import { fetchrole, getSingleRole } from "../controllers/role.js"

const role_rout = express.Router();

role_rout.get("/all-roles", fetchrole)
role_rout.get("/single-role/:role_name", getSingleRole)

export default role_rout;