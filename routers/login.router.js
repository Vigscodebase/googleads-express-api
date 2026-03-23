import express from "express";
import { signup, login, logout, me, requireLogin } from "../controllers/login.controller.js";
import bodyParser from "body-parser";

const loginRout = express.Router();

var jsonParser = bodyParser.json();

// POST /logincheck/signup  — create a new admin account
loginRout.post("/signup", jsonParser, signup);

// POST /logincheck/login   — log in, receive session token
loginRout.post("/login", jsonParser,  login);

// POST /logincheck/logout  — invalidate session token
loginRout.post("/logout", jsonParser, logout);

// GET  /logincheck/me      — verify token, return username
loginRout.get("/me", requireLogin, me);

export default loginRout;
