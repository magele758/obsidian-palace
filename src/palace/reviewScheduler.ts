/**
 * Review Scheduler - SM-2 spaced repetition algorithm for flashcard review.
 *
 * Based on the SuperMemo SM-2 algorithm:
 * https://en.wikipedia.org/wiki/SuperMemo#Description_of_SM-2_algorithm
 */

import type { Flashcard } from '../shared/types';

/** User quality rating: 0-5 */
export type QualityRating = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Process a review and update the flashcard's scheduling parameters.
 * Returns a new Flashcard object (immutable).
 *
 * @param card - The flashcard being reviewed
 * @param quality - Rating 0-5 (0=complete failure, 5=perfect response)
 */
export function processReview(card: Flashcard, quality: QualityRating): Flashcard {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let { interval, repetitions, easeFactor } = card;

  if (quality >= 3) {
    // Successful recall
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions++;
  } else {
    // Failed recall - reset
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const nextReview = now + interval * dayMs;

  return {
    ...card,
    interval,
    repetitions,
    easeFactor,
    nextReview,
    lastReview: now,
  };
}

/**
 * Get cards due for review
 */
export function getDueCards(cards: Flashcard[], limit = 20): Flashcard[] {
  const now = Date.now();
  return cards
    .filter(card => card.nextReview <= now)
    .sort((a, b) => a.nextReview - b.nextReview)
    .slice(0, limit);
}

/**
 * Get review statistics
 */
export function getReviewStats(cards: Flashcard[]): {
  total: number;
  due: number;
  learned: number;
  new: number;
  averageEase: number;
} {
  const now = Date.now();
  const due = cards.filter(c => c.nextReview <= now).length;
  const learned = cards.filter(c => c.repetitions >= 3).length;
  const newCards = cards.filter(c => c.repetitions === 0).length;
  const avgEase =
    cards.length > 0
      ? cards.reduce((sum, c) => sum + c.easeFactor, 0) / cards.length
      : 2.5;

  return {
    total: cards.length,
    due,
    learned,
    new: newCards,
    averageEase: Math.round(avgEase * 100) / 100,
  };
}
