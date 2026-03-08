import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import authRoutes from "./routes/authRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import stripeRoutes from "./routes/stripe.js";
import { stripeWebhook } from "./controllers/authController.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add ALLOWED_ORIGINS_EXTRA (comma-separated) in .env to allow other domains (e.g. for /api/auth/registered-users)
const extraOrigins = (process.env.ALLOWED_ORIGINS_EXTRA || "").split(",").map((s) => s.trim()).filter(Boolean);
const allowedOrigins = [
    process.env.DOMAIN_ADDRESS1,
    process.env.DOMAIN_ADDRESS2,
    process.env.LOCAL_ADDRESS,
    "https://17cardgame.com",
    "https://www.17cardgame.com",
    "http://localhost:8080",
    ...extraOrigins
].filter(Boolean) as string[];
const corsOptions = {
    origin: allowedOrigins,
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.post("/webhook", bodyParser.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json({ limit: '10mb' }));
app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes);
app.use("/", stripeRoutes);
app.use(express.static(path.join(__dirname, "../html")));

app.get("/api/health", (req, res) => {
    const resp = {
        status: "success",
        message: "Server is running successfully!",
        timestamp: new Date().toISOString()
    };

    res.status(200).json(resp);
});

export default app;