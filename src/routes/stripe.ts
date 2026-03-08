import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ✅ SUCCESS PAGE (user redirected here after successful payment)
router.get("/stripe_success", (req: Request, res: Response) => {
    const sessionId = req.query.session_id;

    // Optional: Log or verify the session later
    console.log("✅ Payment success with session:", sessionId);

    // Option 1: If Unity WebGL or web frontend
    res.sendFile(path.resolve(__dirname, "../../html/stripe_success.html"));

    // Option 2 (for native Unity deep link):
    // res.redirect(`mygame://payment-success?session_id=${sessionId}`);
});

// ❌ CANCEL PAGE (user canceled payment)
router.get("/stripe_cancel", (req: Request, res: Response) => {
    console.log("❌ Payment canceled");
    res.sendFile(path.resolve(__dirname, "../../html/stripe_cancel.html"));

    // Or redirect to main game/home:
});

export default router;
