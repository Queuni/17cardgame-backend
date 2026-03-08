export enum Suit {
    Spades = "Spades",
    Clubs = "Clubs",
    Diamonds = "Diamonds",
    Hearts = "Hearts",
  }
  
  export enum PlayType {
    Single = "Single",
    Pair = "Pair",
    Set = "Set",
    Run = "Run",
    SuitedRun = "SuitedRun",
    PairedRun = "PairedRun",
    Bomb = "Bomb",
  }
  
  export enum CPUDifficulty {
    Normal = "Normal",
    Hard = "Hard",
  }
  
  export interface Card {
    rank: number;
    suit: Suit;
  }
  
  export interface Play {
    type: PlayType;
    cards: Card[];
    strength: number;
  }