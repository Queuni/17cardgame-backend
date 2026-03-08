import { SocketContext } from "../../types/socket.js";
import redisGameService from "../../services/redisGameService.js";
import redisSocketService from "../../services/redisSocketService.js";
import firebaseGameService from "../../services/firebaseGameService.js";
import { generateDeck, shuffleDeck } from "../utils/cardUtils.js";
import { GamePlayer, GameData } from "../../types/game.js";
import { choosePlay } from "../utils/ruleUtils.js";
import firebasePlayerService from "../../services/firebasePlayerService.js";
import { getAuthenticatedEmail, AuthenticatedSocket } from "../middleware/socketAuth.js";
import { DEFAULT_TOKEN } from "../../config/constants.js";
import { logger } from "../../utils/logger.js";

export async function handleStartGame(context: SocketContext, data: any) {
  const { io, socket } = context;
  const jsonData = redisSocketService.getSafeJson(data);
  const gameId: string = jsonData['param'];

  try {
    if (!gameId) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    // generate deck and shuffle and deal cards to players
    const cardList = generateDeck();
    const deck = shuffleDeck(cardList);

    const totalHands = [
      deck.slice(0, 17),
      deck.slice(17, 34),
      deck.slice(34, 51)
    ];

    const gameInfo = await redisGameService.getGame(gameId) as GameData;

    // update game field with player hands
    gameInfo.player0.hands = totalHands[0] as string[];
    gameInfo.player1.hands = totalHands[1] as string[];
    gameInfo.player2.hands = totalHands[2] as string[];

    gameInfo.status = "playing";
    gameInfo.acceptedList = [];

    // get current player index
    const currentPlayerIndex = totalHands.findIndex(hand => hand.includes('3_of_spades'));

    // Store current player index in game state
    gameInfo.currentPlayerIndex = currentPlayerIndex;

    // Save multiplayer game to Firebase when it starts
    if (!gameInfo.hasCPU) {
      // Update game status to "playing" before saving
      const gameDataToSave = {
        ...gameInfo,
        status: "playing",
        currentPlayerIndex,
        updatedAt: new Date().toISOString(),
      };
      await firebaseGameService.saveGame(gameDataToSave);
    }

    const gameName = gameInfo.gameName;
    const betAmount = gameInfo.betAmount;

    if (!gameInfo.hasCPU) {
      const tokens = await Promise.all(
        [gameInfo.player0, gameInfo.player1, gameInfo.player2].map(p => firebasePlayerService.getPlayerToken(p.email))
      );
      [gameInfo.player0.tokens, gameInfo.player1.tokens, gameInfo.player2.tokens] = tokens as [number, number, number];
    }
    else {
      [gameInfo.player0, gameInfo.player1, gameInfo.player2].forEach(
        p => (p.tokens = DEFAULT_TOKEN)
      );
    }

    await redisGameService.saveGame(gameInfo);

    const playerList = [
      gameInfo.player0,
      gameInfo.player1,
      gameInfo.player2,
    ];

    const playerNames: string[] = playerList.map(player => player.name);
    const playerTokens: number[] = playerList.map(player => player.tokens);
    const playerAvatarIndexes: number[] = playerList.map(player => player.avatarIndex);

    for (let i = 0; i < 3; i++) {
      const player = playerList[i];
      if (player && player.isCPU == false) {
        const socketId = await redisSocketService.getSocketId(player.email);

        if (socketId) {
          const gameStartInfo = {
            gameId: gameId,
            gameName,
            betAmount,
            hasCPU: gameInfo.hasCPU,
            playerHands: totalHands[i],
            myTurnIndex: i,
            currentPlayerIndex,
            playerNames,
            playerTokens,
            playerAvatarIndexes,
            firstTrick: true
          };

          const startInfoString = JSON.stringify(gameStartInfo);
          io.to(socketId).emit("game_starting", startInfoString);
        }
      }
    }

  } catch (error) {
    logger.error("START_GAME_FAILED", `error:${error}`);
    socket.emit("error", { message: "Failed to start game" });
  }
}

export async function handleSendPlayerTurn(context: SocketContext, data: any) {
  const { io, socket } = context;

  const json = redisSocketService.getSafeJson(data);
  const gameId = json.gameId;
  let isPassed = json.isPassed;
  let currentTopCards = json.currentTopCards;
  let passesInRow = isPassed == true ? json.passesInRow + 1 : json.passesInRow;
  let winnerInfo = null;

  try {
    if (!gameId) {
      socket.emit("error", { message: "Game ID is required" });
      return;
    }

    const gameInfo = await redisGameService.getGame(gameId) as GameData;
    if (!gameInfo) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    // Get the actual current player index from server state
    const serverCurrentPlayerIndex = gameInfo.currentPlayerIndex ?? 0;

    // Validate that the requesting player is the current player
    const authSocket = socket as AuthenticatedSocket;
    const requestingPlayerEmail = getAuthenticatedEmail(authSocket)?.toLowerCase();

    if (!requestingPlayerEmail) {
      socket.emit("error", { message: "User not authenticated" });
      return;
    }
    const currentPlayerKey = `player${serverCurrentPlayerIndex}` as keyof GameData;
    const currentPlayer = gameInfo[currentPlayerKey] as GamePlayer;

    if (!currentPlayer) {
      socket.emit("error", { message: "Current player not found" });
      return;
    }

    // Check if requesting player is the current player (skip validation for CPU players)
    if (!currentPlayer.isCPU) {
      const currentPlayerEmail = (currentPlayer.email || "").toLowerCase();
      if (requestingPlayerEmail !== currentPlayerEmail) {
        socket.emit("error", { message: "It is not your turn" });
        return;
      }
    }

    // Use server's current player index instead of client's
    let currentPlayerIndex = serverCurrentPlayerIndex;

    if (currentTopCards !== null) {
      // Update the player's hands
      const remainedCount = await updatePlayerHands(gameId, currentPlayerIndex, currentTopCards);

      // Check if the player has no cards left
      if (remainedCount === 0) {
        const playerKey = `player${currentPlayerIndex}` as keyof GameData;
        const player = gameInfo[playerKey] as GamePlayer;
        const winnerEmail = player.email;
        const winnerName = player.name;
        await redisGameService.updateGameField(gameId, `${playerKey}.wins`, (player.wins || 0) + 1);

        // update player token
        await updatePlayerTokens(gameId, winnerEmail);

        // Update winner's stats in Firebase (only for multiplayer games)
        if (!gameInfo.hasCPU && !player.isCPU) {
          const tokensWon = gameInfo.betAmount * 3; // Total tokens won (betAmount * 3)
          await firebasePlayerService.updateWinnerStats(winnerEmail, tokensWon);
        }

        // Check if game is finished (any player out of tokens) BEFORE setting winnerInfo
        const gameFinished = await isAnyPlayerOutOfTokens(gameId);

        // if no player is out of tokens, set winner info for round finished
        if (!gameFinished) {
          winnerInfo = {
            winnerName,
            winnerIndex: currentPlayerIndex,
            wonToken: gameInfo.betAmount * 3,
          };
        }
      }
    }

    if (passesInRow >= 2) {
      passesInRow = 0;
      currentTopCards = null;
    }

    // update current player index
    currentPlayerIndex = (currentPlayerIndex + 1) % 3;

    // Update current player index in game state
    await redisGameService.updateGameField(gameId, "currentPlayerIndex", currentPlayerIndex);

    const playerTurnInfo = {
      gameId,
      isPassed,
      passesInRow,
      currentTopCards, // Clear cards if passesInRow >= 2
      currentPlayerIndex,
      firstTrick: false,
      winnerInfo,
    };

    // broadcast player turn to game (with winnerInfo if round finished, or null if game finished)
    io.to(gameId).emit("receive_player_turn", JSON.stringify(playerTurnInfo));

    // if any player is out of tokens, finish the game (after showing last cards)
    // Add a small delay to ensure cards are displayed before showing game finished dialog
    if (await isAnyPlayerOutOfTokens(gameId)) {
      setTimeout(async () => {
        await handleGameFinished(io, gameId);
      }, 2500); // 2 second delay to show last played cards
      return;
    }

    // if there is a winner, return
    if (playerTurnInfo.winnerInfo !== null) {
      return;
    }

    setTimeout(async () => {
      await handleCpuTurn(io, playerTurnInfo, gameInfo);
    }, 1000);

  } catch (error) {
    logger.error("SEND_TURN_FAILED", `error:${error}`);
    socket.emit("error", { message: "Failed to send card played" });
  }
}

async function handleCpuTurn(io: any, playerTurnInfo: any, gameInfo: any) {
  // handle if next player is cpu turn
  let {
    gameId,
    isPassed,
    passesInRow,
    currentTopCards, // Clear cards if passesInRow >= 2
    currentPlayerIndex,
    firstTrick,
    winnerInfo,
  } = playerTurnInfo;

  const player = gameInfo[`player${currentPlayerIndex}` as keyof typeof gameInfo] as GamePlayer;

  if (!player?.isCPU) return;
  // if next player is cpu turn
  const cpuPlayCards = choosePlay(player.hands, false, currentTopCards, player.difficulty);

  if (cpuPlayCards.length > 0) {
    currentTopCards = cpuPlayCards;
    isPassed = false;
    passesInRow = 0;
    const remainedCount = await updatePlayerHands(gameId, currentPlayerIndex, cpuPlayCards);
    if (remainedCount === 0) {
      const playerKey = `player${currentPlayerIndex}` as keyof GameData;
      // Update wins in Redis for CPU player
      await redisGameService.updateGameField(gameId, `${playerKey}.wins`, (player.wins || 0) + 1);

      await updatePlayerTokens(gameId, player.email);

      // Check if game is finished (any player out of tokens) BEFORE setting winnerInfo
      const gameFinished = await isAnyPlayerOutOfTokens(gameId);

      // if no player is out of tokens, set winner info for round finished
      if (!gameFinished) {
        winnerInfo = {
          winnerName: player.name,
          winnerIndex: currentPlayerIndex,
          wonToken: gameInfo.betAmount * 3,
        };
      }
    }
  }
  else {
    isPassed = true;
    passesInRow = passesInRow + 1;
    if (passesInRow >= 2) {
      passesInRow = 0;
      currentTopCards = null;
    }
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % 3;

  // Update current player index in game state
  await redisGameService.updateGameField(gameId, "currentPlayerIndex", currentPlayerIndex);

  const updatedTurnInfo = {
    gameId,
    isPassed,
    passesInRow,
    currentTopCards, // Clear cards if passesInRow >= 2
    currentPlayerIndex,
    firstTrick,
    winnerInfo,
  };
  // broadcast player turn to game
  io.to(gameId).emit("receive_player_turn", JSON.stringify(updatedTurnInfo));

  // if any player is out of tokens, finish the game (after showing last cards)
  if (await isAnyPlayerOutOfTokens(gameId)) {
    setTimeout(async () => {
      await handleGameFinished(io, gameId);
    }, 1000); // 2 second delay to show last played cards
    return;
  }
}

export async function handleDealEndedAction(context: SocketContext, data: any) {
  const { io, socket } = context;

  const { gameId, starterIndex } = redisSocketService.getSafeJson(data);

  try {
    if (!gameId) {
      socket.emit("error", { message: "Game ID is required" });
      return;
    }

    const gameInfo = await redisGameService.getGame(gameId);
    if (!gameInfo) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    // if starter is cpu turn
    const player = gameInfo[`player${starterIndex}` as keyof typeof gameInfo] as GamePlayer;
    if (player && player.isCPU == true) {
      const cpuPlayCards = choosePlay(player.hands, true, [], player.difficulty);

      if (cpuPlayCards && cpuPlayCards.length > 0) {
        await updatePlayerHands(gameId, starterIndex, cpuPlayCards);

        for (let i = 1; i < 3; i++) {
          const otherPlayer = gameInfo[`player${(starterIndex + i) % 3}` as keyof typeof gameInfo] as GamePlayer;
          const email = otherPlayer.email;

          if (email) {
            const socketId = await redisSocketService.getSocketId(email);

            if (socketId) {
              const isPassed = false;
              const passesInRow = 0;
              const currentTopCards = cpuPlayCards;
              const currentPlayerIndex = (starterIndex + 1) % 3;
              const winnerInfo = null;

              // Update current player index in game state
              await redisGameService.updateGameField(gameId, "currentPlayerIndex", currentPlayerIndex);

              const cpuTurnInfo = {
                gameId,
                isPassed,
                passesInRow,
                currentTopCards, // Clear cards if passesInRow >= 2
                currentPlayerIndex,
                firstTrick: false,
                winnerInfo,
              };

              io.to(socketId).emit("receive_player_turn", JSON.stringify(cpuTurnInfo));
            }
          }
        }
      }
    }
  }
  catch (error) {
    logger.error("DEAL_ENDED_FAILED", `error:${error}`);
    socket.emit("error", { message: "Failed to send deal ended" });
  }
}

async function updatePlayerHands(gameId: string, playerIndex: number, playedCards: string[]) {
  try {
    const playerKey = `player${playerIndex}.hands`;
    const remainedCards = await redisGameService.getGameField(gameId, playerKey);
    const newRemainedCards = remainedCards.filter((card: string) => !playedCards.includes(card));
    await redisGameService.updateGameField(gameId, playerKey, newRemainedCards);

    return newRemainedCards.length;
  }
  catch (error) {
    logger.error("UPDATE_HANDS_FAILED", `error:${error}`);
  }
}

async function updatePlayerTokens(gameId: string, winnerEmail: string) {
  try {
    const gameInfo = await redisGameService.getGame(gameId) as GameData;
    if (!gameInfo) {
      logger.error("GAME_NOT_FOUND", `gameId:${gameId}`);
      return;
    }

    const betAmount = gameInfo.betAmount;
    const normalizedWinnerEmail = winnerEmail.toLowerCase();

    const tokenUpdates: Record<string, number> = {};
    const playerKeys: (keyof Pick<GameData, "player0" | "player1" | "player2">)[] = [
      "player0",
      "player1",
      "player2",
    ];

    // Update tokens in memory for all players (including CPU)
    for (const key of playerKeys) {
      const player = gameInfo[key];
      if (!player) continue;

      const normalizedPlayerEmail = player.email?.toLowerCase();
      if (!normalizedPlayerEmail) continue;

      if (normalizedPlayerEmail === normalizedWinnerEmail) {
        // Winner: gains betAmount * 2 (they bet betAmount, win betAmount * 3, net gain is betAmount * 2)
        player.tokens += betAmount * 2;
        if (!gameInfo.hasCPU) {
          tokenUpdates[player.email] = betAmount * 2;
        }
      } else {
        // Loser: loses betAmount
        player.tokens -= betAmount;
        if (!gameInfo.hasCPU) {
          tokenUpdates[player.email] = -betAmount;
        }
      }

      // Update Redis game field for this player's tokens
      await redisGameService.updateGameField(gameId, `${key}.tokens`, player.tokens);
      logger.info("TOKENS_UPDATED", `email:${normalizedPlayerEmail} tokens:${player.tokens}`);
    }

    // Update Firestore for human players (if there are any human players)
    if (Object.keys(tokenUpdates).length > 0) {
      await firebasePlayerService.updatePlayerTokens(tokenUpdates);
    }
  }
  catch (error) {
    logger.error("UPDATE_TOKENS_FAILED", `error:${error}`);
  }
}

export async function handleSendPlayAgain(context: SocketContext, data: any) {
  const { io, socket } = context;
  try {
    const { param: gameId } = redisSocketService.getSafeJson(data);
    const authSocket = socket as AuthenticatedSocket;
    const email = getAuthenticatedEmail(authSocket)?.toLowerCase();

    if (!email) {
      socket.emit("error", { message: "User not authenticated" });
      return;
    }

    await redisGameService.addPlayerToAcceptedList(gameId, email);

    logger.info("PLAY_AGAIN", `email:${email}`);

    const acceptedList = await redisGameService.getGameField(gameId, "acceptedList");
    const gameInfo = await redisGameService.getGame(gameId) as GameData;
    const humanPlayers = [gameInfo.player0, gameInfo.player1, gameInfo.player2].filter(p => !p.isCPU);

    if (acceptedList.length === humanPlayers.length) {
      await handleContinueGame(io, gameId);
    }
  }
  catch (error) {
    console.error("Error sending play again:", error);
    socket.emit("error", { message: "Failed to send play again" });
  }
}

async function handleContinueGame(io: any, gameId: string) {
  try {
    const gameInfo = await redisGameService.getGame(gameId) as GameData;
    if (!gameInfo) {
      return;
    }

    // generate deck and shuffle and deal cards to players
    const cardList = generateDeck();
    const deck = shuffleDeck(cardList);

    const totalHands = [
      deck.slice(0, 17),
      deck.slice(17, 34),
      deck.slice(34, 51)
    ];

    // update game field with player hands
    await redisGameService.updateGameField(gameId, "player0.hands", totalHands[0]);
    await redisGameService.updateGameField(gameId, "player1.hands", totalHands[1]);
    await redisGameService.updateGameField(gameId, "player2.hands", totalHands[2]);

    await redisGameService.updateGameField(gameId, "acceptedList", []);

    // get current player index
    const currentPlayerIndex = totalHands.findIndex(hand => hand.includes('3_of_spades'));

    // Store current player index in game state
    await redisGameService.updateGameField(gameId, "currentPlayerIndex", currentPlayerIndex);

    const playerList = [
      gameInfo.player0,
      gameInfo.player1,
      gameInfo.player2,
    ];

    let playerTokens: number[] = [];
    if (gameInfo.hasCPU == true) {
      playerTokens = playerList.map(p => p.tokens);
    }
    else {
      playerTokens = await Promise.all(
        playerList.map(p => firebasePlayerService.getPlayerToken(p.email))
      );
    }

    playerList.forEach(async (player, index) => {
      if (player && player.isCPU == false) {
        const socketId = await redisSocketService.getSocketId(player.email);

        if (socketId) {
          const gameContinueInfo = {
            gameId: gameId,
            playerHands: totalHands[index],
            myTurnIndex: index,
            currentPlayerIndex,
            firstTrick: true,
            playerTokens
          };

          console.log("Sending game continue info to", player.email, "with tokens", playerTokens);

          const continueInfoString = JSON.stringify(gameContinueInfo);
          io.to(socketId).emit("game_continued", continueInfoString);
        }
      }
    });
  }
  catch (error) {
    console.error("Error continuing game:", error);
  }
}

async function isAnyPlayerOutOfTokens(gameId: string) {
  const gameInfo = await redisGameService.getGame(gameId) as GameData;
  const playerList = [gameInfo.player0, gameInfo.player1, gameInfo.player2];
  return playerList.some(player => player.tokens < gameInfo.betAmount);
}

async function handleGameFinished(io: any, gameId: string) {
  try {
    const gameInfo = await redisGameService.getGame(gameId) as GameData;
    if (!gameInfo) {
      return;
    }

    // Update game status to "finished" in Redis
    await redisGameService.updateGameField(gameId, "status", "finished");

    // Update Firebase if it's a multiplayer game
    if (!gameInfo.hasCPU) {
      await firebaseGameService.updateGameStatus(gameId, "finished", {
        finishedAt: new Date().toISOString(),
      });
    }

    const playerList = [gameInfo.player0, gameInfo.player1, gameInfo.player2];
    const scoreInfoList = playerList.map(player => { return { name: player.name, wins: player.wins } }).sort((a, b) => b.wins - a.wins); // sort by wins descending
    const resultInfoJson = JSON.stringify({ scoreInfoList: scoreInfoList });
    io.to(gameInfo.gameId).emit("game_finished", resultInfoJson);
    console.log("Game finished:", gameInfo);
  }
  catch (error) {
    console.error("Error handling game finished:", error);
  }
}