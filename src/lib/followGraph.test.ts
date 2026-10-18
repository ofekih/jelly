import { describe, expect, it } from 'vitest';
import { buildFollowGraph, getFollowersForUser, getFollowingForUser } from './followGraph';
import { SharedListPayload } from '../types';

describe('followGraph', () => {
  const alice: SharedListPayload = {
    id: 'alice_share',
    ownerUid: 'uid_alice',
    ownerName: 'Alice',
    restaurants: [],
    followingIds: ['uid_bob', 'uid_charlie'],
    createdAt: 1000,
    updatedAt: 1000,
  };

  const bob: SharedListPayload = {
    id: 'bob_share',
    ownerUid: 'uid_bob',
    ownerName: 'Bob',
    restaurants: [],
    followingIds: ['uid_alice'],
    createdAt: 1000,
    updatedAt: 1000,
  };

  const charlie: SharedListPayload = {
    id: 'charlie_share',
    ownerUid: 'uid_charlie',
    ownerName: 'Charlie',
    restaurants: [],
    followingIds: [],
    createdAt: 1000,
    updatedAt: 1000,
  };

  const lists = [alice, bob, charlie];

  it('correctly resolves followers and following for any user', () => {
    const graph = buildFollowGraph(lists);

    // Alice follows Bob and Charlie
    const aliceFollowing = getFollowingForUser(graph, 'uid_alice');
    expect(aliceFollowing.map((u) => u.ownerUid)).toEqual(['uid_bob', 'uid_charlie']);

    // Alice is followed by Bob
    const aliceFollowers = getFollowersForUser(graph, 'uid_alice');
    expect(aliceFollowers.map((u) => u.ownerUid)).toEqual(['uid_bob']);

    // Charlie has 0 following, but 1 follower (Alice)
    expect(getFollowingForUser(graph, 'uid_charlie')).toHaveLength(0);
    expect(getFollowersForUser(graph, 'uid_charlie').map((u) => u.ownerUid)).toEqual(['uid_alice']);

    // Also works by shareId if used as targetId
    expect(getFollowersForUser(graph, 'bob_share').map((u) => u.ownerUid)).toEqual(['uid_alice']);
  });
});
