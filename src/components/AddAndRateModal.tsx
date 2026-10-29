import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CATEGORY,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
  SpotCategory,
} from '../types';
import { categoryOptions, entryToCandidate } from '../lib/addFlow';
import { useHistoryPage } from '../lib/useHistoryPage';
import { usePresence } from '../lib/usePresence';
import { UserCoordinates } from '../lib/geo';
import { trackEvent } from '../firebase';
import { SearchPage } from './SearchPage';
import { PlacePage } from './PlacePage';
import { RatingSheet } from './RatingSheet';

/** Matches `.animate-jelly-page-up-out` */
const SEARCH_EXIT_MS = 220;

/** The history entries this flow pushes (see `useHistoryPage`) */
const HISTORY_KEYS = ['jellySearch', 'jellyPlace', 'jellyRate'] as const;

interface AddAndRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRestaurants: RestaurantEntry[];
  defaultCategory?: SpotCategory; // The list the user is currently viewing
  myUid?: string | null;
  bookmarkedPlaceIds?: Set<string>;
  friendLists?: SharedListPayload[];
  /** Re-rank this entry (or rank a bookmark / For you pick): skips the search, straight to rating */
  reRankingEntry?: RestaurantEntry | null;
  defaultCity?: string;
  customPlacesApiKey?: string;
  linearRatingScale?: boolean;
  userLocation?: UserCoordinates | null;
  onCompleteQuestions: (
    candidate: PlaceCandidate,
    initialRating: number,
    category: SpotCategory,
    existingIdToReplace?: string
  ) => void;
  onAddBookmark?: (candidate: PlaceCandidate) => void;
  onRemoveBookmark?: (candidate: PlaceCandidate) => void;
  /** Reviews on the place page */
  renderReviews?: (placeId: string, category: SpotCategory) => React.ReactNode;
}

/**
 * The add flow: a full-screen search page (pick a group, search, where, results), a place page for
 * looking a result up, and the rating sheet (which list, then the gut feeling) on top of either.
 * Re-ranking skips straight to the rating sheet. Each layer is a browser-history entry, so the
 * phone's Back closes the top one; App closes the whole flow when rating finishes.
 */
export const AddAndRateModal: React.FC<AddAndRateModalProps> = ({
  isOpen,
  onClose,
  existingRestaurants,
  defaultCategory = DEFAULT_CATEGORY,
  myUid = null,
  bookmarkedPlaceIds,
  friendLists = [],
  reRankingEntry = null,
  defaultCity = '',
  customPlacesApiKey = '',
  linearRatingScale = false,
  userLocation = null,
  onCompleteQuestions,
  onAddBookmark,
  onRemoveBookmark,
  renderReviews,
}) => {
  const [searchOpen, showSearch, hideSearch] = useHistoryPage('jellySearch');
  const [placeOpen, showPlace, hidePlace] = useHistoryPage('jellyPlace');
  const [rateOpen, showRate, hideRate] = useHistoryPage('jellyRate');
  const [place, setPlace] = useState<{ candidate: PlaceCandidate; category: SpotCategory } | null>(null);
  // `locked`: rank in exactly this list (re-rank one of your rankings, or add one) instead of offering a choice
  const [rating, setRating] = useState<{ candidate: PlaceCandidate; category: SpotCategory; locked?: boolean } | null>(
    null
  );
  // Bumped per open so the search page starts fresh (query, group) every time
  const [session, setSession] = useState(0);

  // Opening: push the search page, or the rating sheet alone for a re-rank
  useEffect(() => {
    if (!isOpen) return;
    if (reRankingEntry) {
      setRating({ candidate: entryToCandidate(reRankingEntry), category: reRankingEntry.category });
      showRate();
    } else {
      setSession((s) => s + 1);
      showSearch();
    }
  }, [isOpen, reRankingEntry, showRate, showSearch]);

  // The bottom layer went away (✕, Back, swipe): the flow is closed
  const bottomOpen = reRankingEntry ? rateOpen : searchOpen;
  const startedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      startedRef.current = false;
      return;
    }
    if (bottomOpen) startedRef.current = true;
    else if (startedRef.current) {
      startedRef.current = false;
      onClose();
    }
  }, [isOpen, bottomOpen, onClose]);

  // Closed from outside (rating finished, saved): drop the history entries we pushed
  useEffect(() => {
    if (isOpen) return;
    const state = (window.history.state ?? {}) as Record<string, unknown>;
    const depth = HISTORY_KEYS.filter((key) => state[key]).length;
    if (depth > 0) window.history.go(-depth);
  }, [isOpen]);

  // Escape closes the top layer
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (rateOpen) hideRate();
      else if (placeOpen) hidePlace();
      else hideSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, rateOpen, placeOpen, hideRate, hidePlace, hideSearch]);

  const search = usePresence(isOpen && !reRankingEntry && searchOpen, SEARCH_EXIT_MS);

  const startRating = (candidate: PlaceCandidate, category: SpotCategory, locked = false) => {
    trackEvent('select_search_result', {
      restaurant_name: candidate.name,
      city: candidate.city || '',
      source: candidate.source,
    });
    setRating({ candidate, category, locked });
    showRate();
  };

  const openPlace = (candidate: PlaceCandidate, category: SpotCategory) => {
    trackEvent('open_place_page', { source: candidate.source, category });
    setPlace({ candidate, category: categoryOptions(candidate, category)[0] });
    showPlace();
  };

  // Bookmarks go in the candidate's best list within the searched group
  const toggleBookmark = (candidate: PlaceCandidate, category: SpotCategory) => {
    if (bookmarkedPlaceIds?.has(candidate.placeId)) onRemoveBookmark?.(candidate);
    else onAddBookmark?.({ ...candidate, categories: categoryOptions(candidate, category) });
  };

  const showRating = isOpen && rateOpen && rating;

  return (
    <>
      {search.mounted && (
        <SearchPage
          key={session}
          visible={search.visible}
          covered={placeOpen || Boolean(showRating)}
          initialCategory={defaultCategory}
          existingRestaurants={existingRestaurants}
          myUid={myUid}
          bookmarkedPlaceIds={bookmarkedPlaceIds}
          friendLists={friendLists}
          defaultCity={defaultCity}
          customPlacesApiKey={customPlacesApiKey}
          userLocation={userLocation}
          onClose={hideSearch}
          onOpenPlace={openPlace}
          onRank={startRating}
          onToggleBookmark={onAddBookmark ? toggleBookmark : undefined}
        />
      )}

      <PlacePage
        open={isOpen && placeOpen && !reRankingEntry}
        candidate={place?.candidate ?? null}
        category={place?.category ?? defaultCategory}
        myUid={myUid}
        myRestaurants={existingRestaurants}
        friendLists={friendLists}
        userLocation={userLocation}
        isBookmarked={Boolean(place && bookmarkedPlaceIds?.has(place.candidate.placeId))}
        onClose={hidePlace}
        onRank={place ? () => startRating(place.candidate, place.category) : undefined}
        onReRank={(entry) => place && startRating(place.candidate, entry.category, true)}
        onAddTo={(category) => place && startRating(place.candidate, category, true)}
        onToggleBookmark={
          place && onAddBookmark ? () => toggleBookmark(place.candidate, place.category) : undefined
        }
        renderReviews={renderReviews}
      />

      {showRating && (
        <RatingSheet
          key={`${rating.candidate.placeId}__${rating.category}`}
          candidate={rating.candidate}
          searchCategory={rating.category}
          reRankingEntry={reRankingEntry}
          lockedCategory={rating.locked ? rating.category : undefined}
          existingRestaurants={existingRestaurants}
          linearRatingScale={linearRatingScale}
          onClose={hideRate}
          onComplete={onCompleteQuestions}
          onSaveForLater={
            !reRankingEntry && onAddBookmark
              ? () => {
                  if (!bookmarkedPlaceIds?.has(rating.candidate.placeId)) {
                    toggleBookmark(rating.candidate, rating.category);
                  }
                  hideRate();
                }
              : undefined
          }
        />
      )}
    </>
  );
};
