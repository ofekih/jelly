import { SharedListPayload } from '../types';

export interface FollowGraph {
  /** Map from user UID or list ID -> array of users who follow them */
  followersMap: Map<string, SharedListPayload[]>;
  /** Map from user UID or list ID -> array of users they follow */
  followingMap: Map<string, SharedListPayload[]>;
  /** Quick lookup from UID or list ID -> their SharedListPayload */
  userById: Map<string, SharedListPayload>;
}

/**
 * Builds an efficient in-memory social graph from all loaded shared lists.
 * Complexity: O(N + E) where N is number of public lists and E is total follow edges.
 */
export function buildFollowGraph(lists: SharedListPayload[]): FollowGraph {
  const followersMap = new Map<string, SharedListPayload[]>();
  const followingMap = new Map<string, SharedListPayload[]>();
  const userById = new Map<string, SharedListPayload>();

  // 1. Index all users by both ownerUid and doc id
  for (const list of lists) {
    if (list.ownerUid) userById.set(list.ownerUid, list);
    if (list.id) userById.set(list.id, list);
  }

  // 2. Map following & followers edges
  for (const list of lists) {
    const fromUid = list.ownerUid || list.id;
    if (!fromUid) continue;

    const followingPayloads: SharedListPayload[] = [];
    const followingIds = Array.isArray(list.followingIds) ? list.followingIds : [];

    for (const targetId of followingIds) {
      if (!targetId || targetId === fromUid) continue;

      const targetPayload = userById.get(targetId);
      if (targetPayload) {
        if (!followingPayloads.some((p) => (p.ownerUid || p.id) === (targetPayload.ownerUid || targetPayload.id))) {
          followingPayloads.push(targetPayload);
        }

        // Add `list` to target's followers list (indexed by all known identifiers)
        const targetKeys = Array.from(
          new Set([targetId, targetPayload.ownerUid, targetPayload.id].filter(Boolean))
        ) as string[];
        for (const k of targetKeys) {
          const existing = followersMap.get(k) || [];
          if (!existing.some((p) => (p.ownerUid || p.id) === fromUid)) {
            existing.push(list);
            followersMap.set(k, existing);
          }
        }
      } else {
        const existingFollowers = followersMap.get(targetId) || [];
        if (!existingFollowers.some((p) => (p.ownerUid || p.id) === fromUid)) {
          existingFollowers.push(list);
          followersMap.set(targetId, existingFollowers);
        }
      }
    }

    followingMap.set(fromUid, followingPayloads);
    if (list.id && list.id !== fromUid) {
      followingMap.set(list.id, followingPayloads);
    }
  }

  return { followersMap, followingMap, userById };
}

/**
 * Helper to retrieve followers for a specific user UID / shareId
 */
export function getFollowersForUser(graph: FollowGraph, uidOrId?: string | null): SharedListPayload[] {
  if (!uidOrId) return [];
  return graph.followersMap.get(uidOrId) || [];
}

/**
 * Helper to retrieve users followed by a specific user UID / shareId
 */
export function getFollowingForUser(graph: FollowGraph, uidOrId?: string | null): SharedListPayload[] {
  if (!uidOrId) return [];
  return graph.followingMap.get(uidOrId) || [];
}
