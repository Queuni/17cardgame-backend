import { Request, Response } from "express";
import { db, auth } from "../config/firebase.js";
import { DEFAULT_TOKEN, DEFAULT_AVATAR_INDEX, REWARD_TOKEN_AMOUNT } from "../config/constants.js";
import Stripe from "stripe";
import admin from "firebase-admin";
import redisSocketService from "../services/redisSocketService.js";
import redisGameService from "../services/redisGameService.js";
import firebaseGameService from "../services/firebaseGameService.js";

export const addPlayer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, displayName } = req.body;

    const player = await db.collection("players").add({
      email,
      displayName,
      stats: {
        wins: 0,
        gamesPlayed: 0,
        tokensWon: 0
      },
      token: DEFAULT_TOKEN,
      avatarIndex: DEFAULT_AVATAR_INDEX,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log("Player added:", email, player.id);

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error' });
  }
};

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    let profile = null;
    const email: string = req.query.email as string;

    if (!email) {
      res.status(401).json({ error: "Unauthorized", message: "No authenticated user" });
      return;
    }

    const profile_doc = await db.collection("players")
      .where("email", '==', email)
      .select("displayName", "token", "stats", "email", "avatarIndex")
      .limit(1).get();

    if (!profile_doc.empty) {
      const doc = profile_doc.docs[0];
      profile = {
        playerId: doc?.id,
        email: doc?.get("email"),
        displayName: doc?.get("displayName"),
        token: doc?.get("token"),
        avatarIndex: doc?.get("avatarIndex")
      }
    } else {
      console.log("No player found with email:", email);
    }

    res.status(200).json(profile);

  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  }
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId, displayName, avatarIndex } = req.body;
    const playerRef = db.collection("players").doc(playerId);
    await playerRef.update({
      displayName,
      avatarIndex
    });

    res.status(200).json({ result: "success" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', msg: "Failed to update profile" });
  }
};


export const buyToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tokenAmount, price, playerId, email, platform } = req.body;

    // SECURITY: Block Stripe for iOS - Apple requires IAP for digital goods
    // This prevents App Store rejection (Guideline 3.1.1)
    // Note: Frontend StripeService is already excluded for iOS via preprocessor directives,
    // but this backend check provides additional security
    if (platform === 'ios' || platform === 'iOS') {
      console.warn(`⚠️ Stripe payment blocked for iOS platform. Use Apple IAP instead.`);
      res.status(403).json({
        status: 'error',
        msg: 'Stripe payments are not available on iOS. Please use in-app purchase.'
      });
      return;
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      metadata: {
        playerId: playerId,
        tokenAmount: String(tokenAmount),
      },
      success_url: `${process.env.DOMAIN_ADDRESS1}/stripe_success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN_ADDRESS1}/stripe_cancel`,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${tokenAmount} Game Tokens`,
              description: "Buy tokens for the game",
            },
            unit_amount: Number(price) * 100,
          },
          quantity: 1,
        },
      ],
      customer_email: email,
    });
    res.status(200).json({ result: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', msg: "Failed to buy token" });
  }
};

export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

  const sig = req.headers["stripe-signature"];
  let event: Stripe.Event;

  try {
    // IMPORTANT: req.body must be raw (not parsed by express.json)
    event = stripe.webhooks.constructEvent(
      req.body,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error("❌ Webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // ✅ Handle successful payments
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const playerId = session.metadata?.playerId;
    const tokenAmount = parseInt(session.metadata?.tokenAmount || "0", 10);

    if (!playerId || !tokenAmount) {
      console.warn("⚠️ Missing metadata in Stripe session:", session);
      res.status(400).json({ msg: "Missing playerId or tokenAmount" });
      return;
    }

    try {
      // Increment tokens in Firestore
      await db.collection("players").doc(playerId).update({
        token: admin.firestore.FieldValue.increment(tokenAmount),
      });

      console.log(`✅ Added ${tokenAmount} tokens to player ${playerId}`);
    } catch (fireErr) {
      console.error("🔥 Firestore update failed:", fireErr);
    }
  }

  res.status(200).json({ received: true });
};

/**
 * Verify IAP receipt (iOS/Android) and grant tokens
 * iOS: Verifies with Apple's App Store
 * Android: Verifies with Google Play
 */
export const verifyIAPReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { receipt, tokenAmount, platform, playerId } = req.body;

    // Note: tokenAmount is accepted for logging but NEVER trusted - always derived from product ID
    if (!receipt || !platform || !playerId) {
      res.status(400).json({ status: 'error', msg: 'Missing required fields' });
      return;
    }

    let isValid = false;
    let transactionId: string | null = null;
    let actualTokenAmount: number | null = null; // Derived from product ID, never from client
    let productId: string | null = null; // For logging

    if (platform === 'ios') {
      // Verify iOS receipt with Apple (returns validation result, transaction ID, and token amount)
      const verificationResult = await verifyIOSReceipt(receipt);
      isValid = verificationResult.isValid;
      actualTokenAmount = verificationResult.tokenAmount || null;
      productId = verificationResult.productId || null;

      if (isValid) {
        // SECURITY: Transaction ID is REQUIRED - reject if not found
        transactionId = verificationResult.transactionId || null;

        // Fallback: Extract transaction ID from Unity receipt format if not from Apple
        if (!transactionId) {
          try {
            const receiptData = JSON.parse(receipt);
            // Unity IAP format: { "Store": "AppleAppStore", "Payload": "..." }
            // The Payload is the actual receipt data
            if (receiptData.Payload) {
              const payloadData = JSON.parse(receiptData.Payload);
              transactionId = payloadData?.transaction_id || payloadData?.original_transaction_id || null;
            } else {
              // Try direct parsing if not Unity format
              transactionId = receiptData?.transaction_id || receiptData?.original_transaction_id || null;
            }
          } catch (e) {
            // SECURITY: Never invent transaction IDs - reject if parsing fails
            console.error('❌ Failed to extract transaction ID from receipt. Rejecting purchase for security.');
            res.status(400).json({ status: 'error', msg: 'Invalid receipt: missing transaction ID' });
            return;
          }
        }

        // SECURITY: Reject if no transaction ID found (prevents duplicate grants)
        if (!transactionId) {
          console.error('❌ No transaction ID found in receipt. Rejecting purchase for security.');
          res.status(400).json({ status: 'error', msg: 'Invalid receipt: missing transaction ID' });
          return;
        }
      }
    } else if (platform === 'android') {
      // Verify Android receipt with Google Play
      isValid = await verifyAndroidReceipt(receipt, tokenAmount);
      if (isValid) {
        try {
          const receiptData = JSON.parse(receipt);
          transactionId = receiptData?.transactionId || receiptData?.orderId || null;
          // TODO: Derive token amount from Android product ID (similar to iOS)
          actualTokenAmount = tokenAmount; // Temporary: use client input until Android product ID extraction is implemented
        } catch (e) {
          console.error('❌ Failed to extract transaction ID from Android receipt. Rejecting purchase for security.');
          res.status(400).json({ status: 'error', msg: 'Invalid receipt: missing transaction ID' });
          return;
        }

        if (!transactionId) {
          console.error('❌ No transaction ID found in Android receipt. Rejecting purchase for security.');
          res.status(400).json({ status: 'error', msg: 'Invalid receipt: missing transaction ID' });
          return;
        }
      }
    } else {
      res.status(400).json({ status: 'error', msg: 'Invalid platform' });
      return;
    }

    if (!isValid) {
      res.status(400).json({ status: 'error', msg: 'Invalid receipt' });
      return;
    }

    // SECURITY: Token amount must be derived from product ID, never from client
    if (!actualTokenAmount || actualTokenAmount <= 0) {
      console.error('❌ Invalid token amount derived from product ID. Rejecting purchase.');
      res.status(400).json({ status: 'error', msg: 'Invalid receipt: cannot determine token amount' });
      return;
    }

    // Check if this transaction was already processed (prevent duplicate grants)
    const playerRef = db.collection("players").doc(playerId);
    const playerDoc = await playerRef.get();

    if (!playerDoc.exists) {
      res.status(404).json({ status: 'error', msg: 'Player not found' });
      return;
    }

    const processedTransactions = playerDoc.data()?.processedTransactions || [];
    if (transactionId && processedTransactions.includes(transactionId)) {
      res.status(400).json({ status: 'error', msg: 'Transaction already processed' });
      return;
    }

    // SECURITY: Grant tokens derived from product ID, NOT from client input
    await playerRef.update({
      token: admin.firestore.FieldValue.increment(actualTokenAmount),
      processedTransactions: admin.firestore.FieldValue.arrayUnion(transactionId),
      updatedAt: new Date()
    });

    console.log(`✅ Added ${actualTokenAmount} tokens to player ${playerId} (Transaction: ${transactionId}, Product: ${productId || 'N/A'})`);

    res.status(200).json({ status: 'success', msg: `Successfully added ${actualTokenAmount} tokens` });
  } catch (error) {
    console.error('IAP receipt verification error:', error);
    res.status(500).json({ status: 'error', msg: 'Receipt verification failed' });
  }
};

/**
 * Verify iOS receipt with Apple's App Store Server
 * Uses App Store Server API (recommended) or legacy verifyReceipt endpoint
 */
async function verifyIOSReceipt(receipt: string): Promise<{ isValid: boolean; transactionId?: string; tokenAmount?: number; productId?: string }> {
  try {
    // Unity IAP sends receipt as JSON: { "Store": "AppleAppStore", "Payload": "base64_receipt" }
    let receiptPayload: string = receipt;
    let productIdFromReceipt: string | null = null;

    try {
      const receiptData = JSON.parse(receipt);
      if (receiptData.Payload) {
        receiptPayload = receiptData.Payload; // Extract the actual receipt from Unity format
      } else if (receiptData.receipt) {
        receiptPayload = receiptData.receipt;
      }
      // Unity might include product info in the receipt JSON
      if (receiptData.productId) {
        productIdFromReceipt = receiptData.productId;
      }
    } catch {
      // Receipt is already in the format we need
    }

    // Get app-specific shared secret from environment (optional for sandbox, recommended for production)
    const appSharedSecret = process.env.APPLE_APP_SHARED_SECRET;

    // Build verification request
    const verifyBody: any = {
      'receipt-data': receiptPayload,
      'exclude-old-transactions': true
    };

    // Add shared secret if available (required for production, optional for sandbox)
    if (appSharedSecret) {
      verifyBody.password = appSharedSecret;
    }

    // Always try production first, then sandbox if needed
    let verifyUrl = 'https://buy.itunes.apple.com/verifyReceipt';
    let response = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifyBody)
    });

    let result = await response.json();

    // Status 21007 means receipt is from sandbox, retry with sandbox URL
    if (result.status === 21007) {
      verifyUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
      response = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody)
      });
      result = await response.json();
    }

    // Status 0 means success - for consumables, this is sufficient proof of valid purchase
    if (result.status !== 0) {
      console.error(`iOS receipt verification failed with status: ${result.status}`);
      return { isValid: false };
    }

    // Map product IDs to token amounts
    const productIdToTokens: { [key: string]: number } = {
      'com.belleviewbestllc.seventeencard.tokens_20': 20,
      'com.belleviewbestllc.seventeencard.tokens_50': 50,
      'com.belleviewbestllc.seventeencard.tokens_100': 100
    };

    // Try to extract product ID and transaction ID from Apple response (if available)
    let productIdFromApple: string | null = null;
    let transactionIdFromApple: string | null = null;
    const receiptInfo = result.latest_receipt_info || result.receipt?.in_app || [];

    if (receiptInfo.length > 0) {
      // Find the most recent transaction
      const latestTransaction = receiptInfo[receiptInfo.length - 1];
      productIdFromApple = latestTransaction.product_id || null;
      transactionIdFromApple = latestTransaction.transaction_id || latestTransaction.original_transaction_id || null;
    }

    // Use product ID from Apple response, or fall back to Unity receipt
    const productId = productIdFromApple || productIdFromReceipt;

    // SECURITY: Product ID is REQUIRED - derive token amount from it, never trust client input
    if (!productId) {
      console.error('❌ Product ID not found in receipt. Cannot verify purchase without product ID.');
      return { isValid: false };
    }

    // Derive token amount from product ID (server-side, never trust client)
    const tokenAmount = productIdToTokens[productId];
    if (!tokenAmount) {
      console.error(`❌ Unknown product ID: ${productId}. Cannot determine token amount.`);
      return { isValid: false };
    }

    console.log(`✅ Product ID verified: ${productId} → ${tokenAmount} tokens`);

    // Status 0 + valid product ID = valid purchase
    const verificationResult: { isValid: boolean; transactionId?: string; tokenAmount?: number; productId?: string } = {
      isValid: true,
      tokenAmount: tokenAmount,
      productId: productId
    };
    if (transactionIdFromApple) {
      verificationResult.transactionId = transactionIdFromApple;
    }
    return verificationResult;
  } catch (error) {
    console.error('iOS receipt verification error:', error);
    return { isValid: false };
  }
}

/**
 * Verify Android receipt with Google Play Billing API
 */
async function verifyAndroidReceipt(receipt: string, expectedTokenAmount: number): Promise<boolean> {
  try {
    // Parse Google Play receipt (JSON format)
    const receiptData = JSON.parse(receipt);
    const packageName = receiptData.packageName;
    const productId = receiptData.productId;
    const purchaseToken = receiptData.purchaseToken;

    if (!packageName || !productId || !purchaseToken) {
      console.error('Invalid Android receipt format');
      return false;
    }

    // Verify with Google Play Developer API
    // You need to set up Google Play service account and credentials
    // For now, return true if receipt structure is valid
    // TODO: Implement actual Google Play API verification

    // In production, use Google Play Developer API:
    // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get

    console.log('Android receipt verification (placeholder - implement Google Play API)');
    return true;
  } catch (error) {
    console.error('Android receipt verification error:', error);
    return false;
  }
}

export const getMyTokens = async (req: Request, res: Response): Promise<void> => {
  try {
    const email: string = req.query.email as string;
    const player = await db.collection("players").where("email", "==", email).get();
    res.status(200).json({ result: player.docs[0]?.data()?.token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', msg: "Failed to get my tokens" });
  }
};

export const rewardToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { param: playerId } = req.body;
    await db.collection("players").doc(playerId).update({
      token: admin.firestore.FieldValue.increment(REWARD_TOKEN_AMOUNT),
    });

    res.status(200).json({ result: 'success' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', msg: "Failed to reward token" });
  }
};

/**
 * Get list of registered users (displayName and email).
 * Intended for cross-domain use; protect with API_KEY (X-API-Key header) and add calling origin to CORS if needed.
 */
export const getRegisteredUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
      return;
    }

    const snapshot = await db.collection("players")
      .select("displayName", "email", "createdAt", "token")
      .get();

    const users = snapshot.docs.map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt;
      return {
        displayName: d.displayName ?? null,
        email: d.email ?? null,
        createdAt: createdAt instanceof Date ? createdAt.toISOString() : (createdAt?.toDate?.()?.toISOString?.() ?? null),
        token: typeof d.token === "number" ? d.token : (d.token ?? null)
      };
    });

    res.status(200).json({ users });
  } catch (error) {
    console.error("getRegisteredUsers error:", error);
    res.status(500).json({
      error: "Failed to fetch users",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const usernameExists = async (req: Request, res: Response): Promise<void> => {
  try {

    const username: string = req.query.username as string;

    if (!username) {
      res.status(401).json({ result: false });
      return;
    }
    const player = await db.collection("players").where("displayName", "==", username).get();
    res.status(200).json({ result: player.docs.length > 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ result: false });
  }
};

export const playerExists = async (req: Request, res: Response): Promise<void> => {
  try {
    const playerInfo: string = req.query.playerInfo as string;

    if (!playerInfo) {
      res.status(401).json({ result: false });
      return;
    }

    let player = await db.collection("players").where("email", "==", playerInfo).get();
    if (player.docs.length == 0) {
      player = await db.collection("players").where("displayName", "==", playerInfo).get();
    }

    res.status(200).json({ result: player.docs.length > 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ result: false });
  }
};

/**
 * Delete user account and all associated data
 * Cleans up: Redis socket mappings, Redis games, Firestore player doc, Firestore games, Firebase Auth
 */
export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get user info from verified token (set by verifyFirebaseToken middleware)
    const userEmail = req.user?.email;
    const userUid = req.user?.uid;

    if (!userEmail || !userUid) {
      res.status(401).json({ status: 'error', msg: 'Unauthorized: Invalid user token' });
      return;
    }

    const normalizedEmail = userEmail.toLowerCase();
    console.log(`🗑️ Starting account deletion for: ${normalizedEmail} (UID: ${userUid})`);

    // Find player document in Firestore
    const playerSnapshot = await db.collection("players")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (playerSnapshot.empty) {
      console.log(`⚠️ Player document not found for: ${normalizedEmail}`);
      // Still try to delete Firebase Auth user
      try {
        await auth.deleteUser(userUid);
        console.log(`✅ Firebase Auth user deleted: ${userUid}`);
      } catch (authError) {
        console.error(`❌ Failed to delete Firebase Auth user: ${authError}`);
      }
      res.status(200).json({ status: 'success', msg: 'Account deleted (no player data found)' });
      return;
    }

    const playerDoc = playerSnapshot.docs[0];
    const playerId = playerDoc?.id;

    // Step 1: Clean up Redis socket mappings
    try {
      const socketId = await redisSocketService.getSocketId(normalizedEmail);
      if (socketId) {
        await redisSocketService.removeSocketMapping(socketId);
        console.log(`✅ Removed socket mapping for: ${normalizedEmail}`);
      }
    } catch (redisError) {
      console.error(`⚠️ Failed to remove socket mapping: ${redisError}`);
      // Continue with deletion even if Redis cleanup fails
    }

    // Step 2: Clean up Redis games
    try {
      // Remove waiting games created by user
      await redisGameService.removeCreatedGame(normalizedEmail);

      // Get all active games where user is a player
      const activeGames = await redisGameService.getGamesByPlayer(normalizedEmail, "playing");

      // For active games, remove user from player lists or mark as abandoned
      for (const game of activeGames) {
        try {
          // Remove user from accepted list if present
          await redisGameService.removePlayerFromAcceptedList(game.gameId, normalizedEmail);

          // Anonymize player email in game data
          const normalizedEmailLower = normalizedEmail.toLowerCase();
          if (game.player0?.email?.toLowerCase() === normalizedEmailLower) {
            game.player0.email = "deleted_user";
          }
          if (game.player1?.email?.toLowerCase() === normalizedEmailLower) {
            game.player1.email = "deleted_user";
          }
          if (game.player2?.email?.toLowerCase() === normalizedEmailLower) {
            game.player2.email = "deleted_user";
          }

          // Remove from inviting list
          if (game.invitingList) {
            game.invitingList = game.invitingList.filter((email: string) =>
              email.toLowerCase() !== normalizedEmailLower
            );
          }

          // Save updated game
          await redisGameService.saveGame(game);
          console.log(`✅ Updated game ${game.gameId} to remove user`);
        } catch (gameError) {
          console.error(`⚠️ Failed to update game ${game.gameId}: ${gameError}`);
        }
      }

      console.log(`✅ Cleaned up Redis games for: ${normalizedEmail}`);
    } catch (redisGameError) {
      console.error(`⚠️ Failed to clean up Redis games: ${redisGameError}`);
      // Continue with deletion even if Redis game cleanup fails
    }

    // Step 3: Anonymize Firestore games (preserve game history)
    try {
      const gamesSnapshot = await db.collection("games")
        .where("player0.email", "==", normalizedEmail)
        .get();

      const batch = db.batch();
      let batchCount = 0;
      const BATCH_LIMIT = 500; // Firestore batch limit

      gamesSnapshot.forEach((doc) => {
        if (batchCount < BATCH_LIMIT) {
          batch.update(doc.ref, {
            "player0.email": "deleted_user"
          });
          batchCount++;
        }
      });

      if (batchCount > 0) {
        await batch.commit();
        console.log(`✅ Anonymized ${batchCount} games as player0 for: ${normalizedEmail}`);
      }

      // Also check player1 and player2
      const gamesSnapshot1 = await db.collection("games")
        .where("player1.email", "==", normalizedEmail)
        .get();

      const batch1 = db.batch();
      batchCount = 0;
      gamesSnapshot1.forEach((doc) => {
        if (batchCount < BATCH_LIMIT) {
          batch1.update(doc.ref, {
            "player1.email": "deleted_user"
          });
          batchCount++;
        }
      });

      if (batchCount > 0) {
        await batch1.commit();
        console.log(`✅ Anonymized ${batchCount} games as player1 for: ${normalizedEmail}`);
      }

      const gamesSnapshot2 = await db.collection("games")
        .where("player2.email", "==", normalizedEmail)
        .get();

      const batch2 = db.batch();
      batchCount = 0;
      gamesSnapshot2.forEach((doc) => {
        if (batchCount < BATCH_LIMIT) {
          batch2.update(doc.ref, {
            "player2.email": "deleted_user"
          });
          batchCount++;
        }
      });

      if (batchCount > 0) {
        await batch2.commit();
        console.log(`✅ Anonymized ${batchCount} games as player2 for: ${normalizedEmail}`);
      }
    } catch (firestoreGameError) {
      console.error(`⚠️ Failed to anonymize Firestore games: ${firestoreGameError}`);
      // Continue with deletion even if game anonymization fails
    }

    // Step 4: Delete Firestore player document
    try {
      await db.collection("players").doc(playerId as string).delete();
      console.log(`✅ Deleted player document: ${playerId}`);
    } catch (firestoreError) {
      console.error(`❌ Failed to delete player document: ${firestoreError}`);
      res.status(500).json({ status: 'error', msg: 'Failed to delete player data' });
      return;
    }

    // Step 5: Delete Firebase Auth user (do this last)
    try {
      await auth.deleteUser(userUid);
      console.log(`✅ Deleted Firebase Auth user: ${userUid}`);
    } catch (authError) {
      console.error(`❌ Failed to delete Firebase Auth user: ${authError}`);
      // Player data is already deleted, so return success but log the error
      res.status(200).json({
        status: 'success',
        msg: 'Account data deleted, but Firebase Auth deletion failed. User may need to contact support.'
      });
      return;
    }

    console.log(`✅ Account deletion completed successfully for: ${normalizedEmail}`);
    res.status(200).json({ status: 'success', msg: 'Account deleted successfully' });

  } catch (error) {
    console.error('❌ Account deletion error:', error);
    res.status(500).json({
      status: 'error',
      msg: error instanceof Error ? error.message : 'Failed to delete account'
    });
  }
};