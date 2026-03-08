import { Suit, Card, Play, PlayType } from "../../types/card.js";
import { CPUDifficulty } from "../../types/game.js";

const SUIT_PRIORITY: Record<Suit, number> = {
    [Suit.Spades]: 0,
    [Suit.Clubs]: 1,
    [Suit.Diamonds]: 2,
    [Suit.Hearts]: 3
};

export const SP = (suit: Suit): number => SUIT_PRIORITY[suit] ?? 0;

const RANK_MAP: Record<string, number> = {
    "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
    "jack": 11, "queen": 12, "king": 13, "ace": 14, "2": 15,
};

const RANK_REVERSE = Object.fromEntries(Object.entries(RANK_MAP).map(([k, v]) => [v, k]));

// ---------------- PARSERS ---------------- //
export function parseCard(str: string): Card {
    const parts = str.split("_");
    if (parts.length < 3) {
        throw new Error(`Invalid card format: ${str}`);
    }
    const rankStr = parts[0]!.toLowerCase();
    const suitStr = parts[2]!;
    const rank = RANK_MAP[rankStr];
    if (!rank) {
        throw new Error(`Invalid rank: ${rankStr}`);
    }
    const suit = (suitStr.charAt(0).toUpperCase() + suitStr.slice(1).toLowerCase()) as Suit;
    return { rank, suit };
}

export function cardToString(card: Card): string {
    const rankStr = RANK_REVERSE[card.rank];
    return `${rankStr}_of_${card.suit.toLowerCase()}`;
}

// ---------------- SORTING ---------------- //
export function sortCards(cards: Card[]): Card[] {
    return [...cards].sort(
        (a, b) =>
            a.rank === b.rank
                ? SUIT_PRIORITY[b.suit] - SUIT_PRIORITY[a.suit]
                : a.rank - b.rank
    );
}

// ---------------- PLAY DETECTORS ---------------- //
function getRunPlays(sorted: Card[]): Play[] {
    const plays: Play[] = [];
    // Sort cards by rank, then suit (for stability) - already sorted by sortCards

    for (let i = 0; i < sorted.length; i++) {
        const currentRun: Card[] = [sorted[i]!];

        for (let j = i + 1; j < sorted.length; j++) {
            // check if next card rank increases by 1 from the last card in currentRun
            // Use currentRun[currentRun.length - 1] instead of sorted[j-1] to handle duplicate ranks correctly
            const lastCardInRun = currentRun[currentRun.length - 1]!;
            if (sorted[j]!.rank === lastCardInRun.rank + 1) {
                currentRun.push(sorted[j]!);
            } else {
                // not consecutive → stop this run
                break;
            }
        }

        // If we found 3+ consecutive cards, make a run Play
        if (currentRun.length >= 3) {
            // Normal run
            const strength = currentRun[currentRun.length - 1]!.rank;
            plays.push({ type: PlayType.Run, cards: [...currentRun], strength });

            // Check if all cards share the same suit → Suited Run
            const suited = currentRun.every(c => c.suit === currentRun[0]!.suit);
            if (suited) {
                plays.push({ type: PlayType.SuitedRun, cards: [...currentRun], strength });
            }
        }
    }

    // Remove duplicates (same rank/suit combination)
    const seen = new Set<string>();
    return plays.filter(play => {
        const key = `${play.type}-${play.cards.map(c => `${c.suit}-${c.rank}`).join(",")}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function getPairedRunPlays(hand: Card[]): Play[] {
    const plays: Play[] = [];
    const byRank = new Map<number, Card[]>();
    for (const c of hand) {
        const existing = byRank.get(c.rank);
        if (existing) {
            existing.push(c);
        } else {
            byRank.set(c.rank, [c]);
        }
    }

    const pairRanks = [...byRank.entries()]
        .filter(([, cards]) => cards.length >= 2)
        .map(([r]) => r)
        .sort((a, b) => a - b);

    for (let i = 0; i < pairRanks.length; i++) {
        let j = i;
        while (j + 1 < pairRanks.length && pairRanks[j + 1] === pairRanks[j]! + 1) j++;
        const len = j - i + 1;

        if (len >= 3) {
            for (let size = 3; size <= len; size++) {
                for (let start = i; start <= j - size + 1; start++) {
                    const seqRanks = pairRanks.slice(start, start + size);
                    const cards = seqRanks.flatMap(r => byRank.get(r)!.slice(0, 2));
                    const strength = seqRanks[seqRanks.length - 1]!;
                    plays.push({ type: PlayType.PairedRun, cards, strength });
                }
            }
        }
        i = j;
    }

    return plays;
}

export function getAllPossiblePlays(hand: Card[]): Play[] {
    const plays: Play[] = [];
    const sorted = sortCards(hand);

    // Runs or suited runs
    plays.push(...getRunPlays(sorted));

    // Paired Runs
    plays.push(...getPairedRunPlays(sorted));

    // Singles
    for (const c of sorted) {
        plays.push({ type: PlayType.Single, cards: [c], strength: c.rank });
    }

    // Pairs, Sets, Bombs
    const byRank = new Map<number, Card[]>();
    for (const c of sorted) {
        const existing = byRank.get(c.rank);
        if (existing) {
            existing.push(c);
        } else {
            byRank.set(c.rank, [c]);
        }
    }

    for (const [rank, cards] of byRank.entries()) {
        const count = cards.length;

        if (count >= 2) {
            if (count === 2) {
                plays.push({ type: PlayType.Pair, cards: cards.slice(0, 2), strength: cards[cards.length - 1]!.rank });
            }
            if (count === 3) {
                plays.push({ type: PlayType.Set, cards, strength: cards[cards.length - 1]!.rank });
            }
            if (count === 4) {
                plays.push({ type: PlayType.Bomb, cards, strength: cards[cards.length - 1]!.rank + 20 });
            }
        }
    }

    return plays;
}

// ---------------- FIRST PLAY LOGIC ---------------- //
function findPlayByType(plays: Play[], type: PlayType): Play | null {
    return plays.find(p => p.type === type) ?? null;
}

export function getFirstPlay(possiblePlays: Play[]): Play | null {
    // Plays that contain 3 of Spades
    const firstPlayList = possiblePlays.filter(p =>
        p.cards.some(c => c.suit === Suit.Spades && c.rank === 3)
    );

    // Check all play types in priority order (matches Rules.cs GetFirstPlay)
    const chosen = findPlayByType(firstPlayList, PlayType.Run) ??
        findPlayByType(firstPlayList, PlayType.SuitedRun) ??
        findPlayByType(firstPlayList, PlayType.PairedRun) ??
        findPlayByType(firstPlayList, PlayType.Pair) ??
        findPlayByType(firstPlayList, PlayType.Set) ??
        findPlayByType(firstPlayList, PlayType.Single) ??
        findPlayByType(firstPlayList, PlayType.Bomb) ??
        null;

    // If no play found with 3 of Spades, fallback to any play with 3 of Spades
    if (!chosen && firstPlayList.length > 0) {
        console.log("No priority type found, returning first play with 3 of Spades");
        return firstPlayList[0] ?? null;
    }

    return chosen;
}

// ---------------- CPU BEST PLAY LOGIC ---------------- //
// Matches Rules.cs GetBestPlay exactly
export function getBestPlay(difficulty: CPUDifficulty, possiblePlays: Play[]): Play | null {
    if (possiblePlays.length === 0) return null;

    let bestPlay: Play | null = null;

    if (difficulty === CPUDifficulty.Hard) {
        // Hard difficulty: Prioritize Run → PairedRun → Set → Pair
        bestPlay = findPlayByType(possiblePlays, PlayType.Run)
            ?? findPlayByType(possiblePlays, PlayType.PairedRun)
            ?? findPlayByType(possiblePlays, PlayType.Set)
            ?? findPlayByType(possiblePlays, PlayType.Pair)
            ?? possiblePlays.sort((a, b) => a.type.localeCompare(b.type))[0] ?? null;
        return bestPlay;
    } else {
        // Normal difficulty: Prioritize Pair → Set → Run
        bestPlay = findPlayByType(possiblePlays, PlayType.Pair)
            ?? findPlayByType(possiblePlays, PlayType.Set)
            ?? findPlayByType(possiblePlays, PlayType.Run)
            ?? possiblePlays.sort((a, b) => a.type.localeCompare(b.type))[0] ?? null;
    }
    return bestPlay;
}

// ---------------- PLAY CHOOSING LOGIC ---------------- //

// Helper function to identify Play type and strength from an array of cards
// Matches Rules.cs BuildPlay exactly
function identifyPlay(cards: Card[]): Play | null {
    if (!cards || cards.length === 0) return null;

    const sorted = sortCards(cards);
    let play: Play | null = null;
    const count = sorted.length;

    // SINGLE
    if (count === 1) {
        play = { type: PlayType.Single, cards: sorted, strength: sorted[0]!.rank };
    }

    // PAIR
    if (count === 2 && isSameRank(sorted)) {
        play = { type: PlayType.Pair, cards: sorted, strength: sorted[count - 1]!.rank };
    }

    // SET / BOMB
    if (count >= 3 && isSameRank(sorted)) {
        // Set
        if (count === 3) {
            play = { type: PlayType.Set, cards: sorted, strength: sorted[count - 1]!.rank };
        } // Bomb
        else if (count === 4) {
            play = { type: PlayType.Bomb, cards: sorted, strength: sorted[count - 1]!.rank + 20 };
        }
    }

    // RUNS (3 or more sequential ranks)
    // First check if the cards directly form a sequential run
    if (count >= 3) {
        const { sequential, suited } = isSequential(sorted);
        if (sequential) {
            if (suited) {
                play = { type: PlayType.SuitedRun, cards: sorted, strength: sorted[count - 1]!.rank };
            } else {
                play = { type: PlayType.Run, cards: sorted, strength: sorted[count - 1]!.rank };
            }
        } else {
            // Check if unique ranks form a sequential run
            // A valid run must have exactly one card per rank (no duplicates)
            const uniqueRanks = [...new Set(sorted.map(c => c.rank))].sort((a, b) => a - b);

            // Only valid if: unique ranks form a sequence AND card count equals unique rank count
            // This ensures no duplicate ranks in a run
            if (uniqueRanks.length >= 3 && count === uniqueRanks.length) {
                // Check if unique ranks are sequential
                let isSequentialUnique = true;
                for (let i = 1; i < uniqueRanks.length; i++) {
                    if (uniqueRanks[i] !== uniqueRanks[i - 1]! + 1) {
                        isSequentialUnique = false;
                        break;
                    }
                }

                if (isSequentialUnique) {
                    // All cards form a valid run (already one per rank)
                    const allSameSuit = sorted.every(c => c.suit === sorted[0]!.suit);

                    if (allSameSuit) {
                        play = { type: PlayType.SuitedRun, cards: sorted, strength: sorted[count - 1]!.rank };
                    } else {
                        play = { type: PlayType.Run, cards: sorted, strength: sorted[count - 1]!.rank };
                    }
                }
            }
        }
    }

    // PAIRED RUNS - check last (overrides other plays if valid, matching C#)
    if (isPairedRun(sorted)) {
        play = { type: PlayType.PairedRun, cards: sorted, strength: sorted[count - 1]!.rank };
    }

    return play;
}

export function choosePlay(
    hand: string[],
    firstTrick: boolean,
    currentTopCards: string[],
    difficulty: CPUDifficulty
): string[] {
    try {
        let chosen: Play | null = null;

        // Parse hand cards
        const handCards = hand.map(parseCard);

        // Check if hand has 3 of Spades
        const has3OfSpades = handCards.some(c => c.suit === Suit.Spades && c.rank === 3);
        if (has3OfSpades) {
            const threeSpades = handCards.find(c => c.suit === Suit.Spades && c.rank === 3);
        }

        // Get all possible plays
        const possiblePlays = getAllPossiblePlays(handCards);

        if (possiblePlays.length === 0) {
            console.warn("No possible plays found for hand!");
            return [];
        }

        // Properly identify the current top play from the cards
        let currentTopPlay: Play | null = null;
        if (currentTopCards && currentTopCards.length > 0) {
            try {
                const topCards = currentTopCards.map(parseCard);
                currentTopPlay = identifyPlay(topCards);
            } catch (error) {
                console.error("Error parsing currentTopCards:", error);
                currentTopPlay = null;
            }
        }

        // Choose play based on game state
        if (firstTrick) {
            chosen = getFirstPlay(possiblePlays);

            // Fallback: if no play found with 3 of Spades but we have plays, return first Single
            if (!chosen && possiblePlays.length > 0) {
                const singlePlay = possiblePlays.find(p => p.type === PlayType.Single);
                if (singlePlay) {
                    chosen = singlePlay;
                } else {
                    // Last resort: return first play
                    chosen = possiblePlays[0] ?? null;
                }
            }
        } else if (currentTopPlay === null) {
            chosen = getBestPlay(difficulty, possiblePlays);
        } else {
            const beatList = possiblePlays.filter(p => canMatchAndBeat(p, currentTopPlay));
            if (beatList.length !== 0) {
                // Sort by strength (lowest first) and take the first one
                chosen = beatList.sort((a, b) => a.strength - b.strength)[0] ?? null;
            }
        }

        const chosenCards = chosen?.cards.map(cardToString) ?? [];

        return chosenCards;
    } catch (error) {
        console.error("Error in choosePlay:", error);
        return [];
    }
}

// ---------------- BASIC HELPERS ---------------- //
export function isDeuce(play: Play): boolean {
    return play.cards.length === 1 && play.cards[0]!.rank === 15; // 2 == 15
}

export function isPairDeuce(play: Play): boolean {
    return play.cards.length === 2 && play.cards.every(c => c.rank === 15);
}

export function isSameRank(cards: Card[]): boolean {
    if (cards.length === 0) return false;
    const firstRank = cards[0]!.rank;
    return cards.every(c => c.rank === firstRank);
}

// Check if cards are sequential; also returns whether they are suited
export function isSequential(cards: Card[]): { sequential: boolean; suited: boolean } {
    if (cards.length < 2) return { sequential: false, suited: false };

    const firstSuit = cards[0]!.suit;
    const suited = cards.every(c => c.suit === firstSuit);
    const sorted = [...cards].sort((a, b) => a.rank - b.rank);

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.rank !== sorted[i - 1]!.rank + 1) {
            return { sequential: false, suited };
        }
    }
    return { sequential: true, suited };
}

// Check if hand forms a valid paired run
export function isPairedRun(sorted: Card[]): boolean {
    // must have ≥ 6 cards and an even number
    if (sorted.length < 6 || sorted.length % 2 !== 0) return false;

    // check each consecutive pair has same rank
    for (let i = 0; i < sorted.length; i += 2) {
        if (sorted[i]!.rank !== sorted[i + 1]!.rank) return false;
    }

    // check that pairs are consecutive
    for (let i = 2; i < sorted.length; i += 2) {
        if (sorted[i]!.rank !== sorted[i - 2]!.rank + 1) return false;
    }

    return true;
}

/**
 * Determines if a new play can legally match and beat the previous play.
 * Follows the game rules: special cases first, then type/length matching, then tiebreakers, finally strength comparison.
 * 
 * @param newPlay - The play being attempted
 * @param previousPlay - The current top play to beat (null if starting a new round)
 * @returns True if newPlay can beat previousPlay, false otherwise
 */
export function canMatchAndBeat(newPlay: Play | null, previousPlay: Play | null): boolean {
    // Null check: cannot play null
    if (!newPlay) return false;

    // New round: if no previous play, any play is valid
    if (!previousPlay) return true;

    // ============================================
    // SPECIAL CASES: These override normal rules
    // ============================================

    // Bomb (4 of a kind) beats all plays except another Bomb
    if (newPlay.type === PlayType.Bomb && previousPlay.type !== PlayType.Bomb) {
        return true;
    }

    // PairedRun can beat a single deuce (2)
    if (newPlay.type === PlayType.PairedRun && isDeuce(previousPlay)) {
        return true;
    }

    // PairedRun with more than 6 cards can beat a pair of deuces (two 2s)
    if (newPlay.type === PlayType.PairedRun && newPlay.cards.length > 6 && isPairDeuce(previousPlay)) {
        return true;
    }

    // SuitedRun beats a regular Run of the same length
    if (
        newPlay.type === PlayType.SuitedRun &&
        previousPlay.type === PlayType.Run &&
        previousPlay.cards.length === newPlay.cards.length &&
        newPlay.strength >= previousPlay.strength
    ) {
        return true;
    }

    // ============================================
    // TYPE MATCHING: Types must match to compare
    // ============================================

    // If types don't match, cannot beat (except for special cases above)
    if (newPlay.type !== previousPlay.type) {
        return false;
    }

    // From here on, types must match

    // ============================================
    // LENGTH MATCHING: For sequential plays, lengths must match
    // ============================================

    // For Runs, SuitedRuns, and PairedRuns, the number of cards must match
    if (
        (previousPlay.type === PlayType.Run || previousPlay.type === PlayType.SuitedRun || previousPlay.type === PlayType.PairedRun) &&
        previousPlay.cards.length !== newPlay.cards.length
    ) {
        return false;
    }

    // From here on, types and lengths match in Run and SuitedRun

    const newCard = newPlay.cards[0];
    const prevCard = previousPlay.cards[0];

    // ============================================
    // TIEBREAKERS: When strength is equal, use suit comparison
    // ============================================

    // Run tiebreaker: If strength is equal and last card rank > 9 (Jack, Queen, King, Ace, 2),
    // compare suits of the last cards (Spades=0 < Clubs=1 < Diamonds=2 < Hearts=3)
    if (
        newPlay.type === PlayType.Run &&
        newPlay.strength === previousPlay.strength &&
        newPlay.cards[newPlay.cards.length - 1]!.rank > 9
    ) {
        const newLastCard = newPlay.cards[newPlay.cards.length - 1]!;
        const prevLastCard = previousPlay.cards[previousPlay.cards.length - 1]!;
        return SP(newLastCard.suit) > SP(prevLastCard.suit);
    }

    // SuitedRun tiebreaker: Same as Run - compare suits of last cards when strength is equal and rank > 9
    if (
        newPlay.type === PlayType.SuitedRun &&
        newPlay.strength === previousPlay.strength &&
        newPlay.cards[newPlay.cards.length - 1]!.rank > 9
    ) {
        const newLastCard = newPlay.cards[newPlay.cards.length - 1]!;
        const prevLastCard = previousPlay.cards[previousPlay.cards.length - 1]!;
        return SP(newLastCard.suit) > SP(prevLastCard.suit);
    }

    // Single tiebreaker: If ranks are equal and above 9, compare suits
    // (For Singles, strength equals rank)
    if (newPlay.type === PlayType.Single) {
        // If ranks are equal and above 9, compare suits
        if (newCard!.rank > 9 && newPlay.strength === previousPlay.strength) {
            return SP(newCard!.suit) > SP(prevCard!.suit);
        }
    }

    // Pair tiebreaker: Compare suits of the highest suit card from each pair
    // when strength is equal and strength > 9
    if (newPlay.type === PlayType.Pair) {
        if (newPlay.strength === previousPlay.strength && newPlay.strength > 9) {
            // Get the card with highest suit priority from each pair
            const prevHigherCard = [...previousPlay.cards].sort((a, b) => SP(b.suit) - SP(a.suit))[0]!;
            const newHigherCard = [...newPlay.cards].sort((a, b) => SP(b.suit) - SP(a.suit))[0]!;
            return SP(newHigherCard.suit) > SP(prevHigherCard.suit);
        }
    }

    // ============================================
    // FINAL COMPARISON: Compare play strength
    // ============================================

    // If no tiebreaker applies, compare strength (newPlay must be >= previousPlay to beat)
    return newPlay.strength >= previousPlay.strength;
}