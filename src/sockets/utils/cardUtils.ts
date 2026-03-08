import { CARD_COUNT } from "../../config/constants.js";

export function generateDeck(): string[] {
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace', '2'];
  const suits = ['spades', 'clubs', 'diamonds', 'hearts'];
  const cardList: string[] = [];

  for (const rank of ranks) {
    for (const suit of suits) {
      cardList.push(`${rank}_of_${suit}`);
    }
  }

  return cardList;
}

// shuffle deck and must include 3 of spades
export function shuffleDeck(deck: string[]): string[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }

  const selected = shuffled.slice(0, CARD_COUNT);

  if (!selected.includes('3_of_spades')) {
    // Remove one random card to make space
    const randomIndex = Math.floor(Math.random() * selected.length);
    selected.splice(randomIndex, 1);

    // Add 'spade_3'
    selected.push('3_of_spades');
  }

  return selected;
}
