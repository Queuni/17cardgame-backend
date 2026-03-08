import { db } from "../config/firebase.js";
import { GameData } from "../types/game.js";

export class FirebaseGameService {
    private readonly GAMES_COLLECTION = "games";

    /**
     * Save a multiplayer game to Firebase Firestore
     * Only saves games without CPU players (hasCPU = false)
     */
    async saveGame(gameData: GameData): Promise<void> {
        try {
            // Only save multiplayer games (no CPU players)
            if (gameData.hasCPU) {
                console.log(`Skipping Firebase save for game ${gameData.gameId}: Contains CPU players`);
                return;
            }

            // Prepare game data for Firebase (only save essential multiplayer game info)
            const firebaseGameData = {
                gameId: gameData.gameId,
                gameName: gameData.gameName,
                player0: {
                    email: gameData.player0.email,
                    // Don't save: name, avatarIndex, tokens, wins, hands, isCPU
                },
                player1: {
                    email: gameData.player1.email,
                    // Don't save: name, avatarIndex, tokens, wins, hands, isCPU
                },
                player2: {
                    email: gameData.player2.email,
                    // Don't save: name, avatarIndex, tokens, wins, hands, isCPU
                },
                betAmount: gameData.betAmount,
                status: gameData.status || "playing",
                // Don't save: currentPlayerIndex
                createdAt: gameData.createdAt || new Date().toISOString(),
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // Save to Firestore using gameId as document ID
            await db.collection(this.GAMES_COLLECTION).doc(gameData.gameId).set(firebaseGameData);

            console.log(`✅ Game ${gameData.gameId} saved to Firebase`);
        } catch (error) {
            console.error(`❌ Error saving game ${gameData.gameId} to Firebase:`, error);
            // Don't throw - Firebase save failure shouldn't break game start
        }
    }

    /**
     * Update game status in Firebase
     * Uses set with merge to handle cases where document might not exist
     */
    async updateGameStatus(gameId: string, status: string, additionalData?: Record<string, any>): Promise<void> {
        try {
            const updateData: any = {
                status,
                updatedAt: new Date().toISOString(),
                ...additionalData,
            };

            // Use set with merge: true to update existing document or create if it doesn't exist
            // This is safer than update() which fails if document doesn't exist
            await db.collection(this.GAMES_COLLECTION).doc(gameId).set(updateData, { merge: true });
            console.log(`✅ Game ${gameId} status updated to ${status} in Firebase`);
        } catch (error) {
            console.error(`❌ Error updating game ${gameId} status in Firebase:`, error);
        }
    }

    /**
     * Get game from Firebase
     */
    async getGame(gameId: string): Promise<GameData | null> {
        try {
            const doc = await db.collection(this.GAMES_COLLECTION).doc(gameId).get();

            if (!doc.exists) {
                return null;
            }

            return doc.data() as GameData;
        } catch (error) {
            console.error(`❌ Error getting game ${gameId} from Firebase:`, error);
            return null;
        }
    }

    /**
     * Delete game from Firebase
     */
    async deleteGame(gameId: string): Promise<void> {
        try {
            await db.collection(this.GAMES_COLLECTION).doc(gameId).delete();
            console.log(`✅ Game ${gameId} deleted from Firebase`);
        } catch (error) {
            console.error(`❌ Error deleting game ${gameId} from Firebase:`, error);
        }
    }
}

export default new FirebaseGameService();

