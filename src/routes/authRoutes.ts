import { Router } from "express";
import { getProfile, addPlayer, updateProfile, buyToken, getMyTokens, rewardToken, usernameExists, playerExists, verifyIAPReceipt, deleteAccount, getRegisteredUsers } from "../controllers/authController.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const router = Router();

router.get("/profile", verifyFirebaseToken, getProfile);
router.post("/profile/", verifyFirebaseToken, updateProfile);

router.post("/add-player", verifyFirebaseToken, addPlayer);
router.post("/reward-token", verifyFirebaseToken, rewardToken);
router.get('/username-exists', usernameExists);
router.get('/player-exists', verifyFirebaseToken, playerExists);

router.get("/my-tokens", verifyFirebaseToken, getMyTokens);
router.post("/buy-token", verifyFirebaseToken, buyToken);
router.post("/verify-iap-receipt", verifyFirebaseToken, verifyIAPReceipt);

router.delete("/delete-account", verifyFirebaseToken, deleteAccount);

// Registered users list (for cross-domain calls; protect with API_KEY / X-API-Key, add origin to CORS)
router.get("/registered-users", getRegisteredUsers);

export default router;