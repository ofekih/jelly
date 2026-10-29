import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { moveTargetsFor, rankingsInGroup } from './lib/addFlow';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  WriteBatch,
} from 'firebase/firestore';
import {
  ArrowUpDown,
  Bookmark,
  List,
  Map as MapIcon,
  MapPin,
  Navigation,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { BottomNav } from './components/BottomNav';
import { ProfilePage } from './components/ProfilePage';
import { SharedListBanner } from './components/SharedListBanner';
import { scrollToTop } from './lib/useScrollChrome';
import { useHistoryPage } from './lib/useHistoryPage';
import { primeKeyboard } from './lib/keyboardPrime';
import { auth, db, googleProvider, setAnalyticsUser, trackEvent } from './firebase';
import {
  ALL_CATEGORIES,
  BookmarkEntry,
  CATEGORY_EMOJI,
  CATEGORY_GROUP,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  FriendProfile,
  GROUP_CATEGORIES,
  GROUP_LABEL,
  isSpotCategory,
  SpotCategory,
  SpotGroup,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
} from './types';
import {
  changedDocs,
  commitInBatches,
  logWriteError,
  onWriteError,
  stripUndefined,
} from './lib/firestoreDoc';
import { readLocalSettings, updateLocalSettings } from './lib/localSettings';
import { shouldAutoOpenTour } from './lib/onboarding';
import { CURRENT_VERSION, hasUnseenRelease } from './lib/changelog';
import { GROUP_COPY, wantLabel } from './lib/groups';
import {
  buildEntryId,
  getCategoryList,
  loadBookmarks,
  loadRestaurants,
  recomputeAllCategoryScores,
  replaceCategoryList,
} from './lib/categoryLists';
import {
  applyCheckAnswer,
  CheckOutcome,
  countSpotsToCheck,
  findOrderConflicts,
  OrderConflict,
  PROMPT_MARGIN,
} from './lib/comparisonHistory';
import {
  deriveDefaultHandle,
  getFriendMatchesForSpot,
  getSpotSocialMetrics,
  sanitizeHandle,
} from './lib/friendsService';
import { isMediaPlaceId, isSameSpot } from './lib/tasteModel';
import { hasPriceFilter, isFilterActive, matchesSpotFilters, sortByDistance, SpotFilters } from './lib/spotFilters';
import { usePrices } from './lib/usePrices';
import { GameNightSelect, MINUTE_OPTIONS, PLAYER_OPTIONS, PRICE_OPTIONS } from './components/GameNightSelect';
import { BookmarkList } from './components/BookmarkList';
import { ForYouList } from './components/ForYouList';
import { ConfirmModal } from './components/ConfirmModal';
import {
  existingEntryFor,
  FIRST_IN_LIST,
  PendingPlacement,
  placementPool,
  PlacementResult,
  placeSpot,
  reorderSpot,
  restoreSpot,
  undoReorder,
} from './lib/rankingActions';
import { RestaurantList } from './components/RestaurantList';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner';
import { Toast, useToast } from './components/Toast';
import { lazyNamed, MountWhenOpened, preloadWhenIdle } from './components/Deferred';
import { useUserLocation } from './lib/useUserLocation';
import { subscribeAccountLists } from './lib/sync/accountLists';
import { reconcileFollowEdges, saveFollowChange } from './lib/sync/follows';
import { mergeCloudFriends, subscribeUserDoc } from './lib/sync/userDoc';
import { publishPublicDocs } from './lib/sync/publish';
import {
  clearAccountCache,
  isForeignCache,
  LEGACY_LOCAL_STORAGE_KEY,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_FRIENDS_KEY,
  LOCAL_SEEN_FOLLOWERS_KEY,
  LOCAL_STORAGE_KEY,
  readCacheOwner,
  readStoredArray,
  writeStoredArray,
} from './lib/sync/localCache';
import {
  parseSharedListDoc,
  placeStatKey,
  searchProfiles,
} from './lib/socialService';
import { refreshPlaceStatsSoon, usePlaceStats } from './lib/usePlaceStats';
import { usePredictionMap, usePredictions, watchPredictions } from './lib/usePredictions';
import { buildForYouSpots, ForYouSpot } from './lib/predictions';
import { usePriceBackfill } from './lib/usePriceBackfill';
import { PublicListTrim } from './lib/publicList';
import { useFollowers, useFriendListSubscriptions } from './lib/useSocialFeeds';
import { isSharePath, parseShareUrl, shareIdFromText, shareListUrl } from './lib/shareLinks';
import { displayPhotoURL, removeProfilePhoto, saveProfilePhoto } from './lib/profilePhoto';
import {
  deleteMyReview,
  fetchMyReview,
  getCachedReviews,
  PlaceReview,
  reviewKey,
  reviewKeyForEntry,
  saveMyReview,
  setCachedMyReview,
} from './lib/reviews';

const PUBLIC_TRIM_MESSAGE: Record<Exclude<PublicListTrim, 'none'>, string> = {
  bookmarkNotes: 'Your list is too big to share in full – friends won’t see your bookmark notes',
  notes: 'Your list is too big to share in full – friends won’t see your notes',
  bookmarks: 'Your list is too big to share in full – friends won’t see your notes or bookmarks',
  spots: 'Your list is too big to share in full – friends only see your top spots',
};

const NO_BOOKMARKS: BookmarkEntry[] = [];

// Screens that aren't needed for the first paint load in their own chunks (see Deferred.tsx)
const RestaurantMapView = lazyNamed(() => import('./components/RestaurantMapView'), 'RestaurantMapView');
const AddAndRateModal = lazyNamed(() => import('./components/AddAndRateModal'), 'AddAndRateModal');
const OrderCheckModal = lazyNamed(() => import('./components/OrderCheckModal'), 'OrderCheckModal');
const SxSArenaModal = lazyNamed(() => import('./components/SxSArenaModal'), 'SxSArenaModal');
const SpotDetailModal = lazyNamed(() => import('./components/SpotDetailModal'), 'SpotDetailModal');
const FriendsModal = lazyNamed(() => import('./components/FriendsModal'), 'FriendsModal');
const EatTogetherModal = lazyNamed(() => import('./components/EatTogetherModal'), 'EatTogetherModal');
const ShareModal = lazyNamed(() => import('./components/ShareModal'), 'ShareModal');
const WhatsNewModal = lazyNamed(() => import('./components/WhatsNewModal'), 'WhatsNewModal');
const SettingsModal = lazyNamed(() => import('./components/SettingsModal'), 'SettingsModal');
const FollowListModal = lazyNamed(() => import('./components/FollowListModal'), 'FollowListModal');
// Only new users (or a replay) ever need the welcome tour, so it isn't preloaded
const OnboardingTour = lazyNamed(() => import('./components/onboarding/OnboardingTour'), 'OnboardingTour');
const FeedbackModal = lazyNamed(() => import('./components/FeedbackModal'), 'FeedbackModal');
const ReviewPromptSheet = lazyNamed(() => import('./components/ReviewPromptSheet'), 'ReviewPromptSheet');
const PlaceReviews = lazyNamed(() => import('./components/PlaceReviews'), 'PlaceReviews');
const DEFERRED_SCREENS = [RestaurantMapView, AddAndRateModal, OrderCheckModal, SxSArenaModal, SpotDetailModal, FriendsModal, EatTogetherModal, ShareModal, WhatsNewModal, SettingsModal, FollowListModal, FeedbackModal, ReviewPromptSheet, PlaceReviews];

/** A local copy that fails to load (corrupt or hand-edited) starts the list empty instead of crashing. */
function loadStored<T>(load: () => T[]): T[] {
  try {
    return load();
  } catch {
    return [];
  }
}


export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const cloudLoadedRef = useRef(false);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const { darkMode: saved } = readLocalSettings();
    if (typeof saved === 'boolean') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    // Browser and status-bar chrome follow the app's theme, not just the system's
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = darkMode ? '#09090b' : '#fafafa';
    }
  }, [darkMode]);

  const [restaurants, setRestaurants] = useState<RestaurantEntry[]>(() =>
    loadStored(() =>
      loadRestaurants(readStoredArray(LOCAL_STORAGE_KEY) ?? readStoredArray(LEGACY_LOCAL_STORAGE_KEY) ?? [])
    )
  );
  // Latest list for diffing writes; callbacks like toast Undo would otherwise see a stale closure
  const restaurantsRef = useRef(restaurants);
  restaurantsRef.current = restaurants;

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() =>
    loadStored(() =>
      loadBookmarks(readStoredArray(LOCAL_BOOKMARKS_KEY) ?? []).sort((a, b) => b.createdAt - a.createdAt)
    )
  );

  // Friends State (localStorage + Firestore sync)
  const [friends, setFriends] = useState<FriendProfile[]>(
    () => (readStoredArray(LOCAL_FRIENDS_KEY) as FriendProfile[] | null) ?? []
  );

  const [seenFollowerIds, setSeenFollowerIds] = useState<Set<string>>(
    () => new Set((readStoredArray(LOCAL_SEEN_FOLLOWERS_KEY) ?? []).filter((x): x is string => typeof x === 'string'))
  );
  const notifiedFollowersRef = useRef<Set<string>>(new Set());

  const [userHandle, setUserHandle] = useState<string>(() => readLocalSettings().handle || '');
  // Uploaded profile picture from users/{uid}; `myPhotoURL` is what everyone sees
  const [customPhotoURL, setCustomPhotoURL] = useState<string | null>(null);
  const myPhotoURL = displayPhotoURL(user, customPhotoURL);

  const [friendListsMap, setFriendListsMap] = useState<Record<string, SharedListPayload>>({});

  // Shared List Read-Only Mode (/l/<shareId>, older ?list=<shareId>, or Friend Switcher)
  const [sharedList, setSharedList] = useState<SharedListPayload | null>(null);
  const [sharedListLoading, setSharedListLoading] = useState<boolean>(() =>
    Boolean(parseShareUrl(new URL(window.location.href)))
  );

  const [defaultCity, setDefaultCity] = useState<string>(() => readLocalSettings().defaultCity || '');

  const [linearRatingScale, setLinearRatingScale] = useState<boolean>(() =>
    Boolean(readLocalSettings().linearRatingScale)
  );

  const [useCurrentLocation, setUseCurrentLocation] = useState<boolean>(() => {
    const { useCurrentLocation: saved } = readLocalSettings();
    return typeof saved === 'boolean' ? saved : true;
  });

  // View & Filter State
  const [activeTab, setActiveTab] = useState<'ranked' | 'want_to_try' | 'for_you'>('ranked');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  // Each category is a fully separate list; exactly one is shown at a time (its group's lists are the tabs)
  const [selectedCategory, setSelectedCategory] = useState<SpotCategory>(() => {
    const sharedCategory = parseShareUrl(new URL(window.location.href))?.category;
    if (sharedCategory) return sharedCategory;
    const { lastCategory } = readLocalSettings();
    return isSpotCategory(lastCategory) ? lastCategory : DEFAULT_CATEGORY;
  });
  const selectedGroup = CATEGORY_GROUP[selectedCategory];
  const groupCopy = GROUP_COPY[selectedGroup];
  // Last list viewed in each group, so switching groups returns to it
  const lastCategoryByGroupRef = useRef<Partial<Record<SpotGroup, SpotCategory>>>({});

  useEffect(() => {
    lastCategoryByGroupRef.current[selectedGroup] = selectedCategory;
    updateLocalSettings({ lastCategory: selectedCategory });
    // Drives the per-group accent color (see index.css)
    document.documentElement.dataset.group = selectedGroup;
  }, [selectedCategory, selectedGroup]);

  const selectGroup = (group: SpotGroup) => {
    if (group === selectedGroup) return;
    setSelectedCategory(lastCategoryByGroupRef.current[group] ?? GROUP_CATEGORIES[group][0]);
    setSelectedCuisine('ALL');
    setSelectedCity('ALL');
    trackEvent('select_group', { group });
  };
  const [selectedCity, setSelectedCity] = useState<string | 'ALL'>('ALL');
  const [selectedCuisine, setSelectedCuisine] = useState<string | 'ALL'>('ALL');
  // Board games only: who's playing and how long you have
  const [selectedPlayers, setSelectedPlayers] = useState<number | 'ALL'>('ALL');
  const [maxMinutes, setMaxMinutes] = useState<number | 'ALL'>('ALL');
  const [maxPrice, setMaxPrice] = useState<number | 'ALL'>('ALL');
  const [sortByNearestSetting, setSortByNearest] = useState<boolean>(false);
  // Movies and shows have no location to sort by
  const sortByNearest = sortByNearestSetting && groupCopy.hasLocation;

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [reRankingEntry, setReRankingEntry] = useState<RestaurantEntry | null>(null);
  const [rankingBookmark, setRankingBookmark] = useState<BookmarkEntry | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [isSxSOpen, setIsSxSOpen] = useState(false);
  const [isOrderCheckOpen, setIsOrderCheckOpen] = useState(false);
  const [orderCheckSnoozed, setOrderCheckSnoozed] = useState<Set<SpotCategory>>(new Set());
  const [activeDetailSpot, setActiveDetailSpot] = useState<RestaurantEntry | null>(null);
  const [detailStartsMoving, setDetailStartsMoving] = useState(false);
  // The optional public review step after a side-by-side (signed in only)
  const [reviewPrompt, setReviewPrompt] = useState<{
    entry: RestaurantEntry;
    position: number;
    rankedMessage: string;
    /** Your earlier review (undefined while loading, null when there's none); `here` is false for
     * one carried over as a draft from the list the spot was re-ranked out of */
    existing: { text: string; createdAt: number; here: boolean } | null | undefined;
  } | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [isEatTogetherOpen, setIsEatTogetherOpen] = useState(false);
  const [eatTogetherFriendUid, setEatTogetherFriendUid] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
  // Feedback sheet; also opened by `/?feedback=1` (linked from the About page)
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(() => new URL(window.location.href).searchParams.has('feedback'));
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('feedback')) return;
    url.searchParams.delete('feedback');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);
  const openFeedback = () => {
    trackEvent('open_feedback');
    setIsFeedbackOpen(true);
  };
  // Welcome tour: opens once for brand-new users; `openTour` replays it (Settings, profile)
  const [isTourOpen, setIsTourOpen] = useState(false);
  const openTour = () => setIsTourOpen(true);
  // Dot on Settings after a new major/minor release; brand-new visitors start caught up.
  const [hasUnseenChangelog, setHasUnseenChangelog] = useState(() => {
    const settings = readLocalSettings();
    if (!settings.lastSeenVersion && Object.keys(settings).length === 0) {
      updateLocalSettings({ lastSeenVersion: CURRENT_VERSION });
      return false;
    }
    return hasUnseenRelease(settings.lastSeenVersion);
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    iconVariant?: 'danger' | 'logout';
    onConfirm: () => void;
  } | null>(null);
  const [followListDialog, setFollowListDialog] = useState<{
    isOpen: boolean;
    title: string;
    users: SharedListPayload[];
  }>({ isOpen: false, title: '', users: [] });
  const { toast, showToast } = useToast();
  // The profile page lives in the browser history, so Back (or Android's back button) closes it
  const [isProfileOpen, openProfile, closeProfile] = useHistoryPage('jellyProfile');

  useEffect(() => preloadWhenIdle(DEFERRED_SCREENS), []);

  // A rejected save (usually an outdated app hitting newer rules) would otherwise only reach the
  // console and quietly undo itself on the next load
  const lastWriteErrorAtRef = useRef(0);
  useEffect(
    () =>
      onWriteError(() => {
        const now = Date.now();
        if (now - lastWriteErrorAtRef.current < 10_000) return;
        lastWriteErrorAtRef.current = now;
        showToast('Couldn’t save your last change – reload jelly and try again', {
          action: { label: 'Reload', onClick: () => window.location.reload() },
          durationMs: 8000,
          kind: 'error',
        });
      }),
    [showToast]
  );

  const { userLocation, requestUserLocation } = useUserLocation(showToast);

  // Automatically request location access on initial load
  useEffect(() => {
    requestUserLocation({ silent: true });
  }, [requestUserLocation]);

  // Open a shared list from the URL (/l/<shareId> or ?list=<shareId>)
  useEffect(() => {
    const shareId = parseShareUrl(new URL(window.location.href))?.shareId;
    if (!shareId) {
      setSharedListLoading(false);
      return;
    }

    let cancelled = false;
    setSharedListLoading(true);
    getDoc(doc(db, 'sharedLists', shareId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const parsed = parseSharedListDoc(snap.id, snap.data());
          setSharedList(parsed);
          setFriendListsMap((prev) => ({
            ...prev,
            [parsed.ownerUid || parsed.id]: parsed,
          }));
          trackEvent('view_shared_list', { share_id: shareId });
        } else {
          showToast('Shared list not found');
        }
      })
      .catch(() => {
        if (!cancelled) showToast('Could not load shared list');
      })
      .finally(() => {
        if (!cancelled) setSharedListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const exitSharedListView = () => {
    const url = new URL(window.location.href);
    if (isSharePath(url.pathname) || url.searchParams.has('list')) {
      url.pathname = '/';
      url.searchParams.delete('list');
      url.searchParams.delete('c');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    setSharedList(null);
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      trackEvent('toggle_dark_mode', { dark_mode: next });
      updateLocalSettings({ darkMode: next });
      if (user) {
        setDoc(
          doc(db, 'users', user.uid),
          { darkMode: next, updatedAt: Date.now() },
          { merge: true }
        ).catch(logWriteError('dark mode'));
      }
      return next;
    });
  };

  const resetAccountState = () => {
    clearAccountCache();
    restaurantsRef.current = [];
    setRestaurants([]);
    setBookmarks([]);
    setFriends([]);
    setSeenFollowerIds(new Set());
    notifiedFollowersRef.current = new Set();
    setFriendListsMap({});
    setUserHandle('');
    setCustomPhotoURL(null);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      cloudLoadedRef.current = false;
      lastProfileJsonRef.current = '';
      // Signed out (here or in another tab) or a different account: drop the previous account's
      // local copies so they are neither shown nor uploaded into this account
      if (isForeignCache(readCacheOwner(), u?.uid ?? null)) resetAccountState();
      setUser(u);
      setAnalyticsUser(u?.uid ?? null);
      setAuthLoading(false);
      if (u) {
        setUserHandle((prev) => prev || deriveDefaultHandle(u.displayName, u.email));
      }
    });
    return () => unsub();
  }, []);

  // Taste predictions from every jelly user, kept by a Cloud Function (owner-read only)
  useEffect(() => watchPredictions(user?.uid), [user?.uid]);

  // Your private settings and follows from users/{uid}
  useEffect(() => {
    if (!user) return;
    return subscribeUserDoc({
      db,
      uid: user.uid,
      onDoc: (cloud, keepLocalFriends) => {
        if (cloud.defaultCity !== undefined) setDefaultCity(cloud.defaultCity);
        if (cloud.linearRatingScale !== undefined) setLinearRatingScale(cloud.linearRatingScale);
        setUseCurrentLocation(cloud.useCurrentLocation);
        if (cloud.handle) setUserHandle(cloud.handle);
        setCustomPhotoURL(cloud.customPhotoURL ?? null);
        if (cloud.seenFollowerIds) {
          const seen = cloud.seenFollowerIds;
          setSeenFollowerIds((prev) => {
            const next = new Set([...prev, ...seen]);
            writeStoredArray(LOCAL_SEEN_FOLLOWERS_KEY, Array.from(next));
            return next;
          });
        }
        if (cloud.friends) {
          const cloudFriends = cloud.friends;
          setFriends((prev) => {
            const next = mergeCloudFriends(prev, cloudFriends, keepLocalFriends);
            writeStoredArray(LOCAL_FRIENDS_KEY, next);
            return next;
          });
        }
      },
    });
  }, [user]);

  const markFollowersSeen = (followerUids: string[]) => {
    if (followerUids.length === 0) return;
    setSeenFollowerIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const uid of followerUids) {
        if (!next.has(uid)) {
          next.add(uid);
          changed = true;
        }
      }
      if (!changed) return prev;
      const arr = Array.from(next);
      writeStoredArray(LOCAL_SEEN_FOLLOWERS_KEY, arr);
      if (user) {
        setDoc(
          doc(db, 'users', user.uid),
          { seenFollowerIds: arr, updatedAt: Date.now() },
          { merge: true }
        ).catch(logWriteError('seen followers'));
      }
      return next;
    });
  };

  useFriendListSubscriptions(friends, setFriendListsMap);
  const followers = useFollowers(user?.uid);

  // Follows made before follower edges existed (or on an older app version) get their edge once
  useEffect(() => {
    if (!user || friends.length === 0) return;
    reconcileFollowEdges(
      db,
      user.uid,
      friends.map((f) => f.uid)
    ).catch(logWriteError('follower edges'));
  }, [user, friends]);

  // Brand-new users get the welcome tour once auth (and a signed-in account's lists) settle. The
  // short wait lets a cached-empty snapshot be replaced by the server's before deciding.
  useEffect(() => {
    if (isTourOpen) return;
    const eligible = () =>
      shouldAutoOpenTour({
        authSettled: !authLoading,
        signedIn: Boolean(user),
        listsLoaded: cloudLoadedRef.current,
        viewingSharedList: Boolean(sharedList) || sharedListLoading,
        rankedCount: restaurants.length,
        bookmarkCount: bookmarks.length,
        seen: Boolean(readLocalSettings().onboardingSeen),
      });
    if (!eligible()) return;
    const timer = setTimeout(() => {
      if (!eligible()) return;
      updateLocalSettings({ onboardingSeen: true });
      setIsTourOpen(true);
    }, user ? 1500 : 500);
    return () => clearTimeout(timer);
  }, [authLoading, user, sharedList, sharedListLoading, restaurants, bookmarks, isTourOpen]);

  // Your lists, kept in step with the cloud and the device's local copy (src/lib/sync)
  useEffect(() => {
    if (!user) return;
    return subscribeAccountLists({
      db,
      uid: user.uid,
      onRestaurants: (items) => {
        cloudLoadedRef.current = true;
        restaurantsRef.current = items;
        setRestaurants(items);
      },
      onBookmarks: setBookmarks,
    });
  }, [user]);

  // Public docs friends read: sharedLists/{uid} (the list behind your link) and profiles/{uid}
  // (search, follower lists). The profile is only rewritten when it changes.
  const lastProfileJsonRef = useRef('');
  const trimWarnedRef = useRef(false);
  const publishMyPublicDocs = async (overrideHandle?: string) => {
    if (!user) return null;
    const { lists, profileJson } = await publishPublicDocs(
      db,
      {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: myPhotoURL,
        handle: overrideHandle || userHandle,
        restaurants,
        bookmarks,
        friends,
      },
      lastProfileJsonRef.current
    );
    lastProfileJsonRef.current = profileJson;
    if (lists.trimmed !== 'none' && !trimWarnedRef.current) {
      trimWarnedRef.current = true;
      showToast(PUBLIC_TRIM_MESSAGE[lists.trimmed], undefined, 6000);
    }
    return lists;
  };

  useEffect(() => {
    if (!user || !cloudLoadedRef.current) return;
    if (restaurants.length === 0 && bookmarks.length === 0 && friends.length === 0) return;

    const timer = setTimeout(() => {
      publishMyPublicDocs().catch(logWriteError('shared list sync'));
    }, 900);

    return () => clearTimeout(timer);
    // Republish only when the published data changes, not on every render's new function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, restaurants, bookmarks, userHandle, friends, myPhotoURL]);

  // `ordered` may contain every category; each category list is re-scored independently
  // Only docs whose contents changed (plus `deletedId`) are written to Firestore
  const persistOrderedRestaurants = async (ordered: RestaurantEntry[], deletedId?: string) => {
    const recomputed = recomputeAllCategoryScores(ordered);
    const changed = changedDocs(recomputed, restaurantsRef.current);
    const deleted = deletedId ? restaurantsRef.current.find((r) => r.id === deletedId) : undefined;
    restaurantsRef.current = recomputed;
    setRestaurants(recomputed);
    writeStoredArray(LOCAL_STORAGE_KEY, recomputed);

    if (user) {
      try {
        const colPath = ['users', user.uid, 'restaurants'] as const;
        await commitInBatches(db, [
          ...(deletedId ? [(b: WriteBatch) => b.delete(doc(db, ...colPath, deletedId))] : []),
          ...changed.map((item) => (b: WriteBatch) =>
            b.set(doc(db, ...colPath, item.id), stripUndefined(item))
          ),
        ]);
        // Community averages for these spots now include the new scores
        refreshPlaceStatsSoon(
          [...changed, ...(deleted ? [deleted] : [])]
            .map((r) => placeStatKey(r.placeId, r.category))
            .filter((k): k is string => Boolean(k))
        );
      } catch (err) {
        logWriteError('save list')(err);
      }
    }
  };

  const handleAddBookmark = async (
    candidate: PlaceCandidate,
    recommendedBy?: { name: string; uid?: string }
  ) => {
    const primaryCategory: SpotCategory = candidate.categories?.[0] || DEFAULT_CATEGORY;
    const bookmarkId = candidate.placeId || `bm_${Date.now()}`;
    const now = Date.now();

    const newBookmark: BookmarkEntry = {
      id: bookmarkId,
      placeId: candidate.placeId,
      name: candidate.name,
      formattedAddress: candidate.formattedAddress,
      neighborhood: candidate.neighborhood,
      city: candidate.city,
      lat: candidate.lat,
      lng: candidate.lng,
      googleMapsUri: candidate.googleMapsUri,
      priceLevel: candidate.priceLevel,
      priceRange: candidate.priceRange,
      category: primaryCategory,
      categories: candidate.categories?.length ? candidate.categories : [primaryCategory],
      cuisines: candidate.cuisines || [],
      primaryTypeDisplay: candidate.primaryTypeDisplay,
      media: candidate.media,
      recommendedBy: recommendedBy?.name,
      recommendedByUid: recommendedBy?.uid,
      createdAt: now,
      updatedAt: now,
    };

    const nextBookmarks = [
      newBookmark,
      ...bookmarks.filter((b) => b.id !== bookmarkId && b.placeId !== candidate.placeId),
    ];
    setBookmarks(nextBookmarks);
    writeStoredArray(LOCAL_BOOKMARKS_KEY, nextBookmarks);

    if (user) {
      setDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId), stripUndefined(newBookmark)).catch(
        logWriteError('add bookmark')
      );
    }

    trackEvent('add_bookmark', {
      restaurant_name: candidate.name,
      city: candidate.city || '',
      category: primaryCategory,
      recommended_by: recommendedBy?.name || '',
    });
    showToast(
      recommendedBy?.name
        ? `Saved ${candidate.name} (Rec by ${recommendedBy.name})`
        : `Saved ${candidate.name} to ${wantLabel(primaryCategory)}`
    );
  };

  const handleBookmarkSpotFromFriend = (
    spot: RestaurantEntry | BookmarkEntry | PlaceCandidate,
    friendName: string,
    friendUid?: string
  ) => {
    const existingBookmark = bookmarks.find(
      (b) =>
        (spot.placeId && b.placeId === spot.placeId) ||
        (!isMediaPlaceId(spot.placeId) && b.name.trim().toLowerCase() === spot.name.trim().toLowerCase())
    );
    if (existingBookmark) {
      executeDeleteBookmark(existingBookmark.id);
      return;
    }
    const fallbackCategory: SpotCategory =
      'category' in spot && spot.category ? spot.category : DEFAULT_CATEGORY;
    const candidate: PlaceCandidate = {
      placeId: spot.placeId || ('id' in spot ? spot.id : `bm_${Date.now()}`),
      name: spot.name,
      formattedAddress: spot.formattedAddress,
      neighborhood: spot.neighborhood,
      city: spot.city,
      lat: spot.lat,
      lng: spot.lng,
      googleMapsUri: spot.googleMapsUri,
      priceLevel: spot.priceLevel,
      priceRange: spot.priceRange,
      // The spot's own list first, so the bookmark lands in the same category
      categories: Array.from(new Set([fallbackCategory, ...(spot.categories || [])])),
      cuisines: spot.cuisines || [],
      primaryTypeDisplay: spot.primaryTypeDisplay,
      media: spot.media,
      source: 'source' in spot ? spot.source : isMediaPlaceId(spot.placeId) ? 'tmdb' : 'google_places',
    };
    handleAddBookmark(candidate, { name: friendName, uid: friendUid });
  };

  // Saves the private follow list and the public follower edge together
  const commitFollowChange = (
    nextFriends: FriendProfile[],
    friendUid: string,
    following: boolean,
    context: string
  ) => {
    if (!user) return;
    saveFollowChange(db, user.uid, nextFriends, friendUid, following).catch(logWriteError(context));
  };

  const handleFollowFriend = async (listPayload: SharedListPayload) => {
    const friendUid = listPayload.ownerUid || listPayload.id;
    if (!friendUid) return;
    const newFriend: FriendProfile = {
      uid: friendUid,
      name: listPayload.ownerName || 'Friend',
      handle: listPayload.handle,
      photoURL: listPayload.photoURL,
      shareId: listPayload.id,
      addedAt: Date.now(),
    };
    const nextFriends = [newFriend, ...friends.filter((f) => f.uid !== friendUid)];
    setFriends(nextFriends);
    writeStoredArray(LOCAL_FRIENDS_KEY, nextFriends);
    // A profile-only result has no spots yet; the friend's list subscription fills it in
    if (!listPayload.profileOnly) {
      setFriendListsMap((prev) => ({
        ...prev,
        [friendUid]: listPayload,
      }));
    }

    commitFollowChange(nextFriends, friendUid, true, 'follow friend');

    trackEvent('follow_friend', {
      friend_uid: friendUid,
      friend_name: newFriend.name,
    });
    showToast(`Following ${newFriend.name}`);
  };

  const handleFollowByShareId = async (shareId: string): Promise<boolean> => {
    try {
      const snap = await getDoc(doc(db, 'sharedLists', shareId));
      if (!snap.exists()) {
        showToast('Could not find a jelly list for that link');
        return false;
      }
      const parsed = parseSharedListDoc(snap.id, snap.data());
      await handleFollowFriend(parsed);
      return true;
    } catch {
      showToast('Could not load friend list');
      return false;
    }
  };

  const executeUnfollowFriend = async (friendUid: string) => {
    const prevFriends = [...friends];
    const removed = friends.find((f) => f.uid === friendUid);
    const nextFriends = friends.filter((f) => f.uid !== friendUid);
    setFriends(nextFriends);
    writeStoredArray(LOCAL_FRIENDS_KEY, nextFriends);

    commitFollowChange(nextFriends, friendUid, false, 'unfollow friend');

    if (removed) {
      trackEvent('unfollow_friend', { friend_uid: friendUid });
      showToast(
        `Unfollowed ${removed.name}`,
        {
          label: 'Undo',
          onClick: () => {
            setFriends(prevFriends);
            writeStoredArray(LOCAL_FRIENDS_KEY, prevFriends);
            commitFollowChange(prevFriends, friendUid, true, 'undo unfollow');
          },
        },
        5000
      );
    }
  };

  const handleUnfollowFriend = (friendUid: string) => {
    const target = friends.find((f) => f.uid === friendUid);
    const friendName = target?.name || 'this friend';
    setConfirmDialog({
      title: `Unfollow ${friendName}?`,
      message: `Are you sure you want to remove ${friendName} from your friends list?`,
      confirmLabel: 'Unfollow',
      onConfirm: () => executeUnfollowFriend(friendUid),
    });
  };

  const handleUpdateUserHandle = async (nextHandle: string) => {
    const clean = sanitizeHandle(nextHandle);
    if (!clean) return;
    setUserHandle(clean);
    updateLocalSettings({ handle: clean });
    if (user) {
      setDoc(
        doc(db, 'users', user.uid),
        { handle: clean, updatedAt: Date.now() },
        { merge: true }
      ).catch(logWriteError('handle'));
      await handlePublishShareLink(clean);
    }
    showToast(`Saved handle @${clean}`);
  };

  const handleSaveProfilePhoto = async (photo: Blob): Promise<boolean> => {
    if (!user) return false;
    try {
      const url = await saveProfilePhoto(db, user.uid, photo, customPhotoURL);
      setCustomPhotoURL(url);
      trackEvent('upload_profile_photo');
      showToast('Profile photo updated', { kind: 'success' });
      return true;
    } catch (err) {
      console.error('Profile photo upload failed:', err);
      showToast('Couldn’t upload your photo – check your connection and try again', { kind: 'error' });
      return false;
    }
  };

  const handleRemoveProfilePhoto = async () => {
    if (!user) return;
    try {
      await removeProfilePhoto(db, user.uid, customPhotoURL);
      setCustomPhotoURL(null);
      showToast(user.photoURL ? 'Back to your Google photo' : 'Photo removed', { kind: 'success' });
    } catch (err) {
      console.error('Profile photo removal failed:', err);
      showToast('Couldn’t remove your photo – try again', { kind: 'error' });
    }
  };

  const handleSearchPublicLists = async (rawQuery: string): Promise<SharedListPayload[]> => {
    const trimmed = rawQuery.trim();
    if (!trimmed) return [];

    // Support pasting a full share link
    const extractedListId = shareIdFromText(trimmed);

    const results: SharedListPayload[] = [];
    const seenIds = new Set<string>();

    if (extractedListId) {
      try {
        const directSnap = await getDoc(doc(db, 'sharedLists', extractedListId));
        if (directSnap.exists()) {
          const parsed = parseSharedListDoc(directSnap.id, directSnap.data());
          results.push(parsed);
          seenIds.add(parsed.id);
        }
      } catch {
        // Ignore
      }
    }

    try {
      for (const profile of await searchProfiles(db, trimmed)) {
        if (seenIds.has(profile.id) || (user && profile.id === user.uid)) continue;
        results.push(profile);
        seenIds.add(profile.id);
      }
    } catch (err) {
      console.error('Error searching profiles:', err);
    }

    return results;
  };

  const handleSelectFriendToView = async (friend: FriendProfile) => {
    const cached = friendListsMap[friend.uid];
    if (cached) {
      setSharedList(cached);
      trackEvent('switch_friend_list', { friend_uid: friend.uid, friend_name: friend.name });
      return;
    }
    const shareDocId = friend.shareId || friend.uid;
    setSharedListLoading(true);
    try {
      const snap = await getDoc(doc(db, 'sharedLists', shareDocId));
      if (snap.exists()) {
        const parsed = parseSharedListDoc(snap.id, snap.data());
        setFriendListsMap((prev) => ({ ...prev, [friend.uid]: parsed }));
        setSharedList(parsed);
      } else {
        showToast(`Could not load ${friend.name}'s list`);
      }
    } catch {
      showToast(`Could not load ${friend.name}'s list`);
    } finally {
      setSharedListLoading(false);
    }
  };

  // Shows anyone's list; profile-only entries (search, follower lists) load their spots first
  const handleViewUserList = async (payload: SharedListPayload) => {
    const uid = payload.ownerUid || payload.id;
    const cached = friendListsMap[uid];
    if (!payload.profileOnly || cached) {
      setSharedList(cached || payload);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSharedListLoading(true);
    try {
      const snap = await getDoc(doc(db, 'sharedLists', payload.id));
      if (snap.exists()) {
        setSharedList(parseSharedListDoc(snap.id, snap.data()));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        showToast(`${payload.ownerName} hasn’t shared a list yet`);
      }
    } catch {
      showToast(`Could not load ${payload.ownerName}'s list`);
    } finally {
      setSharedListLoading(false);
    }
  };

  const executeDeleteBookmark = async (bookmarkId: string) => {
    const prevBookmarks = [...bookmarks];
    const target = bookmarks.find((b) => b.id === bookmarkId);
    const nextBookmarks = bookmarks.filter((b) => b.id !== bookmarkId);
    setBookmarks(nextBookmarks);
    writeStoredArray(LOCAL_BOOKMARKS_KEY, nextBookmarks);

    if (user) {
      deleteDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId)).catch(logWriteError('delete bookmark'));
    }
    if (target) {
      trackEvent('delete_bookmark', { restaurant_name: target.name });
      showToast(`Removed ${target.name}`, {
        kind: 'removed',
        action: {
          label: 'Undo',
          onClick: () => {
            setBookmarks(prevBookmarks);
            writeStoredArray(LOCAL_BOOKMARKS_KEY, prevBookmarks);
            if (user) {
              setDoc(doc(db, 'users', user.uid, 'bookmarks', target.id), stripUndefined(target)).catch(
                logWriteError('undo delete bookmark')
              );
            }
            showToast(`Restored ${target.name}`, { kind: 'restored' });
          },
        },
      });
    }
  };

  const handleDeleteBookmark = (bookmarkId: string) => {
    executeDeleteBookmark(bookmarkId);
  };

  const handleStartRankFromBookmark = (bookmark: BookmarkEntry) => {
    setRankingBookmark(bookmark);
    openRankFor(bookmark);
  };

  /**
   * Opens the rank flow for a spot that isn't in your list yet (a bookmark, a "For you" pick, or a
   * spot on someone else's list). Only the place facts come along, never their notes or scores.
   */
  const openRankFor = (bookmark: BookmarkEntry | RestaurantEntry) => {
    const pseudoEntry: RestaurantEntry = {
      id: buildEntryId(bookmark.placeId || bookmark.id, bookmark.category),
      placeId: bookmark.placeId || bookmark.id,
      name: bookmark.name,
      formattedAddress: bookmark.formattedAddress,
      neighborhood: bookmark.neighborhood,
      city: bookmark.city,
      lat: bookmark.lat,
      lng: bookmark.lng,
      googleMapsUri: bookmark.googleMapsUri,
      priceLevel: bookmark.priceLevel,
      priceRange: bookmark.priceRange,
      category: bookmark.category,
      categories: bookmark.categories,
      cuisines: bookmark.cuisines,
      primaryTypeDisplay: bookmark.primaryTypeDisplay,
      media: bookmark.media,
      initialRating: 8,
      rankIndex: 0,
      magicScore: 8,
      comparisonsCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setReRankingEntry(pseudoEntry);
    setIsAddModalOpen(true);
  };

  const findMyBookmark = (spot: { placeId?: string; name: string }) =>
    bookmarks.find(
      (b) =>
        (spot.placeId && b.placeId === spot.placeId) ||
        (!isMediaPlaceId(spot.placeId) && b.name.trim().toLowerCase() === spot.name.trim().toLowerCase())
    );

  const handleToggleForYouBookmark = (spot: ForYouSpot) => {
    const existing = findMyBookmark(spot);
    if (existing) {
      executeDeleteBookmark(existing.id);
      return;
    }
    trackEvent('for_you_bookmark', { category: spot.category, predicted_score: spot.prediction.score });
    handleAddBookmark({
      placeId: spot.placeId!,
      name: spot.name,
      formattedAddress: spot.formattedAddress,
      neighborhood: spot.neighborhood,
      city: spot.city,
      lat: spot.lat,
      lng: spot.lng,
      googleMapsUri: spot.googleMapsUri,
      categories: [spot.category],
      cuisines: spot.cuisines,
      media: spot.media,
      source: isMediaPlaceId(spot.placeId) ? 'tmdb' : 'google_places',
    });
  };

  const handleRankForYou = (spot: BookmarkEntry) => {
    trackEvent('open_rank_from_for_you', { category: spot.category });
    const existing = findMyBookmark(spot);
    if (existing) {
      // Ranking it here also clears it from your bookmarks
      handleStartRankFromBookmark({ ...existing, category: spot.category });
      return;
    }
    setRankingBookmark(null);
    openRankFor(spot);
  };

  const handlePublishShareLink = async (
    overrideHandle?: string,
    category?: SpotCategory
  ): Promise<string | null> => {
    if (!user) {
      showToast('Sign in with Google to create a live share link');
      return null;
    }

    const lists = await publishMyPublicDocs(overrideHandle);
    trackEvent('publish_share_link', {
      restaurants_count: lists?.restaurants.length ?? 0,
      bookmarks_count: lists?.bookmarks.length ?? 0,
    });

    return shareListUrl(window.location.origin, user.uid, category);
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      trackEvent('login', { method: 'Google' });
      showToast('Signed in with Google');
    } catch {
      // Popup closed
    }
  };

  const requestSignOut = () => {
    setConfirmDialog({
      title: 'Sign out of jelly?',
      message: 'Your ranked list and bookmarks stay saved to your account.',
      confirmLabel: 'Sign out',
      iconVariant: 'logout',
      onConfirm: async () => {
        setIsSettingsOpen(false);
        await signOut(auth);
        // Also covers an account whose lists never finished their first server sync
        resetAccountState();
        trackEvent('logout');
        showToast('Signed out');
      },
    });
  };

  const cleanupBookmarkIfRanked = async (placeId?: string, name?: string) => {
    const match =
      rankingBookmark ||
      bookmarks.find(
        (b) =>
          (placeId && b.placeId === placeId) ||
          (name && !isMediaPlaceId(placeId) && b.name.toLowerCase() === name.toLowerCase())
      );
    setRankingBookmark(null);
    if (match) {
      const next = bookmarks.filter((b) => b.id !== match.id);
      setBookmarks(next);
      writeStoredArray(LOCAL_BOOKMARKS_KEY, next);
      if (user) {
        deleteDoc(doc(db, 'users', user.uid, 'bookmarks', match.id)).catch(logWriteError('remove ranked bookmark'));
      }
    }
  };

  // Called when Q1 (1-10 rating) and Q2 (which list) are completed
  const handleCompleteQuestions = async (
    candidate: PlaceCandidate,
    initialRating: number,
    selectedCategory: SpotCategory,
    existingIdToReplace?: string
  ) => {
    setIsAddModalOpen(false);
    setReRankingEntry(null);
    const move = moveRef.current;
    moveRef.current = null;
    if (move && existingIdToReplace === move.toId) existingIdToReplace = move.fromId;

    const placement: PendingPlacement = {
      candidate,
      initialRating,
      category: selectedCategory,
      cuisines: candidate.cuisines,
      // A bookmark being ranked isn't in the list yet, so there's nothing to replace
      existingIdToReplace: existingEntryFor(restaurants, { existingIdToReplace })?.id,
    };

    trackEvent('complete_initial_questions', {
      restaurant_name: candidate.name,
      category: selectedCategory,
      initial_rating: initialRating,
      is_rerank: Boolean(placement.existingIdToReplace),
    });

    // The first spot in a list has nothing to compare against: it goes straight to #1
    if (placementPool(restaurants, placement).length === 0) {
      await finishPlacement(placement, FIRST_IN_LIST);
      return;
    }

    // Otherwise launch Q3+ (SxS comparisons)
    setPendingPlacement(placement);
    setIsSxSOpen(true);
  };

  // Moves a ranked spot to another list: the rating sheet opens on the new list with the old rating
  // on the slider, then side-by-side there. placeSpot replaces the old entry, keeping its notes and
  // history (the review follows as a draft). `moveRef` ties the old entry to the sheet's stand-in.
  const moveRef = useRef<{ fromId: string; toId: string } | null>(null);
  const handleMoveSpot = (spot: RestaurantEntry, category: SpotCategory) => {
    trackEvent('move_spot', { from: spot.category, to: category });
    const toId = buildEntryId(spot.placeId || spot.id, category);
    moveRef.current = { fromId: spot.id, toId };
    setReRankingEntry({ ...spot, id: toId, category, categories: [category, ...(spot.categories || [])] });
    setIsAddModalOpen(true);
  };

  // Ranks a spot you already have in another list of its group as well; the first ranking stays
  const handleAddToList = (spot: RestaurantEntry, category: SpotCategory) => {
    trackEvent('add_to_other_list', { from: spot.category, to: category });
    openRankFor({ ...spot, category });
  };

  const handleFinishPlacement = (placement: PendingPlacement, result: PlacementResult) => {
    setIsSxSOpen(false);
    setPendingPlacement(null);
    return finishPlacement(placement, result);
  };

  const finishPlacement = async (placement: PendingPlacement, result: PlacementResult) => {
    const placed = placeSpot(restaurants, placement, result, Date.now());
    const movedFrom = placed.removedId ? restaurants.find((r) => r.id === placed.removedId) : undefined;
    await persistOrderedRestaurants(placed.restaurants, placed.removedId);
    setSelectedCategory(placement.category);
    await cleanupBookmarkIfRanked(placement.candidate.placeId, placement.candidate.name);
    setActiveTab('ranked');
    trackEvent('complete_ranking', {
      restaurant_name: placed.entry.name,
      category: placed.entry.category,
      initial_rating: placed.entry.initialRating,
      magic_score: placed.entry.magicScore,
      rank_position: placed.position,
      comparisons_count: result.comparisonsDone,
      is_rerank: Boolean(placement.existingIdToReplace),
    });
    const rankedMessage = `Ranked ${placed.entry.name} #${placed.position} in ${CATEGORY_LABEL[placed.entry.category]} · ${placed.entry.magicScore.toFixed(1)}`;
    const key = user ? reviewKeyForEntry(placed.entry) : null;
    if (!user || !key) {
      showToast(rankedMessage);
      return;
    }
    // Offer a public review (prefilled with the one they wrote before, if any)
    const cachedMine = getCachedReviews(key)?.reviews.find((r) => r.uid === user.uid);
    setReviewPrompt({
      entry: placed.entry,
      position: placed.position,
      rankedMessage,
      existing: cachedMine ? { text: cachedMine.text, createdAt: cachedMine.createdAt, here: true } : undefined,
    });
    const uid = user.uid;
    const oldKey = movedFrom ? reviewKeyForEntry(movedFrom) : null;
    (async () => {
      const here = await fetchMyReview(db, key, uid);
      let existing = here ? { text: here.text, createdAt: here.createdAt, here: true } : null;
      // Re-ranked into another list: carry the old list's review over as a draft, and drop it there
      // (the onRestaurantWritten function would too, now that the old entry is gone)
      if (!existing && oldKey && oldKey !== key) {
        const moved = await fetchMyReview(db, oldKey, uid);
        if (moved) {
          existing = { text: moved.text, createdAt: moved.createdAt, here: false };
          deleteMyReview(db, oldKey, uid)
            .then(() => setCachedMyReview(oldKey, uid, null))
            .catch(logWriteError('delete moved review'));
        }
      }
      setReviewPrompt((prev) => (prev && prev.entry.id === placed.entry.id ? { ...prev, existing } : prev));
    })().catch((err) => {
      console.error('Failed to load your review:', err);
      setReviewPrompt((prev) => (prev && prev.entry.id === placed.entry.id ? { ...prev, existing: null } : prev));
    });
  };

  const handlePostReview = async (text: string) => {
    if (!user || !reviewPrompt) return;
    // The rules check the review's score against the stored entry, so read the latest one
    const current = restaurantsRef.current.find((r) => r.id === reviewPrompt.entry.id);
    const key = current ? reviewKeyForEntry(current) : null;
    if (!current || !key) throw new Error('That spot is no longer ranked');
    const existsHere = Boolean(reviewPrompt.existing?.here);
    const saved = await saveMyReview(db, key, user.uid, text, current.magicScore, existsHere);
    setCachedMyReview(
      key,
      user.uid,
      { ...saved, createdAt: existsHere && reviewPrompt.existing ? reviewPrompt.existing.createdAt : saved.createdAt },
      { name: user.displayName || 'You', handle: userHandle || undefined, photoURL: myPhotoURL || undefined }
    );
    trackEvent(existsHere ? 'edit_review' : 'post_review', {
      category: current.category,
      length: saved.text.length,
      from: 'after_ranking',
    });
    setReviewPrompt(null);
    showToast(existsHere ? `Updated your review of ${current.name}` : `Posted your review of ${current.name}`, {
      kind: 'success',
    });
  };

  const handleSkipReview = () => {
    if (!reviewPrompt) return;
    trackEvent('skip_review', { category: reviewPrompt.entry.category });
    const { rankedMessage } = reviewPrompt;
    setReviewPrompt(null);
    showToast(rankedMessage);
  };

  // Drag-and-drop reorder
  const handleReorderDragEnd = async (activeId: string, overId: string) => {
    if (sharedList) return;
    const moved = reorderSpot(restaurants, activeId, overId, Date.now());
    if (!moved) return;
    trackEvent('manual_reorder', {
      restaurant_name: moved.entry.name,
      from_rank: moved.from + 1,
      to_rank: moved.to + 1,
    });
    await persistOrderedRestaurants(moved.restaurants);
    showToast(`Moved ${moved.entry.name} to #${moved.to + 1}`, {
      kind: 'moved',
      action: {
        label: 'Undo',
        onClick: () => {
          const undone = undoReorder(restaurantsRef.current, moved.undo);
          if (!undone) return;
          trackEvent('undo_reorder', { restaurant_name: moved.entry.name });
          persistOrderedRestaurants(undone);
          showToast(`${moved.entry.name} is back at #${moved.from + 1}`, { kind: 'restored' });
        },
      },
    });
  };

  // Order check: fix pairs whose order disagrees with the stored side-by-side answers
  const handleOrderCheckAnswer = async (conflict: OrderConflict, outcome: CheckOutcome) => {
    const category = conflict.above.category;
    const current = restaurantsRef.current;
    const next = applyCheckAnswer(getCategoryList(current, category), conflict, outcome, Date.now());
    trackEvent('order_check_answer', { outcome, category, margin: Math.round(conflict.margin * 100) / 100 });
    await persistOrderedRestaurants(replaceCategoryList(current, category, next));
  };

  const handleSaveSpotEdits = async (
    id: string,
    updates: {
      cuisines: string[];
      priceLevel?: number;
      priceRange?: RestaurantEntry['priceRange'];
      notes?: string;
    }
  ) => {
    const updated = restaurants.map((r) =>
      r.id === id
        ? {
            ...r,
            cuisines: updates.cuisines,
            priceLevel: updates.priceLevel,
            priceRange: updates.priceRange,
            notes: updates.notes,
            updatedAt: Date.now(),
          }
        : r
    );
    trackEvent('edit_spot_details', {
      restaurant_id: id,
    });
    await persistOrderedRestaurants(updated);
    showToast('Updated details');
  };

  const executeDeleteRestaurant = async (id: string) => {
    const target = restaurants.find((r) => r.id === id);
    if (!target) return;
    if (activeDetailSpot?.id === id) {
      setActiveDetailSpot(null);
    }
    const remaining = restaurants.filter((r) => r.id !== id);
    trackEvent('delete_spot', {
      restaurant_name: target.name,
      category: target.category,
    });
    // Your public review of it goes too (kept here so Undo can put it back)
    const key = user ? reviewKeyForEntry(target) : null;
    const uid = user?.uid;
    const removedReview: Promise<PlaceReview | null> =
      key && uid
        ? fetchMyReview(db, key, uid)
            .then(async (review) => {
              if (review) {
                await deleteMyReview(db, key, uid);
                setCachedMyReview(key, uid, null);
              }
              return review;
            })
            .catch((err) => {
              logWriteError('delete review')(err);
              return null;
            })
        : Promise.resolve(null);
    await persistOrderedRestaurants(remaining, id);
    showToast(`Removed ${target.name}`, {
      kind: 'removed',
      action: {
        label: 'Undo',
        onClick: async () => {
          await persistOrderedRestaurants(restoreSpot(restaurantsRef.current, target));
          showToast(`Restored ${target.name}`, { kind: 'restored' });
          const review = await removedReview;
          const restored = restaurantsRef.current.find((r) => r.id === target.id);
          if (!review || !restored || !key || !uid || auth.currentUser?.uid !== uid) return;
          // A fresh copy: same words and author, dated now
          saveMyReview(db, key, uid, review.text, restored.magicScore, false)
            .then((saved) => setCachedMyReview(key, uid, saved))
            .catch(logWriteError('restore review'));
        },
      },
    });
  };

  const handleDeleteRestaurant = (id: string) => {
    const target = restaurants.find((r) => r.id === id);
    if (!target) return;
    setConfirmDialog({
      title: `Remove ${target.name}?`,
      message: `Are you sure you want to remove ${target.name} from your ${CATEGORY_LABEL[target.category]} list?`,
      confirmLabel: 'Remove Spot',
      onConfirm: () => executeDeleteRestaurant(id),
    });
  };

  const isReadOnly = Boolean(sharedList);

  // Public reviews of a spot, for any sheet or page that shows one (spot sheet, place page)
  const friendIds = useMemo(() => friends.map((f) => f.uid), [friends]);
  const renderPlaceReviews = (placeId: string | undefined, category: SpotCategory, spotName?: string) => {
    const key = reviewKey(placeId, category);
    // Your own score for it, when you've ranked it under that key (needed to write a review)
    const mine = key ? restaurants.find((r) => r.id === key) : undefined;
    return (
      <Suspense fallback={null}>
        <PlaceReviews
          placeId={placeId}
          category={category}
          spotName={spotName}
          viewer={user ? { uid: user.uid, name: user.displayName, handle: userHandle, photoURL: myPhotoURL } : null}
          myScore={mine && reviewKeyForEntry(mine) === key ? mine.magicScore : undefined}
          friendIds={friendIds}
        />
      </Suspense>
    );
  };
  // Spots saved before price ranges were stored get theirs once, when their sheet opens
  usePriceBackfill(activeDetailSpot, !isReadOnly, (id, price) => {
    const current = restaurantsRef.current;
    if (!current.some((r) => r.id === id)) return;
    void persistOrderedRestaurants(current.map((r) => (r.id === id ? { ...r, ...price } : r)));
    setActiveDetailSpot((prev) => (prev?.id === id ? { ...prev, ...price } : prev));
  });

  // Switching list, tab, view or whose list you're viewing starts at its top, not partway down the
  // previous list (only when you'd scrolled into the list; near the top nothing moves)
  const mainRef = useRef<HTMLElement>(null);
  const sharedListId = sharedList?.id;
  useEffect(() => {
    const main = mainRef.current;
    if (main && window.scrollY > main.offsetTop) window.scrollTo({ top: 0 });
  }, [selectedCategory, activeTab, viewMode, sharedListId]);
  const activeRestaurants = sharedList ? sharedList.restaurants : restaurants;
  const activeBookmarks = sharedList ? sharedList.bookmarks ?? NO_BOOKMARKS : bookmarks;

  const myBookmarkedPlaceIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookmarks) {
      if (b.placeId) set.add(b.placeId);
    }
    return set;
  }, [bookmarks]);

  const myBookmarkedNames = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookmarks) {
      set.add(b.name.trim().toLowerCase());
    }
    return set;
  }, [bookmarks]);

  const friendLists = useMemo(() => {
    const list: SharedListPayload[] = [];
    const seen = new Set<string>();
    for (const f of friends) {
      const payload = friendListsMap[f.uid];
      if (payload && !seen.has(payload.id)) {
        list.push(payload);
        seen.add(payload.id);
      }
    }
    if (sharedList && !seen.has(sharedList.id) && sharedList.ownerUid !== user?.uid) {
      list.push(sharedList);
    }
    return list;
  }, [friends, friendListsMap, sharedList, user]);

  const followedUids = useMemo(() => {
    const set = new Set<string>();
    for (const f of friends) {
      if (f.uid) set.add(f.uid);
      if (f.shareId) set.add(f.shareId);
    }
    return set;
  }, [friends]);

  const newFollowerIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of followers) {
      if (!seenFollowerIds.has(f.id)) {
        set.add(f.id);
      }
    }
    return set;
  }, [followers, seenFollowerIds]);

  // Notify when a new follower is detected
  useEffect(() => {
    if (!user || newFollowerIds.size === 0) return;
    for (const follower of followers) {
      if (newFollowerIds.has(follower.id) && !notifiedFollowersRef.current.has(follower.id)) {
        notifiedFollowersRef.current.add(follower.id);
        const handleLabel = follower.handle ? ` (@${follower.handle})` : '';
        const isAlreadyFollowing = friends.some((f) => f.uid === follower.id);
        showToast(
          `🎉 ${follower.ownerName || 'Someone'}${handleLabel} added you as a friend!`,
          isAlreadyFollowing
            ? {
                label: 'View',
                onClick: () => setIsFriendsOpen(true),
              }
            : {
                label: 'Follow back',
                onClick: () => {
                  handleFollowFriend(follower);
                  markFollowersSeen([follower.id]);
                },
              },
          7000
        );
        break;
      }
    }
    // The toast's handlers run later with the state of that render; they don't retrigger it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, followers, newFollowerIds, friends, showToast]);

  const isViewingSharedOwnerFollowed = useMemo(() => {
    if (!sharedList) return false;
    const ownerUid = sharedList.ownerUid || sharedList.id;
    return friends.some((f) => f.uid === ownerUid || f.shareId === sharedList.id);
  }, [sharedList, friends]);

  const activeDetailFriendMatches = useMemo(() => {
    if (!activeDetailSpot) return [];
    return getFriendMatchesForSpot(activeDetailSpot, friendLists);
  }, [activeDetailSpot, friendLists]);

  const detailStatKey = activeDetailSpot
    ? placeStatKey(activeDetailSpot.placeId, activeDetailSpot.category ?? activeDetailSpot.categories?.[0])
    : null;
  const detailStatFor = usePlaceStats(detailStatKey ? [detailStatKey] : []);
  const predictionFor = usePredictions();

  const activeDetailSocialMetrics = useMemo(() => {
    if (!activeDetailSpot) return null;
    return getSpotSocialMetrics(activeDetailSpot, {
      myUid: user?.uid,
      myRestaurants: restaurants,
      friendLists,
      communityStat: detailStatFor(detailStatKey) ?? null,
      serverPrediction: predictionFor(activeDetailSpot),
    });
  }, [activeDetailSpot, user, restaurants, friendLists, detailStatFor, detailStatKey, predictionFor]);

  // On someone else's list: your own entry for the open spot in the same list, if you've ranked it
  const myEntryForDetailSpot = useMemo(() => {
    if (!sharedList || !activeDetailSpot) return null;
    return restaurants.find((r) => r.category === activeDetailSpot.category && isSameSpot(r, activeDetailSpot)) ?? null;
  }, [sharedList, activeDetailSpot, restaurants]);

  // Your rankings of the open spot, one per list of its group (the sheet switches between them)
  const myRankingsForDetailSpot = useMemo(
    () =>
      isReadOnly || !activeDetailSpot
        ? []
        : rankingsInGroup(activeDetailSpot, CATEGORY_GROUP[activeDetailSpot.category], restaurants),
    [isReadOnly, activeDetailSpot, restaurants]
  );

  const isDetailSpotBookmarkedByMe = useMemo(() => {
    if (!activeDetailSpot) return false;
    return Boolean(
      (activeDetailSpot.placeId && myBookmarkedPlaceIds.has(activeDetailSpot.placeId)) ||
        myBookmarkedNames.has(activeDetailSpot.name.trim().toLowerCase())
    );
  }, [activeDetailSpot, myBookmarkedPlaceIds, myBookmarkedNames]);

  // "For you": server predictions for this group's lists, minus spots you've ranked since
  const { predictions: storedPredictions, loaded: predictionsLoaded } = usePredictionMap();
  const groupForYou = useMemo(
    () =>
      user && !sharedList
        ? GROUP_CATEGORIES[selectedGroup].flatMap((c) => buildForYouSpots(storedPredictions, c, restaurants))
        : [],
    [user, sharedList, selectedGroup, storedPredictions, restaurants]
  );
  // Shared lists have no "For you"
  useEffect(() => {
    if (sharedList && activeTab === 'for_you') setActiveTab('ranked');
  }, [sharedList, activeTab]);

  const currentSourceItems =
    activeTab === 'ranked' ? activeRestaurants : activeTab === 'for_you' ? groupForYou : activeBookmarks;

  // City counts across active source items in this group
  const cityCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of currentSourceItems) {
      if (CATEGORY_GROUP[item.category] !== selectedGroup) continue;
      if (item.city) {
        map.set(item.city, (map.get(item.city) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [currentSourceItems, selectedGroup]);

  const groupRankedCount = useMemo(
    () => activeRestaurants.filter((r) => CATEGORY_GROUP[r.category] === selectedGroup).length,
    [activeRestaurants, selectedGroup]
  );
  const groupBookmarkCount = useMemo(
    () => activeBookmarks.filter((b) => CATEGORY_GROUP[b.category] === selectedGroup).length,
    [activeBookmarks, selectedGroup]
  );

  const selectedCategoryTotal = useMemo(
    () => currentSourceItems.filter((item) => item.category === selectedCategory).length,
    [currentSourceItems, selectedCategory]
  );

  // Category list sizes (respecting active city filter)
  const categoryCounts = useMemo(() => {
    const map = new Map<SpotCategory, number>();
    for (const c of ALL_CATEGORIES) map.set(c, 0);
    for (const item of currentSourceItems) {
      if (selectedCity !== 'ALL' && item.city !== selectedCity) continue;
      map.set(item.category, (map.get(item.category) || 0) + 1);
    }
    return map;
  }, [currentSourceItems, selectedCity]);

  // Cuisines available in the currently selected category & city
  const cuisineCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of currentSourceItems) {
      if (selectedCity !== 'ALL' && item.city !== selectedCity) continue;
      if (item.category !== selectedCategory) continue;
      for (const c of item.cuisines) {
        map.set(c, (map.get(c) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [currentSourceItems, selectedCategory, selectedCity]);

  // Pairs in the open list whose order disagrees with your stored side-by-side answers
  const selectedCategoryList = useMemo(
    () => getCategoryList(restaurants, selectedCategory),
    [restaurants, selectedCategory]
  );
  const orderConflicts = useMemo(
    () => (sharedList ? [] : findOrderConflicts(selectedCategoryList)),
    [sharedList, selectedCategoryList]
  );
  const orderCheckSpots = countSpotsToCheck(orderConflicts);
  const showOrderCheckPrompt =
    !sharedList &&
    activeTab === 'ranked' &&
    viewMode === 'list' &&
    !orderCheckSnoozed.has(selectedCategory) &&
    (orderConflicts[0]?.margin ?? 0) >= PROMPT_MARGIN;

  const filters = useMemo<SpotFilters>(
    () => ({
      category: selectedCategory,
      city: selectedCity,
      cuisine: selectedCuisine,
      players: selectedPlayers,
      maxMinutes,
      maxPrice,
    }),
    [selectedCategory, selectedCity, selectedCuisine, selectedPlayers, maxMinutes, maxPrice]
  );

  // Prices of the titles in the open list (one shared read), for the price filter
  const priceOf = usePrices(
    hasPriceFilter(selectedCategory)
      ? [
          ...getCategoryList(activeRestaurants, selectedCategory).map((r) => r.placeId),
          ...activeBookmarks.map((b) => b.placeId),
          ...groupForYou.map((s) => s.placeId),
        ]
      : []
  );

  const filteredRestaurants = useMemo(() => {
    const base = getCategoryList(activeRestaurants, selectedCategory).filter((r) =>
      matchesSpotFilters(r, filters, priceOf)
    );
    return sortByNearest && userLocation
      ? sortByDistance(base, userLocation, (a, b) => a.rankIndex - b.rankIndex)
      : base;
  }, [activeRestaurants, selectedCategory, filters, priceOf, sortByNearest, userLocation]);

  const filteredBookmarks = useMemo(() => {
    const base = activeBookmarks.filter((b) => matchesSpotFilters(b, filters, priceOf));
    return userLocation ? sortByDistance(base, userLocation, (a, b) => b.createdAt - a.createdAt) : base;
  }, [activeBookmarks, filters, priceOf, userLocation]);

  const filteredForYou = useMemo(() => {
    const base = groupForYou.filter((s) => matchesSpotFilters(s, filters, priceOf));
    return sortByNearest && userLocation ? sortByDistance(base, userLocation) : base;
  }, [groupForYou, filters, priceOf, sortByNearest, userLocation]);

  const isFiltered = isFilterActive(filters);

  // Settings has no Save button: closing it saves whatever changed since it opened
  const settingsAtOpenRef = useRef('');
  const currentSettings = () => ({ defaultCity: defaultCity.trim(), linearRatingScale, useCurrentLocation });
  const openSettings = () => {
    settingsAtOpenRef.current = JSON.stringify(currentSettings());
    setIsSettingsOpen(true);
  };
  const closeSettings = () => {
    setIsSettingsOpen(false);
    const next = currentSettings();
    if (JSON.stringify(next) === settingsAtOpenRef.current) return;
    setDefaultCity(next.defaultCity);
    updateLocalSettings(next);
    if (user) {
      setDoc(doc(db, 'users', user.uid), { ...next, updatedAt: Date.now() }, { merge: true }).catch(
        logWriteError('settings')
      );
    }
    showToast('Saved');
  };

  const handleExportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ restaurants: activeRestaurants, bookmarks: activeBookmarks }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jelly-rankings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // The full-screen search page covers the main screen (re-ranking is only a sheet)
  const searchCovers = isAddModalOpen && !reRankingEntry;
  const openAddModal = () => {
    trackEvent('open_add_modal');
    // Raise the iOS keyboard now, inside the tap: the search page focuses its box a render later
    primeKeyboard();
    setReRankingEntry(null);
    setRankingBookmark(null);
    setIsAddModalOpen(true);
  };
  const openFriends = () => {
    trackEvent('open_friends_modal');
    setIsFriendsOpen(true);
  };
  const openShare = () => {
    if (activeRestaurants.length === 0) {
      showToast('Rank something first, then share your list');
      return;
    }
    trackEvent('open_share_modal');
    setIsShareOpen(true);
  };
  const openWhatsNew = () => {
    trackEvent('open_whats_new', { had_unseen: hasUnseenChangelog });
    setIsWhatsNewOpen(true);
    setHasUnseenChangelog(false);
    updateLocalSettings({ lastSeenVersion: CURRENT_VERSION });
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-[calc(var(--jelly-bottom-bar,0px)+1.5rem)] transition-colors duration-200">
      <AppHeader
        selectedGroup={selectedGroup}
        onSelectGroup={(group) => {
          if (group === selectedGroup) scrollToTop();
          else selectGroup(group);
        }}
        onWordmark={() => scrollToTop()}
        inert={isProfileOpen || searchCovers}
        showSearch={!isReadOnly}
        onSearch={openAddModal}
      />

      {/* Main Centered Feed */}
      <main ref={mainRef} inert={isProfileOpen || searchCovers || undefined} className="max-w-xl mx-auto px-4 pt-2 space-y-3">
        {/* Friend Switcher Bar + Eat Together Pill (shown whenever user follows 1+ friends or is viewing a shared list) */}
        {(friends.length > 0 || sharedList) && (
          <div className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={exitSharedListView}
              className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 ${
                !sharedList
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-2xs'
                  : 'bg-zinc-200/70 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <span>My List</span>
            </button>

            {friends.map((friend) => {
              const isSelected =
                Boolean(sharedList) &&
                (sharedList?.ownerUid === friend.uid ||
                  sharedList?.id === friend.shareId ||
                  sharedList?.id === friend.uid);
              return (
                <button
                  key={friend.uid}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      exitSharedListView();
                    } else {
                      handleSelectFriendToView(friend);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950 shadow-2xs'
                      : 'bg-zinc-200/70 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  {friend.photoURL ? (
                    <img
                      src={friend.photoURL}
                      alt={friend.name}
                      className="w-4 h-4 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                        isSelected
                          ? 'bg-white/20 text-white dark:bg-zinc-950/20 dark:text-zinc-950'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {friend.name[0]?.toUpperCase() || 'F'}
                    </span>
                  )}
                  <span className="max-w-[96px] truncate">{friend.name}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                trackEvent('open_eat_together');
                setEatTogetherFriendUid(
                  sharedList ? sharedList.ownerUid || sharedList.id : null
                );
                setIsEatTogetherOpen(true);
              }}
              className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0 bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/25 flex items-center gap-1 transition-colors"
              title={groupCopy.togetherHint}
            >
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>{groupCopy.together}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFriendsOpen(true)}
              className="px-2.5 py-1.5 rounded-full text-xs font-semibold shrink-0 bg-zinc-200/60 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 flex items-center gap-1 transition-colors"
              title="Add or manage friends"
            >
              <UserPlus className="w-3 h-3" />
              <span>Friends</span>
            </button>
          </div>
        )}

        {/* Whose list this is (share link or a friend's list) */}
        {sharedList && (
          <SharedListBanner
            list={sharedList}
            isOwn={sharedList.ownerUid === user?.uid}
            isFollowed={isViewingSharedOwnerFollowed}
            onToggleFollow={() => {
              if (isViewingSharedOwnerFollowed) {
                handleUnfollowFriend(sharedList.ownerUid || sharedList.id);
              } else {
                handleFollowFriend(sharedList);
              }
            }}
            onBlend={() => {
              const friendUid = sharedList.ownerUid || sharedList.id;
              if (!isViewingSharedOwnerFollowed && friendUid !== user?.uid) {
                handleFollowFriend(sharedList);
              }
              setEatTogetherFriendUid(friendUid);
              setIsEatTogetherOpen(true);
            }}
            onExit={exitSharedListView}
            onOpenFollowList={(title, users) => setFollowListDialog({ isOpen: true, title, users })}
          />
        )}

        {/* Top Row: Ranked vs. Want to Try Segmented Control + List/Map Toggle */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex p-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80">
            <button
              type="button"
              onClick={() => {
                setActiveTab('ranked');
                trackEvent('switch_tab', { tab: 'ranked' });
              }}
              className={`px-2 sm:px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1 sm:gap-1.5 ${
                activeTab === 'ranked'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <span>Ranked</span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                {groupRankedCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('want_to_try');
                trackEvent('switch_tab', { tab: 'want_to_try' });
              }}
              className={`px-2 sm:px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1 sm:gap-1.5 ${
                activeTab === 'want_to_try'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Bookmark className="w-3 h-3 text-rose-500" />
              <span>{groupCopy.want}</span>
              {groupBookmarkCount > 0 && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                  {groupBookmarkCount}
                </span>
              )}
            </button>

            {!sharedList && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('for_you');
                  trackEvent('switch_tab', { tab: 'for_you' });
                }}
                className={`px-2 sm:px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1 sm:gap-1.5 ${
                  activeTab === 'for_you'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Sparkles className="w-3 h-3 text-emerald-500" />
                <span>For you</span>
              </button>
            )}
          </div>

          {/* List <-> Map Toggle (places only) */}
          {groupCopy.hasLocation && (
            <div className="inline-flex p-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80">
              <button
                type="button"
                onClick={() => {
                  setViewMode('list');
                  trackEvent('switch_view_mode', { mode: 'list' });
                }}
                className={`px-2 sm:px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
                title="List view"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">List</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('map');
                  trackEvent('switch_view_mode', { mode: 'map' });
                }}
                className={`px-2 sm:px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${
                  viewMode === 'map'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
                title="Map view"
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Map</span>
              </button>
            </div>
          )}
        </div>

        {/* Category Lists: single-select tabs (each list is ranked completely separately) */}
        <div
          role="tablist"
          aria-label="List"
          className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain no-scrollbar -mx-1 px-1"
        >
          {GROUP_CATEGORIES[selectedGroup].map((category) => {
            const count = categoryCounts.get(category) || 0;
            const active = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (active) return;
                  setSelectedCategory(category);
                  setSelectedCuisine('ALL');
                  trackEvent('select_category', { category });
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-zinc-200/60 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                }`}
              >
                <span aria-hidden="true">{CATEGORY_EMOJI[category]}</span>
                <span>{CATEGORY_LABEL[category]}</span>
                {count > 0 && (
                  <span className={active ? 'opacity-60' : 'opacity-50'}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Secondary Filters: Near Me Toggle + City Filter Pill + Cuisine Chips */}
        {currentSourceItems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain no-scrollbar">
              {/* Near Me / Sort by Nearest Pill */}
              {viewMode === 'list' && groupCopy.hasLocation && (
                <button
                  type="button"
                  onClick={() => {
                    if (!userLocation) {
                      requestUserLocation({ onDone: (located) => located && setSortByNearest(true) });
                      return;
                    }
                    if (activeTab !== 'want_to_try') {
                      const next = !sortByNearest;
                      setSortByNearest(next);
                      trackEvent('toggle_sort_nearest', { sort_by_nearest: next });
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1 transition-colors ${
                    (activeTab !== 'want_to_try' ? sortByNearest && Boolean(userLocation) : Boolean(userLocation))
                      ? 'bg-blue-600 text-white dark:bg-blue-500 dark:text-zinc-950'
                      : 'bg-zinc-200/70 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                  title={
                    !userLocation
                      ? 'Use my location to sort by nearest'
                      : activeTab !== 'want_to_try'
                      ? sortByNearest
                        ? `Sorted by nearest · Click to sort by ${activeTab === 'ranked' ? 'rank' : 'predicted score'}`
                        : 'Sort by nearest to me'
                      : 'Sorted by nearest to me'
                  }
                >
                  <Navigation className="w-3 h-3" />
                  <span>Near Me</span>
                </button>
              )}

              {/* City Filter Pill (shown when 2+ cities exist or a city filter is active) */}
              {(cityCounts.length > 1 || selectedCity !== 'ALL') && (
                <div className="relative shrink-0 flex items-center">
                  <MapPin className="w-3 h-3 text-emerald-600 dark:text-emerald-400 absolute left-2.5 pointer-events-none" />
                  <select
                    value={selectedCity}
                    onChange={(e) => {
                      const nextCity = e.target.value;
                      setSelectedCity(nextCity);
                      setSelectedCuisine('ALL');
                      trackEvent('filter_city', { city: nextCity });
                    }}
                    aria-label="Filter by city"
                    className={`pl-6 pr-2.5 py-1.5 rounded-full text-xs font-semibold appearance-none cursor-pointer transition-colors focus:outline-none ${
                      selectedCity !== 'ALL'
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950'
                        : 'bg-zinc-200/70 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <option value="ALL">All Cities</option>
                    {cityCounts.map(([city, count]) => (
                      <option key={city} value={city}>
                        {city} ({count})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Game night: how many players, how much time */}
              {selectedCategory === 'board_games' && (
                <>
                  <GameNightSelect
                    label="Players"
                    value={selectedPlayers}
                    options={PLAYER_OPTIONS.map((n) => [n, `${n} player${n === 1 ? '' : 's'}`])}
                    anyLabel="Any players"
                    onChange={(v) => {
                      setSelectedPlayers(v);
                      trackEvent('filter_players', { players: v });
                    }}
                  />
                  <GameNightSelect
                    label="Length"
                    value={maxMinutes}
                    options={MINUTE_OPTIONS.map((m) => [m, `Under ${m >= 60 ? `${m / 60} hr` : `${m} min`}`])}
                    anyLabel="Any length"
                    onChange={(v) => {
                      setMaxMinutes(v);
                      trackEvent('filter_length', { minutes: v });
                    }}
                  />
                </>
              )}

              {hasPriceFilter(selectedCategory) && (
                <GameNightSelect
                  label="Price"
                  value={maxPrice}
                  options={PRICE_OPTIONS.map((n) => [n, `Under $${n}`])}
                  anyLabel="Any price"
                  onChange={(v) => {
                    setMaxPrice(v);
                    trackEvent('filter_price', { max: v });
                  }}
                />
              )}

            </div>

            {/* Subtle Secondary Cuisine Chips */}
            {cuisineCounts.length > 1 && (
              <div className="flex flex-wrap items-center gap-1">
                {cuisineCounts.map(([cuisine]) => {
                  const active = selectedCuisine === cuisine;
                  return (
                    <button
                      key={cuisine}
                      type="button"
                      onClick={() => {
                        const nextCuisine = active ? 'ALL' : cuisine;
                        setSelectedCuisine(nextCuisine);
                        trackEvent('filter_cuisine', { cuisine: nextCuisine });
                      }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0 transition-colors ${
                        active
                          ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950'
                          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {cuisine}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showOrderCheckPrompt && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-emerald-200/70 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-4 py-2.5 text-xs">
            <ArrowUpDown className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="flex-1 text-zinc-600 dark:text-zinc-300">
              Your picks suggest {orderCheckSpots === 1 ? 'a spot' : `${orderCheckSpots} spots`} might be out of order
            </span>
            <button
              type="button"
              onClick={() => {
                trackEvent('order_check_open', { category: selectedCategory, spots: orderCheckSpots });
                setIsOrderCheckOpen(true);
              }}
              className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              Check
            </button>
            <button
              type="button"
              onClick={() => setOrderCheckSnoozed((prev) => new Set(prev).add(selectedCategory))}
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Not now
            </button>
          </div>
        )}

        {/* Main Content Area: List or Map */}
        {sharedListLoading ? (
          <div className="py-16 text-center text-xs text-zinc-400">Loading shared list...</div>
        ) : viewMode === 'map' && groupCopy.hasLocation ? (
          <Suspense fallback={<div className="py-16 text-center text-xs text-zinc-400">Loading map...</div>}>
            <RestaurantMapView
              mode={activeTab === 'for_you' ? 'want_to_try' : activeTab}
              restaurants={filteredRestaurants}
              bookmarks={activeTab === 'for_you' ? filteredForYou : filteredBookmarks}
              darkMode={darkMode}
              userLocation={userLocation}
              selectedCity={selectedCity}
              worldScale={selectedGroup === 'travel'}
              onRequestLocation={() => requestUserLocation()}
              onSelectSpot={(spot) => {
                trackEvent('view_spot_detail', {
                  restaurant_name: spot.name,
                  category: spot.category,
                  magic_score: spot.magicScore,
                  rank_position: spot.rankIndex + 1,
                  from_map: true,
                });
                setActiveDetailSpot(spot);
              }}
              onRankBookmark={activeTab === 'for_you' ? handleRankForYou : handleStartRankFromBookmark}
            />
          </Suspense>
        ) : activeTab === 'for_you' ? (
          <ForYouList
            spots={filteredForYou}
            isFiltered={isFiltered}
            selectedCategory={selectedCategory}
            totalUnfilteredCount={selectedCategoryTotal}
            rankedInCategory={getCategoryList(restaurants, selectedCategory).length}
            isSignedIn={Boolean(user)}
            loaded={predictionsLoaded}
            userLocation={userLocation}
            isSaved={(spot) => Boolean(findMyBookmark(spot))}
            onSignIn={handleGoogleSignIn}
            onToggleBookmark={handleToggleForYouBookmark}
            onRank={handleRankForYou}
          />
        ) : activeTab === 'ranked' ? (
          <RestaurantList
            restaurants={filteredRestaurants}
            isFiltered={isFiltered}
            sortByNearest={sortByNearest && Boolean(userLocation)}
            userLocation={userLocation}
            readOnly={isReadOnly}
            selectedCategory={selectedCategory}
            totalUnfilteredCount={selectedCategoryTotal}
            myUid={user?.uid}
            myRestaurants={restaurants}
            friendLists={friendLists}
            bookmarkedPlaceIds={myBookmarkedPlaceIds}
            onBookmarkFromFriend={
              sharedList
                ? (spot) =>
                    handleBookmarkSpotFromFriend(
                      spot,
                      sharedList.ownerName,
                      sharedList.ownerUid || sharedList.id
                    )
                : undefined
            }
            onReorderDragEnd={handleReorderDragEnd}
            onSelectSpot={(spot) => {
              trackEvent('view_spot_detail', {
                restaurant_name: spot.name,
                category: spot.category,
                magic_score: spot.magicScore,
                rank_position: spot.rankIndex + 1,
              });
              setDetailStartsMoving(false);
              setActiveDetailSpot(spot);
            }}
            onMoveSpot={(spot) => {
              setDetailStartsMoving(true);
              setActiveDetailSpot(spot);
            }}
            canMoveSpot={(spot) => moveTargetsFor(spot, restaurants).length > 0}
            onReRankSpot={(spot) => {
              trackEvent('open_rerank_modal', {
                restaurant_name: spot.name,
                category: spot.category,
                from_swipe: true,
              });
              setReRankingEntry(spot);
              setIsAddModalOpen(true);
            }}
            onDeleteSpot={handleDeleteRestaurant}
            onOpenAddModal={() => {
              trackEvent('open_add_modal');
              setReRankingEntry(null);
              setRankingBookmark(null);
              setIsAddModalOpen(true);
            }}
          />
        ) : (
          <BookmarkList
            bookmarks={filteredBookmarks}
            isFiltered={isFiltered}
            userLocation={userLocation}
            selectedCategory={selectedCategory}
            totalUnfilteredCount={selectedCategoryTotal}
            readOnly={isReadOnly}
            myUid={user?.uid}
            myRestaurants={restaurants}
            friendLists={friendLists}
            myBookmarkedPlaceIds={myBookmarkedPlaceIds}
            myBookmarkedNames={myBookmarkedNames}
            friendName={sharedList?.ownerName}
            onSaveFromFriendBookmark={
              sharedList
                ? (bm) =>
                    handleBookmarkSpotFromFriend(
                      bm,
                      sharedList.ownerName,
                      sharedList.ownerUid || sharedList.id
                    )
                : undefined
            }
            onRankBookmark={handleStartRankFromBookmark}
            onDeleteBookmark={handleDeleteBookmark}
            onOpenAddModal={() => {
              trackEvent('open_add_modal', { from_tab: 'want_to_try' });
              setReRankingEntry(null);
              setRankingBookmark(null);
              setIsAddModalOpen(true);
            }}
          />
        )}
      </main>

      <footer inert={isProfileOpen || searchCovers || undefined} className="max-w-xl mx-auto px-4 pt-8 pb-6 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
        jelly – rank the things you love ·{' '}
        <a href="/about" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          About
        </a>{' '}
        ·{' '}
        <a href="/privacy.html" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          Privacy
        </a>
      </footer>

      {/* Add flow: search page (→ place page) → rating sheet (gut feeling → list) */}
      <MountWhenOpened open={isAddModalOpen}>
        <AddAndRateModal
          isOpen={isAddModalOpen}
          onClose={() => {
            setIsAddModalOpen(false);
            setReRankingEntry(null);
            setRankingBookmark(null);
          }}
          existingRestaurants={restaurants}
          defaultCategory={selectedCategory}
          myUid={user?.uid}
          bookmarkedPlaceIds={myBookmarkedPlaceIds}
          friendLists={friendLists}
          reRankingEntry={reRankingEntry}
          defaultCity={defaultCity}
          linearRatingScale={linearRatingScale}
          userLocation={useCurrentLocation ? userLocation : null}
          onCompleteQuestions={handleCompleteQuestions}
          onAddBookmark={(candidate) => handleAddBookmark(candidate)}
          onRemoveBookmark={(candidate) => {
            const existing = findMyBookmark(candidate);
            if (existing) executeDeleteBookmark(existing.id);
          }}
          renderReviews={renderPlaceReviews}
        />
      </MountWhenOpened>

      <MountWhenOpened open={isOrderCheckOpen}>
        <OrderCheckModal
          isOpen={isOrderCheckOpen}
          list={selectedCategoryList}
          onAnswer={handleOrderCheckAnswer}
          onClose={() => setIsOrderCheckOpen(false)}
        />
      </MountWhenOpened>

      {/* Q3+: SxS Comparison Modal */}
      <MountWhenOpened open={isSxSOpen}>
        <SxSArenaModal
          isOpen={isSxSOpen}
          onClose={() => {
            setIsSxSOpen(false);
            setPendingPlacement(null);
          }}
          existingRestaurants={restaurants}
          pendingPlacement={pendingPlacement}
          onFinishPlacement={handleFinishPlacement}
        />
      </MountWhenOpened>

      {/* Spot Detail / Re-Rank / Hidden Edit Sheet */}
      <MountWhenOpened open={Boolean(activeDetailSpot)}>
        <SpotDetailModal
          restaurant={activeDetailSpot}
          readOnly={isReadOnly}
          friendOwnerName={sharedList?.ownerName}
          isBookmarkedInMyList={isDetailSpotBookmarkedByMe}
          friendMatches={activeDetailFriendMatches}
          socialMetrics={activeDetailSocialMetrics}
          onSaveFromFriendToBookmark={
            sharedList
              ? (spot: RestaurantEntry) =>
                  handleBookmarkSpotFromFriend(
                    spot,
                    sharedList.ownerName,
                    sharedList.ownerUid || sharedList.id
                  )
              : undefined
          }
          myEntry={myEntryForDetailSpot}
          onRankForMe={
            sharedList
              ? (spot: RestaurantEntry) => {
                  trackEvent('rank_from_friend_list', { category: spot.category });
                  setRankingBookmark(null);
                  openRankFor(spot);
                }
              : undefined
          }
          onClose={() => {
            setActiveDetailSpot(null);
            setDetailStartsMoving(false);
          }}
          myRankings={myRankingsForDetailSpot}
          onSelectRanking={setActiveDetailSpot}
          onAddToList={handleAddToList}
          onReRank={(spot) => {
            trackEvent('open_rerank_modal', {
              restaurant_name: spot.name,
              category: spot.category,
            });
            setReRankingEntry(spot);
            setIsAddModalOpen(true);
          }}
          otherLists={isReadOnly || !activeDetailSpot ? [] : moveTargetsFor(activeDetailSpot, restaurants)}
          onMove={handleMoveSpot}
          startMoving={detailStartsMoving}
          onSaveEdits={handleSaveSpotEdits}
          onDelete={handleDeleteRestaurant}
          renderReviews={renderPlaceReviews}
        />
      </MountWhenOpened>

      {/* Optional public review after a side-by-side */}
      <MountWhenOpened open={Boolean(reviewPrompt)}>
        {reviewPrompt && (
          <ReviewPromptSheet
            key={reviewPrompt.entry.id}
            entry={reviewPrompt.entry}
            position={reviewPrompt.position}
            existingText={reviewPrompt.existing === undefined ? undefined : reviewPrompt.existing?.text ?? null}
            alreadyPosted={reviewPrompt.existing?.here ?? false}
            onPost={handlePostReview}
            onSkip={handleSkipReview}
          />
        )}
      </MountWhenOpened>

      {/* Friends Directory & @Handle Modal */}
      <MountWhenOpened open={isFriendsOpen}>
        <FriendsModal
          isOpen={isFriendsOpen}
          onClose={() => {
            setIsFriendsOpen(false);
            if (followers.length > 0) {
              markFollowersSeen(followers.map((f) => f.id));
            }
          }}
          isSignedIn={Boolean(user)}
          userUid={user?.uid}
          userHandle={userHandle}
          myRestaurants={restaurants}
          onUpdateHandle={handleUpdateUserHandle}
          friends={friends}
          friendListsMap={friendListsMap}
          followers={followers}
          newFollowerIds={newFollowerIds}
          onOpenFollowList={(title, users) =>
            setFollowListDialog({ isOpen: true, title, users })
          }
          onSearchDirectory={handleSearchPublicLists}
          onFollowFriend={handleFollowFriend}
          onFollowByShareId={handleFollowByShareId}
          onUnfollowFriend={handleUnfollowFriend}
          onViewFriendList={(friendUid: string) => {
            closeProfile();
            const found = friends.find((f) => f.uid === friendUid);
            if (found) {
              handleSelectFriendToView(found);
            } else if (friendListsMap[friendUid]) {
              setSharedList(friendListsMap[friendUid]);
            } else {
              const fromFollowers = followers.find((f) => f.id === friendUid);
              if (fromFollowers) handleViewUserList(fromFollowers);
            }
          }}
          onOpenBlendWithFriend={(friendUid: string) => {
            setEatTogetherFriendUid(friendUid);
            setIsEatTogetherOpen(true);
          }}
          onPublishMyProfile={() => handlePublishShareLink()}
        />
      </MountWhenOpened>

      {/* Eat Together / Group Blend Modal */}
      <MountWhenOpened open={isEatTogetherOpen}>
        <EatTogetherModal
          isOpen={isEatTogetherOpen}
          onClose={() => setIsEatTogetherOpen(false)}
          myRestaurants={restaurants}
          myBookmarks={bookmarks}
          friends={friends}
          friendListsMap={friendListsMap}
          initialSelectedFriendUid={eatTogetherFriendUid}
          initialCategory={selectedCategory}
          userLocation={userLocation}
          bookmarkedPlaceIds={myBookmarkedPlaceIds}
          onSaveFriendSpotToBookmarks={(candidate, recByLabel, recByUid) =>
            handleBookmarkSpotFromFriend(candidate, recByLabel, recByUid)
          }
          onOpenFriendsModal={() => setIsFriendsOpen(true)}
        />
      </MountWhenOpened>

      {/* Share List & Top 10 Snapshot Card Modal */}
      <MountWhenOpened open={isShareOpen}>
        <ShareModal
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          restaurants={
            filteredRestaurants.length > 0
              ? filteredRestaurants
              : getCategoryList(activeRestaurants, selectedCategory)
          }
          bookmarks={activeBookmarks.filter((b) => b.category === selectedCategory)}
          selectedCategory={selectedCategory}
          selectedCity={selectedCity}
          selectedCuisine={selectedCuisine}
          ownerName={
            sharedList
              ? sharedList.ownerName
              : user?.displayName
              ? user.displayName.split(' ')[0]
              : ''
          }
          isSignedIn={Boolean(user)}
          darkMode={darkMode}
          onPublishShareLink={() => handlePublishShareLink(undefined, selectedCategory)}
        />
      </MountWhenOpened>

      {/* Confirmation Modal for Deleting Spots / Bookmarks / Friends */}
      <ConfirmModal
        isOpen={Boolean(confirmDialog)}
        title={confirmDialog?.title || 'Confirm'}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || 'Remove'}
        iconVariant={confirmDialog?.iconVariant}
        onConfirm={() => {
          if (confirmDialog) {
            confirmDialog.onConfirm();
          }
          setConfirmDialog(null);
        }}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Modal to view followers and following for anyone */}
      <MountWhenOpened open={followListDialog.isOpen}>
        <FollowListModal
          isOpen={followListDialog.isOpen}
          onClose={() => setFollowListDialog((prev) => ({ ...prev, isOpen: false }))}
          title={followListDialog.title}
          users={followListDialog.users}
          myUid={user?.uid}
          followedUids={followedUids}
          onFollowUser={handleFollowFriend}
          onUnfollowUser={handleUnfollowFriend}
          onSelectUser={(selectedUser) => {
            setFollowListDialog((prev) => ({ ...prev, isOpen: false }));
            closeProfile();
            handleViewUserList(selectedUser);
          }}
        />
      </MountWhenOpened>

      <MountWhenOpened open={isSettingsOpen}>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={closeSettings}
          useCurrentLocation={useCurrentLocation}
          onToggleCurrentLocation={() => {
            if (!useCurrentLocation) {
              requestUserLocation({
                deniedMessage: 'Enable location permissions in your browser to use current location',
                onDone: () => setUseCurrentLocation(true),
              });
            } else {
              setUseCurrentLocation(false);
            }
          }}
          hasLocation={Boolean(userLocation)}
          defaultCity={defaultCity}
          onDefaultCityChange={setDefaultCity}
          linearRatingScale={linearRatingScale}
          onLinearRatingScaleChange={setLinearRatingScale}
          onExport={handleExportJson}
          hasUnseenChangelog={hasUnseenChangelog}
          onOpenWhatsNew={openWhatsNew}
          onOpenFeedback={openFeedback}
          email={user ? user.email : undefined}
          onSignOut={requestSignOut}
          onReplayTour={() => {
            trackEvent('onboarding_replay', { source: 'settings' });
            closeSettings();
            openTour();
          }}
        />
      </MountWhenOpened>

      <MountWhenOpened open={isFeedbackOpen}>
        <FeedbackModal
          isOpen={isFeedbackOpen}
          onClose={() => setIsFeedbackOpen(false)}
          account={user ? { uid: user.uid, displayName: user.displayName, email: user.email } : null}
          groupLabel={GROUP_LABEL[selectedGroup]}
          listLabel={CATEGORY_LABEL[selectedCategory]}
        />
      </MountWhenOpened>
      {isTourOpen && (
        <Suspense fallback={null}>
          <OnboardingTour
            onClose={() => setIsTourOpen(false)}
            onAddFirst={() => {
              setReRankingEntry(null);
              setRankingBookmark(null);
              setIsAddModalOpen(true);
            }}
            onSignIn={user ? undefined : handleGoogleSignIn}
          />
        </Suspense>
      )}

      <MountWhenOpened open={isWhatsNewOpen}>
        <WhatsNewModal isOpen={isWhatsNewOpen} onClose={() => setIsWhatsNewOpen(false)} />
      </MountWhenOpened>

      <ProfilePage
        open={isProfileOpen}
        onClose={closeProfile}
        user={user}
        authLoading={authLoading}
        handle={userHandle}
        onUpdateHandle={handleUpdateUserHandle}
        restaurants={restaurants}
        bookmarks={bookmarks}
        friendCount={friends.length}
        newFollowerCount={newFollowerIds.size}
        hasUnseenChangelog={hasUnseenChangelog}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        onSelectGroup={(group) => {
          exitSharedListView();
          selectGroup(group);
          setActiveTab('ranked');
          closeProfile();
        }}
        onOpenShare={openShare}
        onOpenFriends={openFriends}
        onOpenSettings={openSettings}
        onOpenWhatsNew={openWhatsNew}
        onOpenFeedback={openFeedback}
        onReplayTour={openTour}
        onOpenFollowList={(title, users) => setFollowListDialog({ isOpen: true, title, users })}
        onSignIn={handleGoogleSignIn}
        onSignOut={requestSignOut}
        photoURL={myPhotoURL}
        hasCustomPhoto={Boolean(customPhotoURL)}
        onSavePhoto={handleSaveProfilePhoto}
        onRemovePhoto={handleRemoveProfilePhoto}
        onPhotoError={(message) => showToast(message, { kind: 'error' })}
      />

      {/* Main navigation: Lists · Friends · (+) · Share · Profile */}
      <BottomNav
        active={isProfileOpen ? 'profile' : 'lists'}
        onLists={() => {
          if (isProfileOpen) closeProfile();
          else scrollToTop();
        }}
        onFriends={openFriends}
        onShare={openShare}
        onProfile={() => {
          if (isProfileOpen) return;
          trackEvent('open_profile');
          openProfile();
        }}
        onAdd={isReadOnly ? undefined : openAddModal}
        newFollowerCount={newFollowerIds.size}
        friendCount={friends.length}
        profileDot={hasUnseenChangelog}
        account={
          user ? { photoURL: myPhotoURL, name: user.displayName, email: user.email } : null
        }
      />

      {/* PWA Mobile Install Nudge */}
      <PwaInstallBanner />

      {/* New deploy detected → one-tap reload */}
      <UpdateAvailableBanner />

      <Toast toast={toast} />
    </div>
  );
};
