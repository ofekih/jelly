import { describe, expect, it } from 'vitest';
import { isSharePath, parseShareUrl, shareIdFromText, shareListUrl } from './shareLinks';

describe('share links', () => {
  it('builds /l/ links that parse back', () => {
    const link = shareListUrl('https://eatwithjelly.com', 'abc_123', 'coffee_tea');
    expect(link).toBe('https://eatwithjelly.com/l/abc_123?c=coffee_tea');
    expect(parseShareUrl(new URL(link))).toEqual({ shareId: 'abc_123', category: 'coffee_tea' });
  });

  it('still opens the older ?list= links', () => {
    expect(parseShareUrl(new URL('https://eatwithjelly.com/?list=abc'))).toEqual({ shareId: 'abc' });
  });

  it('ignores unknown categories and malformed ids', () => {
    expect(parseShareUrl(new URL('https://x.com/l/abc?c=nope'))).toEqual({ shareId: 'abc' });
    expect(parseShareUrl(new URL('https://x.com/l/a.b'))).toBeNull();
    expect(parseShareUrl(new URL('https://x.com/l/abc/card.png'))).toBeNull();
    expect(parseShareUrl(new URL('https://x.com/'))).toBeNull();
  });

  it('reads pasted links in any form', () => {
    expect(shareIdFromText(' https://eatwithjelly.com/l/abc?c=movies ')).toBe('abc');
    expect(shareIdFromText('eatwithjelly.com/l/abc')).toBe('abc');
    expect(shareIdFromText('eatwithjelly.com/?list=abc')).toBe('abc');
    expect(shareIdFromText('/?list=abc')).toBe('abc');
    expect(shareIdFromText('ofek')).toBeNull();
  });

  it('knows share paths', () => {
    expect(isSharePath('/l/abc')).toBe(true);
    expect(isSharePath('/')).toBe(false);
  });
});
