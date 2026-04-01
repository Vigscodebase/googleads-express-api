import express from "express"
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import http from "http"
import tokenrout from "./routers/auth.router.js"
import adrout from "./routers/ad.router.js"
import loginRout from "./routers/login.router.js"
import mongoose from "mongoose";
import role_rout from "./routers/role.js"

dotenv.config({ debug: true });

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

export const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
    res.send(`Express google ads Server running successfully`);
});

server.listen(PORT, () => {
    console.log(`HTTP + WebSocket Server running on port ${PORT}`);
});

mongoose.connect("mongodb://127.0.0.1:27017/gads").then(() => {
    console.log("Google Ads database connected");
})

app.use("/auth", tokenrout);
app.use("/ads", adrout);
app.use("/logincheck", loginRout);
app.use("/role", role_rout);