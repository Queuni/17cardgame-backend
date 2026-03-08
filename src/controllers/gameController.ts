import { Request, Response } from "express";
import { db } from "../config/firebase.js";
import firebasePlayerService from "../services/firebasePlayerService.js";

export const getLeaderBoardData = async (req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await db
      .collection("players")
      .orderBy("stats.wins", "desc")
      .orderBy("token", "desc")
      .limit(10)
      .get();

    const leaderBoardRows = snapshot.docs.map((doc, index) => {
      const d = doc.data();
      return {
        rank: index + 1,
        name: d.displayName,
        wins: d.stats?.wins ?? 0,
        tokens: d.token ?? 0
      };
    });

    res.status(200).json({ leaderBoardRows });
  } catch (error) {
    console.error("Error getting leaderboard data:", error);
    res.status(500).json({ error: "Failed to get leaderboard data" });
  }
};
