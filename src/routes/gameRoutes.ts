import { Router } from "express";
import { getLeaderBoardData } from "../controllers/gameController.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const router = Router();


router.get('/leaderboard', verifyFirebaseToken, getLeaderBoardData);

export default router;