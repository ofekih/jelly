import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import {
  fetchFollowCounts,
  fetchFollowerUids,
  fetchProfiles,
  FollowCounts as Counts,
} from '../lib/socialService';
import { SharedListPayload } from '../types';

interface FollowCountsProps {
  uid: string;
  followersTitle: string;
  followingTitle: string;
  onOpenFollowList?: (title: string, users: SharedListPayload[]) => void;
  /** Re-read the counts when this changes (e.g. after following someone) */
  refreshKey?: unknown;
  buttonClassName?: string;
  numberClassName?: string;
}

/** "N followers · N following" for anyone; tapping either opens the list of people. */
export const FollowCounts: React.FC<FollowCountsProps> = ({
  uid,
  followersTitle,
  followingTitle,
  onOpenFollowList,
  refreshKey,
  buttonClassName = '',
  numberClassName = '',
}) => {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFollowCounts(db, uid, refreshKey !== undefined)
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, refreshKey]);

  const open = async (title: string, loadUids: () => Promise<string[]>) => {
    if (!onOpenFollowList) return;
    try {
      onOpenFollowList(title, await fetchProfiles(db, await loadUids()));
    } catch {
      onOpenFollowList(title, []);
    }
  };

  const number = (n: number | undefined) => (
    <span className={numberClassName}>{n === undefined ? '–' : n}</span>
  );

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open(followersTitle, () => fetchFollowerUids(db, uid));
        }}
        className={buttonClassName}
      >
        {number(counts?.followers)} followers
      </button>
      <span>·</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open(followingTitle, async () => (await fetchFollowCounts(db, uid)).followingIds);
        }}
        className={buttonClassName}
      >
        {number(counts?.following)} following
      </button>
    </>
  );
};
