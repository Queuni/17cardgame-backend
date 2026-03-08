import { db } from "../config/firebase.js";
import { DEFAULT_TOKEN } from "../config/constants.js";

export class FirebasePlayerService {
    private readonly PLAYERS_COLLECTION = "players";

    /**
     * Get player's display name from Firebase
     */
    async getPlayerName(email: string): Promise<string> {
        try {
            const snapshot = await db.collection(this.PLAYERS_COLLECTION)
                .where("email", "==", email)
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log("❌ No player found with email:", email);
                return email;
            }

            const doc = snapshot.docs[0];
            const data = doc?.data();
            return data?.displayName || email;
        } catch (error) {
            console.error("Error getting player name:", error);
            throw error;
        }
    }

    /**
     * Get player info (displayName, avatarIndex) from Firebase
     */
    async getPlayerInfo(nameOrEmail: string): Promise<{ displayName: string; avatarIndex: number; email: string }> {
        try {
            const snapshot = await db.collection(this.PLAYERS_COLLECTION)
                .where("email", "==", nameOrEmail)
                .limit(1)
                .get();

            let doc = snapshot.docs[0];
            if (!doc) {
                const snapshot_again = await db.collection(this.PLAYERS_COLLECTION)
                    .where("displayName", "==", nameOrEmail)
                    .limit(1)
                    .get();
                doc = snapshot_again.docs[0];
                if (!doc) {
                    throw new Error(`Player not found: ${nameOrEmail}`);
                }
            }

            const data = doc.data();
            return {
                displayName: data?.displayName || data?.email,
                avatarIndex: data?.avatarIndex || 0,
                email: data?.email || nameOrEmail,
            };
        } catch (error) {
            console.error("Error getting player info:", error);
            throw error;
        }
    }

    /**
     * Get player's token amount from Firebase
     */
    async getPlayerToken(email: string): Promise<number> {
        try {
            const snapshot = await db.collection(this.PLAYERS_COLLECTION)
                .where("email", "==", email)
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log("❌ No player found with email:", email);
                return DEFAULT_TOKEN;
            }

            const doc = snapshot.docs[0];
            const data = doc?.data();
            return data?.token ?? DEFAULT_TOKEN;
        } catch (error) {
            console.error("Error getting player token amount:", error);
            throw error;
        }
    }

    /**
     * Safely increments or decrements players' tokens in Firebase
     * Uses Firestore batch to prevent race conditions
     */
    async updatePlayerTokens(
        tokenChanges: Record<string, number>
    ): Promise<void> {
        const batch = db.batch();

        try {
            for (const [email, delta] of Object.entries(tokenChanges)) {
                // Find the player by email
                const playersRef = db.collection(this.PLAYERS_COLLECTION);
                const snap = await playersRef.where("email", "==", email).limit(1).get();

                if (snap.empty) {
                    console.warn(`⚠️ Player not found for email: ${email}`);
                    continue;
                }

                const doc = snap.docs[0];
                if (!doc) {
                    console.warn(`⚠️ Document not found for email: ${email}`);
                    continue;
                }

                const data = doc.data();
                const currentToken = data?.token ?? 0;
                const newToken = Math.max(currentToken + delta, 0); // prevent negative

                batch.update(doc.ref, {
                    token: newToken,
                    updated_at: new Date(),
                });

                console.log(`🪙 ${email}: ${currentToken} → ${newToken}`);
            }

            await batch.commit();
            console.log("✅ Firestore tokens updated:", tokenChanges);
        } catch (error) {
            console.error("❌ Failed to update player tokens:", error);
        }
    }

    /**
     * Update winner's stats in Firebase (stats.wins, stats.tokens_won, stats.gamesPlayed)
     * Only updates for multiplayer games (human players)
     */
    async updateWinnerStats(
        winnerEmail: string,
        tokensWon: number
    ): Promise<void> {
        try {
            const playersRef = db.collection(this.PLAYERS_COLLECTION);
            const snap = await playersRef.where("email", "==", winnerEmail.toLowerCase()).limit(1).get();

            if (snap.empty) {
                console.warn(`⚠️ Player not found for email: ${winnerEmail}`);
                return;
            }

            const doc = snap.docs[0];
            if (!doc) {
                console.warn(`⚠️ Document not found for email: ${winnerEmail}`);
                return;
            }

            const data = doc.data();

            // Get current stats or initialize if they don't exist
            const currentWins = data?.stats?.wins || 0;
            const currentTokensWon = data?.stats?.tokens_won || 0;
            const currentGamesPlayed = data?.stats?.gamesPlayed || 0;

            // Update stats
            await doc.ref.update({
                "stats.wins": currentWins + 1,
                "stats.tokens_won": currentTokensWon + tokensWon,
                "stats.gamesPlayed": currentGamesPlayed + 1,
                updatedAt: new Date(),
            });

            console.log(`✅ Winner stats updated for ${winnerEmail}: wins ${currentWins} → ${currentWins + 1}, tokens_won ${currentTokensWon} → ${currentTokensWon + tokensWon}, gamesPlayed ${currentGamesPlayed} → ${currentGamesPlayed + 1}`);
        } catch (error) {
            console.error(`❌ Failed to update winner stats for ${winnerEmail}:`, error);
        }
    }
}

export default new FirebasePlayerService();

