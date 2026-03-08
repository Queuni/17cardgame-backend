export interface GameData {
  gameId: string;
  gameName: string;
  player0: GamePlayer;
  player1: GamePlayer;
  player2: GamePlayer;
  betAmount: number;
  status?: string;
  invitingList: string[];
  acceptedList: string[];
  hasCPU: boolean;
  currentPlayerIndex?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface GamePlayer {
  email: string;
  name: string;
  isCPU: boolean;
  difficulty: CPUDifficulty; // 0: normal, 1: hard
  hands: string[];
  tokens: number;
  wins: number;
  avatarIndex: number;
}

export enum CPUDifficulty {
  Normal = "Normal",
  Hard = "Hard",
}