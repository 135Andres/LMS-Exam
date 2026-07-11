import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findTopK } from './vector.js';

describe('cosineSimilarity', () => {
  it('identical vectors → 1.0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it('orthogonal → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('opposite → -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('different dimensions → 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('zero vector → 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('findTopK', () => {
  const items = [
    { vector: [1, 0], content: 'a' },
    { vector: [0.9, 0.1], content: 'b' },
    { vector: [0, 1], content: 'c' },
  ];

  it('returns top K sorted by score descending', () => {
    const r = findTopK([1, 0], items, 2, 0);
    expect(r[0].content).toBe('a');
    expect(r[1].content).toBe('b');
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it('filters by minScore threshold', () => {
    const r = findTopK([1, 0], items, 5, 0.5);
    expect(r).toHaveLength(2);
    expect(r[0].content).toBe('a');
    expect(r[1].content).toBe('b');
  });

  it('returns empty if nothing passes threshold', () => {
    const r = findTopK([0.5, 0.5], items, 5, 0.99);
    expect(r).toHaveLength(0);
  });

  it('returns empty for empty items', () => {
    expect(findTopK([1, 0], [], 3, 0.5)).toHaveLength(0);
  });

  it('preserves role if present', () => {
    const withRole = [
      { vector: [1, 0], content: 'a', role: 'user' },
      { vector: [0.9, 0.1], content: 'b', role: 'assistant' },
    ];
    const r = findTopK([1, 0], withRole, 2, 0);
    expect(r[0].role).toBe('user');
    expect(r[1].role).toBe('assistant');
  });
});
