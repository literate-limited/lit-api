import { computeOverallScore, scoreToStars } from '../services/deb_grader.service.js';

describe('deb_grader.service', () => {
  test('computeOverallScore clamps and returns 0-100', () => {
    const score = computeOverallScore({
      clarity_structure: { score: 5 },
      argument_strength: { score: 5 },
      evidence_examples: { score: 5 },
      rebuttal_quality: { score: 5 },
      persuasion_rhetoric: { score: 5 },
      fairness: { score: 5 },
    });
    expect(score).toBe(100);

    const score2 = computeOverallScore({
      clarity_structure: { score: -10 },
      argument_strength: { score: 999 },
    });
    expect(score2).toBeGreaterThanOrEqual(0);
    expect(score2).toBeLessThanOrEqual(100);
  });

  test('scoreToStars maps correctly', () => {
    expect(scoreToStars(95)).toBe(5);
    expect(scoreToStars(85)).toBe(4);
    expect(scoreToStars(75)).toBe(3);
    expect(scoreToStars(65)).toBe(2);
    expect(scoreToStars(10)).toBe(1);
  });
});

