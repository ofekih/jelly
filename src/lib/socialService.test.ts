import { describe, expect, it } from 'vitest';
import { buildProfileDoc, nameSearchKey, placeStatKey, prefixEnd, profileToPayload } from './socialService';

describe('buildProfileDoc', () => {
  it('matches what isValidProfile accepts: sanitized handle, lowercase copies, no empty fields', () => {
    const profile = buildProfileDoc({
      handle: '@Ofek.Gila!',
      displayName: '  Ofek Gila ',
      photoURL: null,
      followingIds: ['a', 'b', 'a', ''],
      rankedCount: 12.7,
    });
    expect(profile).toEqual({
      handle: 'ofek.gila',
      handleLower: 'ofek.gila',
      displayName: 'Ofek Gila',
      nameLower: 'ofek gila',
      followingIds: ['a', 'b'],
      rankedCount: 12,
    });
    expect('photoURL' in profile).toBe(false);
  });

  it('keys names for accent- and case-insensitive search', () => {
    expect(buildProfileDoc({ displayName: 'Zoë ÅLVAREZ', followingIds: [], rankedCount: 0 }).nameLower).toBe(
      'zoe alvarez'
    );
    expect(nameSearchKey(' Émile Ünal ')).toBe('emile unal');
    expect(nameSearchKey('李 小龍')).toBe('李 小龍');
  });

  it('omits handle and name when there are none', () => {
    const profile = buildProfileDoc({ handle: '!!!', displayName: '', followingIds: [], rankedCount: 0 });
    expect(profile).toEqual({ followingIds: [], rankedCount: 0 });
  });
});

describe('profileToPayload', () => {
  it('becomes a spot-less list payload marked profile-only', () => {
    const payload = profileToPayload('uid1', {
      displayName: 'Maya Cohen',
      handle: 'maya',
      followingIds: ['x', 3],
      rankedCount: 40,
    });
    expect(payload).toMatchObject({
      id: 'uid1',
      ownerUid: 'uid1',
      ownerName: 'Maya',
      displayName: 'Maya Cohen',
      handle: 'maya',
      followingIds: ['x'],
      rankedCount: 40,
      profileOnly: true,
      restaurants: [],
    });
  });
});

describe('placeStatKey', () => {
  it('keys Google places per list and skips per-user manual spots', () => {
    expect(placeStatKey('ChIJabc', 'dessert')).toBe('ChIJabc__dessert');
    expect(placeStatKey('manual_123', 'dessert')).toBeNull();
    expect(placeStatKey(undefined, 'dessert')).toBeNull();
    expect(placeStatKey('ChIJabc', undefined)).toBeNull();
  });
});

describe('prefixEnd', () => {
  it('bounds a prefix range so only strings starting with it fall inside', () => {
    const end = prefixEnd('ma');
    expect('maya' < end && 'maya' >= 'ma').toBe(true);
    expect('mb' < end).toBe(false);
  });
});
