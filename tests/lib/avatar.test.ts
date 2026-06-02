import { describe, it, expect } from 'vitest';
import { generateTokenAvatar } from '../../src/lib/avatar';

describe('Token Avatar Generation (README: Utilities)', () => {
  it('generates SVG with first letter of symbol', () => {
    const svg = generateTokenAvatar('COTI');
    expect(svg).toContain('<svg');
    expect(svg).toContain('>C</text>');
  });

  it('uppercases the first letter', () => {
    const svg = generateTokenAvatar('weth');
    expect(svg).toContain('>W</text>');
  });

  it('generates valid SVG dimensions', () => {
    const svg = generateTokenAvatar('USDT');
    expect(svg).toContain('width="32"');
    expect(svg).toContain('height="32"');
  });

  it('uses gray background', () => {
    const svg = generateTokenAvatar('BTC');
    expect(svg).toContain('fill="#CCCCCC"');
  });

  it('handles single character symbol', () => {
    const svg = generateTokenAvatar('X');
    expect(svg).toContain('>X</text>');
  });

  it('handles empty string (takes first char which is empty)', () => {
    const svg = generateTokenAvatar('');
    expect(svg).toContain('<svg');
    expect(svg).toContain('></text>');
  });
});
