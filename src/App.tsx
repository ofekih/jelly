import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  QuerySnapshot,
  setDoc,
  WriteBatch,
} from 'firebase/firestore';
import { arrayMove } from '@dnd-kit/sortable';
import {
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronRight,
  Download,
  List,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Moon,
  Navigation,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Sun,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { auth, db, googleProvider, setAnalyticsUser, trackEvent } from './firebase';
import {
  ALL_CATEGORIES,
  ALL_GROUPS,
  BookmarkEntry,
  CATEGORY_EMOJI,
  CATEGORY_GROUP,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  FriendProfile,
  GROUP_CATEGORIES,
  GROUP_EMOJI,
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
  stripUndefined,
} from './lib/firestoreDoc';
import { getItemDistanceMiles, UserCoordinates } from './lib/geo';
import { readLocalSettings, updateLocalSettings } from './lib/localSettings';
import { CURRENT_VERSION, displayVersion, hasUnseenRelease } from './lib/changelog';
import { GROUP_COPY, wantLabel } from './lib/groups';
import { ratingToBaseElo, spectrumGradient, spectrumRatingToPct } from './lib/rankingEngine';
import { RATING_TIERS } from './lib/ratingTiers';
import {
  buildEntryId,
  getCategoryList,
  isFromNewerVersion,
  isLegacyDoc,
  loadBookmarks,
  loadRestaurants,
  recomputeAllCategoryScores,
  staleDerivedScores,
  replaceCategoryList,
  sanitizeLoadedBookmark,
} from './lib/categoryLists';
import {
  appendComparisons,
  applyCheckAnswer,
  CheckOutcome,
  countSpotsToCheck,
  dragComparisons,
  findOrderConflicts,
  OrderConflict,
  PROMPT_MARGIN,
} from './lib/comparisonHistory';
import { OrderCheckModal } from './components/OrderCheckModal';
import {
  deriveDefaultHandle,
  getFriendMatchesForSpot,
  getSpotSocialMetrics,
  sanitizeHandle,
} from './lib/friendsService';
import { AddAndRateModal } from './components/AddAndRateModal';
import { BookmarkList } from './components/BookmarkList';
import { ConfirmModal } from './components/ConfirmModal';
import { EatTogetherModal } from './components/EatTogetherModal';
import { FollowListModal } from './components/FollowListModal';
import { FriendsModal } from './components/FriendsModal';
import { JellyBeanIcon } from './components/JellyBeanIcon';
import { PendingPlacement, SxSArenaModal } from './components/SxSArenaModal';
import { RestaurantList } from './components/RestaurantList';
import { RestaurantMapView } from './components/RestaurantMapView';
import { ShareModal } from './components/ShareModal';
import { SpotDetailModal } from './components/SpotDetailModal';
import { WhatsNewModal } from './components/WhatsNewModal';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner';
import { useBodyScrollLock } from './lib/useBodyScrollLock';
import {
  clearAccountCache,
  isForeignCache,
  LEGACY_LOCAL_STORAGE_KEY,
  LOCAL_BOOKMARKS_KEY,
  LOCAL_FRIENDS_KEY,
  LOCAL_SEEN_FOLLOWERS_KEY,
  LOCAL_STORAGE_KEY,
  readCacheOwner,
  readSyncedFollowEdges,
  shouldSeedCloudFromLocal,
  writeCacheOwner,
  writeSyncedFollowEdges,
} from './lib/localCache';
import {
  buildProfileDoc,
  fetchProfiles,
  placeStatKey,
  searchProfiles,
  setFollowEdge,
} from './lib/socialService';
import { refreshPlaceStatsSoon, usePlaceStats } from './lib/usePlaceStats';
import { usePredictions, watchPredictions } from './lib/usePredictions';
import { FollowCounts } from './components/FollowCounts';
import { buildPublicLists, PublicListTrim } from './lib/publicList';

const PUBLIC_TRIM_MESSAGE: Record<Exclude<PublicListTrim, 'none'>, string> = {
  bookmarkNotes: 'Your list is too big to share in full – friends won’t see your bookmark notes',
  notes: 'Your list is too big to share in full – friends won’t see your notes',
  bookmarks: 'Your list is too big to share in full – friends won’t see your notes or bookmarks',
  spots: 'Your list is too big to share in full – friends only see your top spots',
};

const SESSION_COORDS_KEY = 'jelly_user_coords_v1';

function parseSharedListDoc(id: string, data: any): SharedListPayload {
  const loadedRestaurants: RestaurantEntry[] = loadRestaurants(
    Array.isArray(data.restaurants) ? data.restaurants : []
  );
  const loadedBookmarks: BookmarkEntry[] = Array.isArray(data.bookmarks)
    ? loadBookmarks(data.bookmarks)
    : [];
  const followingIds: string[] | undefined = Array.isArray(data.followingIds)
    ? data.followingIds.filter((uid: any) => typeof uid === 'string')
    : undefined;
  return {
    id,
    ownerUid: data.ownerUid || id,
    ownerName: data.ownerName || 'Friend',
    displayName: data.displayName || data.ownerName || 'Friend',
    handle: data.handle || undefined,
    photoURL: data.photoURL || undefined,
    title: data.title,
    restaurants: loadedRestaurants,
    bookmarks: loadedBookmarks,
    followingIds,
    createdAt: data.createdAt || Date.now(),
    updatedAt: data.updatedAt || Date.now(),
  };
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
  }, [darkMode]);

  const [restaurants, setRestaurants] = useState<RestaurantEntry[]>(() => {
    try {
      const raw =
        localStorage.getItem(LOCAL_STORAGE_KEY) ||
        localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
      if (raw) {
        return loadRestaurants(JSON.parse(raw) as any[]);
      }
    } catch {
      // Ignore
    }
    return [];
  });
  // Latest list for diffing writes; callbacks like toast Undo would otherwise see a stale closure
  const restaurantsRef = useRef(restaurants);
  restaurantsRef.current = restaurants;

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_BOOKMARKS_KEY);
      if (raw) {
        const parsed = loadBookmarks(JSON.parse(raw) as any[]);
        parsed.sort((a, b) => b.createdAt - a.createdAt);
        return parsed;
      }
    } catch {
      // Ignore
    }
    return [];
  });

  // Friends State (localStorage + Firestore sync)
  const [friends, setFriends] = useState<FriendProfile[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_FRIENDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore
    }
    return [];
  });

  const [seenFollowerIds, setSeenFollowerIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SEEN_FOLLOWERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === 'string'));
      }
    } catch {
      // Ignore
    }
    return new Set();
  });
  const notifiedFollowersRef = useRef<Set<string>>(new Set());

  const [userHandle, setUserHandle] = useState<string>(() => readLocalSettings().handle || '');

  const [friendListsMap, setFriendListsMap] = useState<Record<string, SharedListPayload>>({});

  // Shared List Read-Only Mode (?list=<shareId> or Friend Switcher)
  const [sharedList, setSharedList] = useState<SharedListPayload | null>(null);
  const [sharedListLoading, setSharedListLoading] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('list'));
  });

  const [defaultCity, setDefaultCity] = useState<string>(() => readLocalSettings().defaultCity || '');

  const [linearRatingScale, setLinearRatingScale] = useState<boolean>(() =>
    Boolean(readLocalSettings().linearRatingScale)
  );

  const [useCurrentLocation, setUseCurrentLocation] = useState<boolean>(() => {
    const { useCurrentLocation: saved } = readLocalSettings();
    return typeof saved === 'boolean' ? saved : true;
  });

  // View & Filter State
  const [activeTab, setActiveTab] = useState<'ranked' | 'want_to_try'>('ranked');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  // Each category is a fully separate list; exactly one is shown at a time (its group's lists are the tabs)
  const [selectedCategory, setSelectedCategory] = useState<SpotCategory>(() => {
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
  const [sortByNearest, setSortByNearest] = useState<boolean>(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');

  // User Geolocation State
  const [userLocation, setUserLocation] = useState<UserCoordinates | null>(() => {
    try {
      const cached = sessionStorage.getItem(SESSION_COORDS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          return parsed;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  });

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [reRankingEntry, setReRankingEntry] = useState<RestaurantEntry | null>(null);
  const [rankingBookmark, setRankingBookmark] = useState<BookmarkEntry | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [isSxSOpen, setIsSxSOpen] = useState(false);
  const [isOrderCheckOpen, setIsOrderCheckOpen] = useState(false);
  const [orderCheckSnoozed, setOrderCheckSnoozed] = useState<Set<SpotCategory>>(new Set());
  const [activeDetailSpot, setActiveDetailSpot] = useState<RestaurantEntry | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [isEatTogetherOpen, setIsEatTogetherOpen] = useState(false);
  const [eatTogetherFriendUid, setEatTogetherFriendUid] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  useBodyScrollLock(isSettingsOpen);
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(
    null
  );

  const showToast = (
    msg: string,
    action?: { label: string; onClick: () => void },
    durationMs = 3200
  ) => {
    setToastMessage(msg);
    setToastAction(action || null);
    setTimeout(() => {
      setToastMessage((prev) => {
        if (prev === msg) {
          setToastAction(null);
          return null;
        }
        return prev;
      });
    }, durationMs);
  };

  const requestUserLocation = (opts?: { enableSortByNearest?: boolean; silent?: boolean }) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!opts?.silent) showToast('Location access is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: UserCoordinates = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(coords);
        try {
          sessionStorage.setItem(SESSION_COORDS_KEY, JSON.stringify(coords));
        } catch {
          // Ignore
        }
        if (opts?.enableSortByNearest) {
          setSortByNearest(true);
        }
      },
      () => {
        if (!opts?.silent) {
          showToast('Enable location permissions in your browser to sort by nearest');
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000,
      }
    );
  };

  // Automatically request location access on initial load
  useEffect(() => {
    requestUserLocation({ silent: true });
  }, []);

  // Check URL for shared list parameter (?list=<shareId>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('list');
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
  }, []);

  const exitSharedListView = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('list')) {
      url.searchParams.delete('list');
      window.history.replaceState({}, '', url.toString());
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

  // Which of the account's collections the server has confirmed this session; once both have,
  // the local copies are a mirror of that account (see `CACHE_OWNER_KEY`)
  const serverSyncedRef = useRef<Set<'restaurants' | 'bookmarks'>>(new Set());
  const markServerSynced = (uid: string, part: 'restaurants' | 'bookmarks') => {
    serverSyncedRef.current.add(part);
    if (serverSyncedRef.current.size === 2 && readCacheOwner() !== uid) writeCacheOwner(uid);
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
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      cloudLoadedRef.current = false;
      serverSyncedRef.current = new Set();
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

  // Load user profile doc (friends, handle, defaultCity, seenFollowerIds) when signed in
  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      userDocRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (typeof data.defaultCity === 'string') {
          setDefaultCity(data.defaultCity);
        }
        if (typeof data.linearRatingScale === 'boolean') {
          setLinearRatingScale(data.linearRatingScale);
        }
        if (typeof data.useCurrentLocation === 'boolean') {
          setUseCurrentLocation(data.useCurrentLocation);
        } else {
          setUseCurrentLocation(true);
        }
        if (typeof data.handle === 'string' && data.handle.trim()) {
          setUserHandle(data.handle.trim());
        }
        if (Array.isArray(data.seenFollowerIds)) {
          setSeenFollowerIds((prev) => {
            const next = new Set(prev);
            for (const uid of data.seenFollowerIds) {
              if (typeof uid === 'string') next.add(uid);
            }
            localStorage.setItem(LOCAL_SEEN_FOLLOWERS_KEY, JSON.stringify(Array.from(next)));
            return next;
          });
        }
        if (Array.isArray(data.friends)) {
          // Once this device mirrors the account the cloud list wins, so unfollows made on other
          // devices stick; signed-out follows are merged in until then
          const keepLocal = readCacheOwner() !== user.uid;
          setFriends((prev) => {
            const mergedMap = new Map<string, FriendProfile>();
            if (keepLocal) for (const f of prev) mergedMap.set(f.uid, f);
            for (const f of data.friends) {
              if (f && typeof f.uid === 'string') {
                mergedMap.set(f.uid, f as FriendProfile);
              }
            }
            const next = Array.from(mergedMap.values()).sort((a, b) => b.addedAt - a.addedAt);
            localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(next));
            return next;
          });
        }
      },
      () => {}
    );
    return () => unsub();
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
      localStorage.setItem(LOCAL_SEEN_FOLLOWERS_KEY, JSON.stringify(arr));
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

  // Live subscription to each followed friend's list (one doc each, only re-sent when it changes)
  const friendDocKey = friends
    .map((f) => `${f.uid}=${f.shareId || f.uid}`)
    .sort()
    .join('|');
  useEffect(() => {
    if (!friendDocKey) return;
    const unsubs = friendDocKey.split('|').map((pair) => {
      const [friendUid, shareDocId] = pair.split('=');
      return onSnapshot(
        doc(db, 'sharedLists', shareDocId),
        (snap) => {
          if (!snap.exists()) return;
          const parsed = parseSharedListDoc(snap.id, snap.data());
          setFriendListsMap((prev) => ({ ...prev, [friendUid]: parsed }));
        },
        () => {}
      );
    });
    return () => unsubs.forEach((unsub) => unsub());
  }, [friendDocKey]);

  // People following me: edges in profiles/{me}/followers, shown with their public profiles
  const [followers, setFollowers] = useState<SharedListPayload[]>([]);
  useEffect(() => {
    if (!user) {
      setFollowers([]);
      return;
    }
    let cancelled = false;
    const unsub = onSnapshot(
      collection(db, 'profiles', user.uid, 'followers'),
      (snapshot) => {
        const uids = snapshot.docs.map((d) => d.id);
        fetchProfiles(db, uids)
          .then((profiles) => {
            if (!cancelled) setFollowers(profiles);
          })
          .catch(() => {});
      },
      () => {}
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user]);

  // Follows made before follower edges existed (or on an older app version) get their edge once
  useEffect(() => {
    if (!user || friends.length === 0) return;
    const done = readSyncedFollowEdges();
    const missing = friends.map((f) => f.uid).filter((uid) => uid && !done.has(uid));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((uid) =>
        setFollowEdge(db, user.uid, uid, true).then(
          () => uid,
          () => null
        )
      )
    ).then((synced) => writeSyncedFollowEdges([...done, ...synced.filter((u): u is string => !!u)]));
  }, [user, friends]);

  // Firestore subscription for Ranked Restaurants
  useEffect(() => {
    if (!user) return;

    const colRef = collection(db, 'users', user.uid, 'restaurants');
    // Metadata changes are needed to learn when the server confirms what the cache showed
    let applied = false;
    // Scores are recomputed on load (the scoring model can change between versions); once per
    // load, save any that moved so the stored docs, and the community averages built from them,
    // stay current
    let storedScoresChecked = false;
    const refreshStoredScores = (snapshot: QuerySnapshot) => {
      const { fromCache, hasPendingWrites } = snapshot.metadata;
      if (storedScoresChecked || fromCache || hasPendingWrites || snapshot.empty) return;
      storedScoresChecked = true;
      const storedById = new Map(snapshot.docs.map((d) => [d.id, d.data()]));
      const stale = staleDerivedScores(storedById, loadRestaurants([...storedById.values()]));
      if (stale.length === 0) return;
      commitInBatches(
        db,
        stale.map(({ id, fields }) => (b: WriteBatch) =>
          b.update(doc(db, 'users', user.uid, 'restaurants', id), { ...fields })
        )
      ).catch(logWriteError('refresh stored scores'));
    };
    const unsub = onSnapshot(
      colRef,
      { includeMetadataChanges: true },
      async (snapshot) => {
        const { fromCache } = snapshot.metadata;
        refreshStoredScores(snapshot);
        if (applied && snapshot.docChanges().length === 0) {
          if (!fromCache) markServerSynced(user.uid, 'restaurants');
          return;
        }
        if (snapshot.empty) {
          // An empty offline cache says nothing about the account; wait for the server
          if (fromCache && !applied) return;
          // Only on first load: later empties are deletions, never a reason to re-upload
          const localRaw =
            !applied && shouldSeedCloudFromLocal(readCacheOwner(), fromCache)
              ? localStorage.getItem(LOCAL_STORAGE_KEY)
              : null;
          if (localRaw) {
            try {
              const localItems = loadRestaurants(JSON.parse(localRaw) as any[]);
              if (localItems.length > 0) {
                await commitInBatches(
                  db,
                  localItems.map((item) => (b) =>
                    b.set(doc(db, 'users', user.uid, 'restaurants', item.id), stripUndefined(item))
                  )
                );
                return;
              }
            } catch {
              // Ignore
            }
          }
          applied = true;
          cloudLoadedRef.current = true;
          restaurantsRef.current = [];
          setRestaurants([]);
          localStorage.setItem(LOCAL_STORAGE_KEY, '[]');
          if (!fromCache) markServerSynced(user.uid, 'restaurants');
          return;
        }

        const rawDocs: any[] = [];
        const legacyDocIds: string[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          rawDocs.push(data);
          if (isLegacyDoc(data)) legacyDocIds.push(docSnap.id);
        });
        const normalized = loadRestaurants(rawDocs);

        // One-time migration from legacy meal occasions to separate category lists:
        // drop the old meal-keyed docs and write the re-keyed, per-category ranked docs.
        if (legacyDocIds.length > 0) {
          try {
            const keepIds = new Set(normalized.map((r) => r.id));
            await commitInBatches(db, [
              ...legacyDocIds
                .filter((id) => !keepIds.has(id))
                .map((id) => (b: WriteBatch) => b.delete(doc(db, 'users', user.uid, 'restaurants', id))),
              ...normalized.map((item) => (b: WriteBatch) =>
                b.set(doc(db, 'users', user.uid, 'restaurants', item.id), stripUndefined(item))
              ),
            ]);
            return; // The snapshot listener fires again with the migrated docs
          } catch (err) {
            console.error('Failed to migrate restaurants to category lists:', err);
          }
        }

        applied = true;
        cloudLoadedRef.current = true;
        setRestaurants(normalized);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        if (!fromCache) markServerSynced(user.uid, 'restaurants');
      },
      (err) => {
        console.error('Firestore subscription error:', err);
      }
    );

    return () => unsub();
  }, [user]);

  // Firestore subscription for Bookmarks (Want to Try)
  useEffect(() => {
    if (!user) return;

    const colRef = collection(db, 'users', user.uid, 'bookmarks');
    // Metadata changes are needed to learn when the server confirms what the cache showed
    let applied = false;
    const unsub = onSnapshot(
      colRef,
      { includeMetadataChanges: true },
      async (snapshot) => {
        const { fromCache } = snapshot.metadata;
        if (applied && snapshot.docChanges().length === 0) {
          if (!fromCache) markServerSynced(user.uid, 'bookmarks');
          return;
        }
        if (snapshot.empty) {
          // An empty offline cache says nothing about the account; wait for the server
          if (fromCache && !applied) return;
          // Only on first load: later empties are deletions, never a reason to re-upload
          const localRaw =
            !applied && shouldSeedCloudFromLocal(readCacheOwner(), fromCache)
              ? localStorage.getItem(LOCAL_BOOKMARKS_KEY)
              : null;
          if (localRaw) {
            try {
              const localItems = loadBookmarks(JSON.parse(localRaw) as any[]);
              if (localItems.length > 0) {
                await commitInBatches(
                  db,
                  localItems.map((item) => (b) =>
                    b.set(doc(db, 'users', user.uid, 'bookmarks', item.id), stripUndefined(item))
                  )
                );
                return;
              }
            } catch {
              // Ignore
            }
          }
          applied = true;
          setBookmarks([]);
          localStorage.setItem(LOCAL_BOOKMARKS_KEY, '[]');
          if (!fromCache) markServerSynced(user.uid, 'bookmarks');
          return;
        }

        const loaded: BookmarkEntry[] = [];
        const legacyBookmarks: BookmarkEntry[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (isFromNewerVersion(data)) return;
          const bm = sanitizeLoadedBookmark(data);
          loaded.push(bm);
          if (isLegacyDoc(data)) legacyBookmarks.push(bm);
        });
        // One-time migration: rewrite legacy bookmarks without the old meal fields
        if (legacyBookmarks.length > 0) {
          commitInBatches(
            db,
            legacyBookmarks.map((bm) => (b) =>
              b.set(doc(db, 'users', user.uid, 'bookmarks', bm.id), stripUndefined(bm))
            )
          ).catch(logWriteError('migrate legacy bookmarks'));
        }
        applied = true;
        loaded.sort((a, b) => b.createdAt - a.createdAt);
        setBookmarks(loaded);
        localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(loaded));
        if (!fromCache) markServerSynced(user.uid, 'bookmarks');
      },
      (err) => {
        console.error('Firestore bookmarks subscription error:', err);
      }
    );

    return () => unsub();
  }, [user]);

  // Public docs friends read: sharedLists/{uid} (the list behind your link) and profiles/{uid}
  // (search, follower lists). The profile is only rewritten when it changes.
  const lastProfileJsonRef = useRef('');
  const trimWarnedRef = useRef(false);
  const publishPublicDocs = async (overrideHandle?: string) => {
    if (!user) return null;
    const ownerName = user.displayName ? user.displayName.split(' ')[0] : 'Friend';
    const effectiveHandle =
      sanitizeHandle(overrideHandle || userHandle) || deriveDefaultHandle(user.displayName, user.email);
    const lists = buildPublicLists(restaurants, bookmarks);
    if (lists.trimmed !== 'none' && !trimWarnedRef.current) {
      trimWarnedRef.current = true;
      showToast(PUBLIC_TRIM_MESSAGE[lists.trimmed], undefined, 6000);
    }

    const payload: Record<string, any> = {
      id: user.uid,
      ownerUid: user.uid,
      ownerName,
      displayName: user.displayName || ownerName,
      handle: effectiveHandle,
      restaurants: lists.restaurants,
      bookmarks: lists.bookmarks,
      // Who you follow is public on profiles/{uid}; drop the old copy here
      followingIds: deleteField(),
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    if (user.photoURL) payload.photoURL = user.photoURL;

    const profile = buildProfileDoc({
      handle: effectiveHandle,
      displayName: user.displayName || ownerName,
      photoURL: user.photoURL,
      followingIds: friends.map((f) => f.uid),
      rankedCount: restaurants.length,
    });
    const profileJson = JSON.stringify(profile);
    const writes: Promise<unknown>[] = [
      setDoc(doc(db, 'sharedLists', user.uid), payload, { merge: true }),
    ];
    if (profileJson !== lastProfileJsonRef.current) {
      writes.push(
        setDoc(doc(db, 'profiles', user.uid), { ...profile, updatedAt: Date.now() }).then(() => {
          lastProfileJsonRef.current = profileJson;
        })
      );
    }
    await Promise.all(writes);
    return lists;
  };

  useEffect(() => {
    if (!user || !cloudLoadedRef.current) return;
    if (restaurants.length === 0 && bookmarks.length === 0 && friends.length === 0) return;

    const timer = setTimeout(() => {
      publishPublicDocs().catch(logWriteError('shared list sync'));
    }, 900);

    return () => clearTimeout(timer);
  }, [user, restaurants, bookmarks, userHandle, friends]);

  // `ordered` may contain every category; each category list is re-scored independently
  // Only docs whose contents changed (plus `deletedId`) are written to Firestore
  const persistOrderedRestaurants = async (ordered: RestaurantEntry[], deletedId?: string) => {
    const recomputed = recomputeAllCategoryScores(ordered);
    const changed = changedDocs(recomputed, restaurantsRef.current);
    const deleted = deletedId ? restaurantsRef.current.find((r) => r.id === deletedId) : undefined;
    restaurantsRef.current = recomputed;
    setRestaurants(recomputed);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(recomputed));

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
        console.error('Failed to persist to Firestore:', err);
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
      category: primaryCategory,
      categories: candidate.categories?.length ? candidate.categories : [primaryCategory],
      cuisines: candidate.cuisines || [],
      primaryTypeDisplay: candidate.primaryTypeDisplay,
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
    localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(nextBookmarks));

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
    setIsAddModalOpen(false);
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
        b.name.trim().toLowerCase() === spot.name.trim().toLowerCase()
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
      // The spot's own list first, so the bookmark lands in the same category
      categories: Array.from(new Set([fallbackCategory, ...(spot.categories || [])])),
      cuisines: spot.cuisines || [],
      primaryTypeDisplay: spot.primaryTypeDisplay,
      source: 'source' in spot ? spot.source : 'google_places',
    };
    handleAddBookmark(candidate, { name: friendName, uid: friendUid });
  };

  // Keeps profiles/{friend}/followers/{me} in step with following, and remembers which edges exist
  const syncFollowEdge = (friendUid: string, following: boolean) => {
    if (!user) return;
    setFollowEdge(db, user.uid, friendUid, following)
      .then(() => {
        const synced = readSyncedFollowEdges();
        if (following) synced.add(friendUid);
        else synced.delete(friendUid);
        writeSyncedFollowEdges(synced);
      })
      .catch(logWriteError(following ? 'follower edge' : 'remove follower edge'));
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
    localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(nextFriends));
    // A profile-only result has no spots yet; the friend's list subscription fills it in
    if (!listPayload.profileOnly) {
      setFriendListsMap((prev) => ({
        ...prev,
        [friendUid]: listPayload,
      }));
    }

    if (user) {
      setDoc(
        doc(db, 'users', user.uid),
        {
          friends: nextFriends,
          followingIds: nextFriends.map((f) => f.uid),
          updatedAt: Date.now(),
        },
        { merge: true }
      ).catch(logWriteError('follow friend'));
      syncFollowEdge(friendUid, true);
    }

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
    localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(nextFriends));

    if (user) {
      setDoc(
        doc(db, 'users', user.uid),
        {
          friends: nextFriends,
          followingIds: nextFriends.map((f) => f.uid),
          updatedAt: Date.now(),
        },
        { merge: true }
      ).catch(logWriteError('unfollow friend'));
      syncFollowEdge(friendUid, false);
    }

    if (removed) {
      trackEvent('unfollow_friend', { friend_uid: friendUid });
      showToast(
        `Unfollowed ${removed.name}`,
        {
          label: 'Undo',
          onClick: () => {
            setFriends(prevFriends);
            localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(prevFriends));
            if (user) {
              setDoc(
                doc(db, 'users', user.uid),
                {
                  friends: prevFriends,
                  followingIds: prevFriends.map((f) => f.uid),
                  updatedAt: Date.now(),
                },
                { merge: true }
              ).catch(logWriteError('undo unfollow'));
              syncFollowEdge(friendUid, true);
            }
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

  const handleSearchPublicLists = async (rawQuery: string): Promise<SharedListPayload[]> => {
    const trimmed = rawQuery.trim();
    if (!trimmed) return [];

    // Support pasting a full share link (?list=<shareId>)
    let extractedListId: string | null = null;
    try {
      if (trimmed.includes('list=')) {
        const u = new URL(trimmed.startsWith('http') ? trimmed : `https://eatwithjelly.com/${trimmed}`);
        extractedListId = u.searchParams.get('list');
      }
    } catch {
      // Ignore URL parse error
    }

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
    localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(nextBookmarks));

    if (user) {
      deleteDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId)).catch(logWriteError('delete bookmark'));
    }
    if (target) {
      trackEvent('delete_bookmark', { restaurant_name: target.name });
      showToast(
        `Removed ${target.name}`,
        {
          label: 'Undo',
          onClick: () => {
            setBookmarks(prevBookmarks);
            localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(prevBookmarks));
            if (user) {
              setDoc(doc(db, 'users', user.uid, 'bookmarks', target.id), stripUndefined(target)).catch(
                logWriteError('undo delete bookmark')
              );
            }
            showToast(`Restored ${target.name}`);
          },
        },
        5000
      );
    }
  };

  const handleDeleteBookmark = (bookmarkId: string) => {
    executeDeleteBookmark(bookmarkId);
  };

  const handleStartRankFromBookmark = (bookmark: BookmarkEntry) => {
    setRankingBookmark(bookmark);
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
      category: bookmark.category,
      categories: bookmark.categories,
      cuisines: bookmark.cuisines,
      primaryTypeDisplay: bookmark.primaryTypeDisplay,
      initialRating: 8,
      elo: 1500,
      rankIndex: 0,
      magicScore: 8,
      comparisonsCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setReRankingEntry(pseudoEntry);
    setIsAddModalOpen(true);
  };

  const handlePublishShareLink = async (overrideHandle?: string): Promise<string | null> => {
    if (!user) {
      showToast('Sign in with Google to create a live share link');
      return null;
    }

    const lists = await publishPublicDocs(overrideHandle);
    trackEvent('publish_share_link', {
      restaurants_count: lists?.restaurants.length ?? 0,
      bookmarks_count: lists?.bookmarks.length ?? 0,
    });

    const shareId = user.uid;
    const baseUrl = window.location.origin;
    return `${baseUrl}/?list=${shareId}`;
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
          (name && b.name.toLowerCase() === name.toLowerCase())
      );
    setRankingBookmark(null);
    if (match) {
      const next = bookmarks.filter((b) => b.id !== match.id);
      setBookmarks(next);
      localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(next));
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

    // Check if existingIdToReplace is actually in restaurants (vs. a bookmark conversion)
    const actualExisting = restaurants.find((r) => r.id === existingIdToReplace);
    const effectiveReplaceId = actualExisting ? existingIdToReplace : undefined;

    trackEvent('complete_initial_questions', {
      restaurant_name: candidate.name,
      category: selectedCategory,
      initial_rating: initialRating,
      is_rerank: Boolean(effectiveReplaceId),
    });

    // Re-ranking into a different list replaces the old entry too
    const pool = getCategoryList(restaurants, selectedCategory).filter(
      (r) => r.id !== effectiveReplaceId
    );

    // If this is the very first spot in this category list, save immediately without needing SxS
    if (pool.length === 0) {
      const now = Date.now();
      const prevHistory = actualExisting?.rankedHistory?.length
        ? actualExisting.rankedHistory
        : actualExisting
        ? [{ timestamp: actualExisting.createdAt, initialRating: actualExisting.initialRating }]
        : [];
      const entryId = buildEntryId(candidate.placeId, selectedCategory);
      const newEntry: RestaurantEntry = {
        id: entryId,
        placeId: candidate.placeId,
        name: candidate.name,
        formattedAddress: candidate.formattedAddress,
        neighborhood: candidate.neighborhood,
        city: candidate.city,
        lat: candidate.lat,
        lng: candidate.lng,
        googleMapsUri: candidate.googleMapsUri,
        priceLevel: candidate.priceLevel,
        category: selectedCategory,
        categories: Array.from(new Set([selectedCategory, ...(candidate.categories || [])])),
        cuisines: candidate.cuisines,
        primaryTypeDisplay: candidate.primaryTypeDisplay,
        initialRating,
        elo: ratingToBaseElo(initialRating),
        rankIndex: 0,
        magicScore: initialRating,
        comparisonsCount: 0,
        rankedHistory: [...prevHistory, { timestamp: now, initialRating }],
        createdAt: actualExisting?.createdAt || now,
        updatedAt: now,
      };
      await persistOrderedRestaurants(
        [...restaurants.filter((r) => r.id !== effectiveReplaceId && r.id !== entryId), newEntry],
        effectiveReplaceId && effectiveReplaceId !== entryId ? effectiveReplaceId : undefined
      );
      setSelectedCategory(selectedCategory);
      await cleanupBookmarkIfRanked(candidate.placeId, candidate.name);
      setActiveTab('ranked');
      trackEvent('complete_ranking', {
        restaurant_name: candidate.name,
        category: selectedCategory,
        initial_rating: initialRating,
        magic_score: initialRating,
        rank_position: 1,
        comparisons_count: 0,
        is_rerank: Boolean(effectiveReplaceId),
      });
      showToast(`Added ${candidate.name} (#1 in ${CATEGORY_LABEL[selectedCategory]})`);
      return;
    }

    // Otherwise launch Q3+ (SxS comparisons)
    setPendingPlacement({
      candidate,
      initialRating,
      category: selectedCategory,
      cuisines: candidate.cuisines,
      existingIdToReplace: effectiveReplaceId,
    });
    setIsSxSOpen(true);
  };

  // Finish Q3+ SxS Placement
  const handleFinishPlacement = async (
    placement: PendingPlacement,
    insertIndexInCategory: number,
    comparisonsDone: number,
    finalCandidateElo: number,
    opponentEloAdjustments: Record<string, number>,
    answers: Array<{ opponentId: string; result: 0 | 0.5 | 1 }>
  ) => {
    setIsSxSOpen(false);
    setPendingPlacement(null);

    const now = Date.now();
    const existingObj = restaurants.find((r) => r.id === placement.existingIdToReplace);
    const prevHistory = existingObj?.rankedHistory?.length
      ? existingObj.rankedHistory
      : existingObj
      ? [{ timestamp: existingObj.createdAt, initialRating: existingObj.initialRating }]
      : [];

    const entryId = buildEntryId(placement.candidate.placeId, placement.category);

    // Apply opponent ELO adjustments from the head-to-head matches (same category list only)
    const basePool = getCategoryList(restaurants, placement.category)
      .filter((r) => r.id !== placement.existingIdToReplace && r.id !== entryId)
      .map((r) => {
        const delta = opponentEloAdjustments[r.id];
        return delta ? { ...r, elo: (r.elo || ratingToBaseElo(r.initialRating)) + delta } : r;
      });

    const newEntry: RestaurantEntry = {
      id: entryId,
      placeId: placement.candidate.placeId,
      name: placement.candidate.name,
      formattedAddress: placement.candidate.formattedAddress,
      neighborhood: placement.candidate.neighborhood,
      city: placement.candidate.city,
      lat: placement.candidate.lat,
      lng: placement.candidate.lng,
      googleMapsUri: placement.candidate.googleMapsUri,
      priceLevel: existingObj?.priceLevel ?? placement.candidate.priceLevel,
      category: placement.category,
      categories: Array.from(
        new Set([placement.category, ...(placement.candidate.categories || [])])
      ),
      cuisines: existingObj?.cuisines?.length ? existingObj.cuisines : placement.cuisines,
      primaryTypeDisplay: placement.candidate.primaryTypeDisplay,
      initialRating: placement.initialRating,
      elo: finalCandidateElo,
      rankIndex: insertIndexInCategory,
      magicScore: placement.initialRating,
      comparisonsCount: (existingObj?.comparisonsCount || 0) + comparisonsDone,
      notes: existingObj?.notes,
      favoriteDishes: existingObj?.favoriteDishes,
      rankedHistory: [...prevHistory, { timestamp: now, initialRating: placement.initialRating }],
      // A (re-)rank starts its answer history fresh: older answers about it no longer count
      comparisons: answers.map((a) => ({ ...a, at: now })),
      createdAt: existingObj?.createdAt || now,
      updatedAt: now,
    };

    const clampedIdx = Math.max(0, Math.min(basePool.length, insertIndexInCategory));
    const nextList = [...basePool];
    nextList.splice(clampedIdx, 0, newEntry);
    // The old entry may have lived in another list (re-ranked into a new category)
    const withoutOld = restaurants.filter((r) => r.id !== placement.existingIdToReplace);
    const recomputed = replaceCategoryList(withoutOld, placement.category, nextList);
    const placedItem = recomputed.find((r) => r.id === entryId);

    await persistOrderedRestaurants(
      recomputed,
      placement.existingIdToReplace && placement.existingIdToReplace !== entryId
        ? placement.existingIdToReplace
        : undefined
    );
    setSelectedCategory(placement.category);
    await cleanupBookmarkIfRanked(placement.candidate.placeId, placement.candidate.name);
    setActiveTab('ranked');
    trackEvent('complete_ranking', {
      restaurant_name: newEntry.name,
      category: newEntry.category,
      initial_rating: newEntry.initialRating,
      magic_score: placedItem ? placedItem.magicScore : newEntry.initialRating,
      rank_position: clampedIdx + 1,
      comparisons_count: comparisonsDone,
      is_rerank: Boolean(placement.existingIdToReplace),
    });
    showToast(
      `Ranked ${newEntry.name} #${clampedIdx + 1} in ${CATEGORY_LABEL[newEntry.category]} · ${
        placedItem ? placedItem.magicScore.toFixed(1) : newEntry.initialRating.toFixed(1)
      }`
    );
  };

  // Drag-and-drop reorder
  const handleReorderDragEnd = async (activeId: string, overId: string) => {
    if (sharedList) return;
    const activeItem = restaurants.find((r) => r.id === activeId);
    if (!activeItem) return;
    // Drag only ever reorders within a single category list
    const list = getCategoryList(restaurants, activeItem.category);
    const oldIndex = list.findIndex((r) => r.id === activeId);
    const newIndex = list.findIndex((r) => r.id === overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const moved = arrayMove(list, oldIndex, newIndex);
    // Interpolate ELO of the moved item to sit cleanly between its new neighbors, and remember the
    // drag as answers so earlier ones it overrides never get flagged as conflicts
    const targetItem = appendComparisons(
      moved[newIndex],
      dragComparisons(list, oldIndex, newIndex, Date.now())
    );
    const above = newIndex > 0 ? moved[newIndex - 1] : null;
    const below = newIndex < moved.length - 1 ? moved[newIndex + 1] : null;

    if (above && below) {
      targetItem.elo = Math.round(0.5 * (above.elo + below.elo));
    } else if (above) {
      targetItem.elo = above.elo - 30;
    } else if (below) {
      targetItem.elo = below.elo + 30;
    }
    moved[newIndex] = targetItem;

    trackEvent('manual_reorder', {
      restaurant_name: targetItem.name,
      from_rank: oldIndex + 1,
      to_rank: newIndex + 1,
    });
    await persistOrderedRestaurants(replaceCategoryList(restaurants, activeItem.category, moved));
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
      notes?: string;
    }
  ) => {
    const updated = restaurants.map((r) =>
      r.id === id
        ? {
            ...r,
            cuisines: updates.cuisines,
            priceLevel: updates.priceLevel,
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
    const prevRestaurants = [...restaurants];
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
    await persistOrderedRestaurants(remaining, id);
    showToast(
      `Removed ${target.name}`,
      {
        label: 'Undo',
        onClick: () => {
          persistOrderedRestaurants(prevRestaurants);
          showToast(`Restored ${target.name}`);
        },
      },
      5500
    );
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
  const activeRestaurants = sharedList ? sharedList.restaurants : restaurants;
  const activeBookmarks = sharedList ? sharedList.bookmarks || [] : bookmarks;

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
  }, [user, followers, newFollowerIds, friends]);

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

  const isDetailSpotBookmarkedByMe = useMemo(() => {
    if (!activeDetailSpot) return false;
    return Boolean(
      (activeDetailSpot.placeId && myBookmarkedPlaceIds.has(activeDetailSpot.placeId)) ||
        myBookmarkedNames.has(activeDetailSpot.name.trim().toLowerCase())
    );
  }, [activeDetailSpot, myBookmarkedPlaceIds, myBookmarkedNames]);

  const currentSourceItems = activeTab === 'ranked' ? activeRestaurants : activeBookmarks;

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

  const filteredRestaurants = useMemo(() => {
    const base = getCategoryList(activeRestaurants, selectedCategory).filter((r) => {
      if (selectedCity !== 'ALL' && r.city !== selectedCity) return false;
      if (selectedCuisine !== 'ALL' && !r.cuisines.includes(selectedCuisine)) return false;
      if (listSearchQuery.trim()) {
        const q = listSearchQuery.toLowerCase();
        const hay = `${r.name} ${r.formattedAddress} ${r.city || ''} ${r.cuisines.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortByNearest && userLocation) {
      return [...base].sort((a, b) => {
        const da = getItemDistanceMiles(a, userLocation);
        const db = getItemDistanceMiles(b, userLocation);
        if (da === null && db === null) return a.rankIndex - b.rankIndex;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    }

    return base;
  }, [
    activeRestaurants,
    selectedCity,
    selectedCategory,
    selectedCuisine,
    listSearchQuery,
    sortByNearest,
    userLocation,
  ]);

  const filteredBookmarks = useMemo(() => {
    const base = activeBookmarks.filter((b) => {
      if (selectedCity !== 'ALL' && b.city !== selectedCity) return false;
      if (b.category !== selectedCategory) return false;
      if (selectedCuisine !== 'ALL' && !b.cuisines.includes(selectedCuisine)) return false;
      if (listSearchQuery.trim()) {
        const q = listSearchQuery.toLowerCase();
        const hay = `${b.name} ${b.formattedAddress} ${b.city || ''} ${b.cuisines.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (userLocation) {
      return [...base].sort((a, b) => {
        const da = getItemDistanceMiles(a, userLocation);
        const db = getItemDistanceMiles(b, userLocation);
        if (da === null && db === null) return b.createdAt - a.createdAt;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    }

    return base;
  }, [
    activeBookmarks,
    selectedCity,
    selectedCategory,
    selectedCuisine,
    listSearchQuery,
    userLocation,
  ]);

  const isFiltered =
    selectedCity !== 'ALL' ||
    selectedCuisine !== 'ALL' ||
    listSearchQuery.trim().length > 0;

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateLocalSettings({
      defaultCity: defaultCity.trim(),
      darkMode,
      handle: userHandle,
      linearRatingScale,
      useCurrentLocation,
    });
    if (user) {
      setDoc(
        doc(db, 'users', user.uid),
        {
          defaultCity: defaultCity.trim(),
          darkMode,
          handle: userHandle,
          linearRatingScale,
          useCurrentLocation,
          updatedAt: Date.now(),
        },
        { merge: true }
      ).catch(logWriteError('settings'));
    }
    setIsSettingsOpen(false);
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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-24 transition-colors duration-200">
      {/* Shared List / Friend List Banner */}
      {sharedList && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-semibold">
          <div className="max-w-xl mx-auto w-full flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="truncate">
                Viewing {sharedList.ownerName}&rsquo;s List ({sharedList.restaurants.length} ranked)
              </span>
              {sharedList.handle && (
                <span className="text-emerald-100/90 text-[11px] font-medium hidden sm:inline">
                  @{sharedList.handle}
                </span>
              )}
              <div className="flex items-center gap-1.5 text-emerald-100/90 text-[11px]">
                <FollowCounts
                  uid={sharedList.ownerUid || sharedList.id}
                  followersTitle={`${sharedList.ownerName}'s Followers`}
                  followingTitle={`${sharedList.ownerName} is Following`}
                  onOpenFollowList={(title, users) => setFollowListDialog({ isOpen: true, title, users })}
                  buttonClassName="hover:underline font-medium"
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {sharedList.ownerUid !== user?.uid && (
                <button
                  type="button"
                  onClick={() => {
                    if (isViewingSharedOwnerFollowed) {
                      handleUnfollowFriend(sharedList.ownerUid || sharedList.id);
                    } else {
                      handleFollowFriend(sharedList);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                    isViewingSharedOwnerFollowed
                      ? 'bg-white/20 hover:bg-white/30 text-white'
                      : 'bg-white text-emerald-700 hover:bg-emerald-50 shadow-2xs'
                  }`}
                >
                  {isViewingSharedOwnerFollowed ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Following</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3 h-3" />
                      <span>Follow {sharedList.ownerName}</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const friendUid = sharedList.ownerUid || sharedList.id;
                  if (!isViewingSharedOwnerFollowed && friendUid !== user?.uid) {
                    handleFollowFriend(sharedList);
                  }
                  setEatTogetherFriendUid(friendUid);
                  setIsEatTogetherOpen(true);
                }}
                className="px-2.5 py-1 rounded-full bg-zinc-950/30 hover:bg-zinc-950/45 text-white text-[11px] font-bold inline-flex items-center gap-1 transition-colors"
                title={`Compare & blend lists with ${sharedList.ownerName}`}
              >
                <Sparkles className="w-3 h-3 text-amber-300" />
                <span>Blend</span>
              </button>

              <button
                type="button"
                onClick={exitSharedListView}
                className="px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold transition-colors"
              >
                My List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ultra-Minimal Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/80">
        <div className="max-w-xl mx-auto px-4 py-2 sm:py-0 sm:h-14 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-2">
          {/* Clean Wordmark with Jelly Bean Emblem */}
          <button
            type="button"
            onClick={() => {
              if (sharedList) exitSharedListView();
            }}
            className="h-10 flex items-center gap-2 text-left shrink-0"
          >
            <JellyBeanIcon size={22} />
            <span className="font-display font-extrabold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
              jelly
            </span>
          </button>

          {/* Group Switcher: Eat · Explore · Travel. Its own full-width row on phones; inline (only the
              active group named) from sm up */}
          <div
            role="tablist"
            aria-label="Group"
            className="order-last w-full grid grid-cols-3 sm:order-none sm:w-auto sm:mr-auto sm:inline-flex p-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80"
          >
            {ALL_GROUPS.map((group) => {
              const active = group === selectedGroup;
              return (
                <button
                  key={group}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={GROUP_LABEL[group]}
                  title={GROUP_LABEL[group]}
                  onClick={() => selectGroup(group)}
                  className={`h-7 rounded-full text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                    active
                      ? 'px-2.5 bg-emerald-500 text-white dark:text-zinc-950 shadow-2xs'
                      : 'px-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span aria-hidden="true" className="text-sm leading-none">
                    {GROUP_EMOJI[group]}
                  </span>
                  <span className={active ? '' : 'sm:hidden'}>{GROUP_LABEL[group]}</span>
                </button>
              );
            })}
          </div>

          {/* Minimal Controls */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            {(activeRestaurants.length > 0 || activeBookmarks.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setIsSearchExpanded((prev) => {
                    if (prev) setListSearchQuery('');
                    return !prev;
                  });
                }}
                className={`p-1.5 sm:p-2 rounded-full transition-colors ${
                  isSearchExpanded || listSearchQuery
                    ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                }`}
                aria-label="Filter list"
                title="Filter list"
              >
                <Search className="w-4 h-4" />
              </button>
            )}

            {/* Friends Modal Trigger */}
            <button
              type="button"
              onClick={() => {
                trackEvent('open_friends_modal');
                setIsFriendsOpen(true);
              }}
              className="relative p-1.5 sm:p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              aria-label="Friends"
              title="Friends"
            >
              <Users className="w-4 h-4" />
              {newFollowerIds.size > 0 ? (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-extrabold flex items-center justify-center ring-2 ring-zinc-50 dark:ring-zinc-950"
                  title={`${newFollowerIds.size} new follower${newFollowerIds.size === 1 ? '' : 's'}`}
                >
                  +{newFollowerIds.size}
                </span>
              ) : friends.length > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-extrabold flex items-center justify-center">
                  {friends.length}
                </span>
              ) : null}
            </button>

            {activeRestaurants.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  trackEvent('open_share_modal');
                  setIsShareOpen(true);
                }}
                className="p-1.5 sm:p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                aria-label="Share list"
                title="Share list"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-1.5 sm:p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              aria-label="Toggle dark mode"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {!isReadOnly && (
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="p-1.5 sm:p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                aria-label={hasUnseenChangelog ? 'Settings · new features' : 'Settings'}
                title="Settings"
              >
                <span className="relative block">
                  <Settings className="w-4 h-4" />
                  {hasUnseenChangelog && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950" />
                  )}
                </span>
              </button>
            )}

            {!authLoading &&
              !isReadOnly &&
              (user ? (
                <button
                  type="button"
                  onClick={requestSignOut}
                  className="p-1 rounded-full hover:opacity-80 transition-opacity"
                  title={`Signed in as ${user.email} · Click to sign out`}
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-7 h-7 rounded-full border border-zinc-200 dark:border-zinc-700"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                      {(user.displayName || user.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" />
                  <span>Sign in</span>
                </button>
              ))}

            {!isReadOnly && (
              <button
                type="button"
                onClick={() => {
                  trackEvent('open_add_modal');
                  setReRankingEntry(null);
                  setRankingBookmark(null);
                  setIsAddModalOpen(true);
                }}
                className="ml-0.5 sm:ml-1 px-3.5 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 transition-all shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                <span>Add</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Centered Feed */}
      <main className="max-w-xl mx-auto px-4 pt-3.5 space-y-3">
        {/* Friend Switcher Bar + Eat Together Pill (shown whenever user follows 1+ friends or is viewing a shared list) */}
        {(friends.length > 0 || sharedList) && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
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

        {/* Top Row: Ranked vs. Want to Try Segmented Control + List/Map Toggle */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex p-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80">
            <button
              type="button"
              onClick={() => {
                setActiveTab('ranked');
                trackEvent('switch_tab', { tab: 'ranked' });
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
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
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
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
          </div>

          {/* List <-> Map Toggle */}
          <div className="inline-flex p-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80">
            <button
              type="button"
              onClick={() => {
                setViewMode('list');
                trackEvent('switch_view_mode', { mode: 'list' });
              }}
              className={`px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${
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
              className={`px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${
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
        </div>

        {/* Expandable Search Input */}
        {isSearchExpanded && (
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={listSearchQuery}
              onChange={(e) => setListSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'ranked'
                  ? 'Filter your ranked list...'
                  : `Filter your ${groupCopy.want.toLowerCase()} list...`
              }
              autoFocus
              className="w-full pl-9 pr-8 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
            />
            {listSearchQuery && (
              <button
                type="button"
                onClick={() => setListSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Category Lists: single-select tabs (each list is ranked completely separately) */}
        <div
          role="tablist"
          aria-label="List"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1"
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
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {/* Near Me / Sort by Nearest Pill */}
              {viewMode === 'list' && (
                <button
                  type="button"
                  onClick={() => {
                    if (!userLocation) {
                      requestUserLocation({ enableSortByNearest: true });
                      return;
                    }
                    if (activeTab === 'ranked') {
                      const next = !sortByNearest;
                      setSortByNearest(next);
                      trackEvent('toggle_sort_nearest', { sort_by_nearest: next });
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1 transition-colors ${
                    (activeTab === 'ranked' ? sortByNearest && Boolean(userLocation) : Boolean(userLocation))
                      ? 'bg-blue-600 text-white dark:bg-blue-500 dark:text-zinc-950'
                      : 'bg-zinc-200/70 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                  title={
                    !userLocation
                      ? 'Use my location to sort by nearest'
                      : activeTab === 'ranked'
                      ? sortByNearest
                        ? 'Sorted by nearest · Click to sort by rank'
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
        ) : viewMode === 'map' ? (
          <RestaurantMapView
            mode={activeTab}
            restaurants={filteredRestaurants}
            bookmarks={filteredBookmarks}
            darkMode={darkMode}
            userLocation={userLocation}
            selectedCity={selectedCity}
            worldScale={selectedGroup === 'travel'}
            onRequestLocation={() => requestUserLocation({ silent: false })}
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
            onRankBookmark={handleStartRankFromBookmark}
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
              setActiveDetailSpot(spot);
            }}
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

      <footer className="max-w-xl mx-auto px-4 pt-8 pb-6 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
        jelly – rank the restaurants, sights and places you've been ·{' '}
        <a href="/about" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          About
        </a>{' '}
        ·{' '}
        <a href="/privacy.html" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          Privacy
        </a>
      </footer>

      {/* Add & Rate Wizard (Search -> Q1: 1-10 -> Q2: List) */}
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
      />

      <OrderCheckModal
        isOpen={isOrderCheckOpen}
        list={selectedCategoryList}
        onAnswer={handleOrderCheckAnswer}
        onClose={() => setIsOrderCheckOpen(false)}
      />

      {/* Q3+: SxS Comparison Modal */}
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

      {/* Spot Detail / Re-Rank / Hidden Edit Sheet */}
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
        onClose={() => setActiveDetailSpot(null)}
        onReRank={(spot) => {
          trackEvent('open_rerank_modal', {
            restaurant_name: spot.name,
            category: spot.category,
          });
          setReRankingEntry(spot);
          setIsAddModalOpen(true);
        }}
        onSaveEdits={handleSaveSpotEdits}
        onDelete={handleDeleteRestaurant}
      />

      {/* Friends Directory & @Handle Modal */}
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

      {/* Eat Together / Group Blend Modal */}
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

      {/* Share List & Top 10 Snapshot Card Modal */}
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
        onPublishShareLink={() => handlePublishShareLink()}
      />

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
          handleViewUserList(selectedUser);
        }}
      />

      {/* Minimal Settings Modal */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-jelly-backdrop"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden animate-jelly-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Settings</h2>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={saveSettings} className="p-5 space-y-4">
              {/* Location Bias Card */}
              <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/70 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Navigation className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <span>Search Nearby First</span>
                        {useCurrentLocation && userLocation && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md text-[9px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            GPS
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {useCurrentLocation
                          ? userLocation
                            ? 'Using your device location'
                            : 'Will use device location when allowed'
                          : 'Off · searching by city name only'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!useCurrentLocation) {
                        if (typeof navigator === 'undefined' || !navigator.geolocation) {
                          showToast('Location is not supported by your browser');
                          return;
                        }
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const coords: UserCoordinates = {
                              lat: pos.coords.latitude,
                              lng: pos.coords.longitude,
                            };
                            setUserLocation(coords);
                            setUseCurrentLocation(true);
                            try {
                              sessionStorage.setItem(SESSION_COORDS_KEY, JSON.stringify(coords));
                            } catch {
                              // Ignore
                            }
                          },
                          () => {
                            showToast('Enable location permissions in your browser to use current location');
                            setUseCurrentLocation(true);
                          }
                        );
                      } else {
                        setUseCurrentLocation(false);
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      useCurrentLocation ? 'bg-emerald-600' : 'bg-zinc-200 dark:bg-zinc-700'
                    }`}
                    role="switch"
                    aria-checked={useCurrentLocation}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        useCurrentLocation ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-1 space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block">
                    {useCurrentLocation ? 'Fallback Search City' : 'Default Search City'}
                  </label>
                  <div className="relative flex items-center">
                    <MapPin className="w-3.5 h-3.5 text-zinc-400 absolute left-3 pointer-events-none" />
                    <input
                      type="text"
                      value={defaultCity}
                      onChange={(e) => setDefaultCity(e.target.value)}
                      placeholder={useCurrentLocation ? 'e.g. San Francisco (used if GPS off)' : 'e.g. San Francisco'}
                      className="w-full text-xs pl-8 pr-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
                    {useCurrentLocation
                      ? 'Searches prioritize nearby spots. If GPS is off or unavailable, jelly searches around this city.'
                      : 'All restaurant searches will be biased toward this city.'}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
                  Gut-Feeling Spectrum Scale
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
                  <button
                    type="button"
                    onClick={() => setLinearRatingScale(false)}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                      !linearRatingScale
                        ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    Tiered
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinearRatingScale(true)}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-all ${
                      linearRatingScale
                        ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    Linear
                  </button>
                </div>
                <div className="pt-1">
                  <div
                    className="relative h-8 w-full rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15"
                    style={{ backgroundImage: spectrumGradient(linearRatingScale), backgroundOrigin: 'border-box' }}
                  >
                    {RATING_TIERS.slice(1).map((tier) => (
                      <div
                        key={tier.name}
                        className="absolute top-1.5 bottom-1.5 w-px bg-white/35 dark:bg-black/25"
                        style={{ left: `${spectrumRatingToPct(tier.from, linearRatingScale)}%` }}
                      />
                    ))}
                  </div>
                  <div className="relative h-5 mt-1.5 text-[10px] font-semibold select-none">
                    {RATING_TIERS.map((zone) => (
                      <span
                        key={zone.name}
                        className={`absolute -translate-x-1/2 ${zone.zoneClass}`}
                        style={{ left: `${spectrumRatingToPct(zone.zoneRating, linearRatingScale)}%` }}
                      >
                        {zone.name}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-snug min-h-[2.75em]">
                  {linearRatingScale
                    ? 'Uniform spacing across the entire spectrum.'
                    : 'Each vibe tier gets room by how often people feel it, so the common middle is easier to tell apart.'}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  trackEvent('open_whats_new', { had_unseen: hasUnseenChangelog });
                  setIsWhatsNewOpen(true);
                  setHasUnseenChangelog(false);
                  updateLocalSettings({ lastSeenVersion: CURRENT_VERSION });
                }}
                className="w-full pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs text-left group"
              >
                <span className="flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  What’s new
                  {hasUnseenChangelog && (
                    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      New
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 tabular-nums">
                  v{displayVersion(CURRENT_VERSION)}
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>

              {user && (
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
                  <span className="truncate">{user.email}</span>
                  <button
                    type="button"
                    onClick={requestSignOut}
                    className="text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1 shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <WhatsNewModal isOpen={isWhatsNewOpen} onClose={() => setIsWhatsNewOpen(false)} />

      {/* PWA Mobile Install Nudge */}
      <PwaInstallBanner />

      {/* New deploy detected → one-tap reload */}
      <UpdateAvailableBanner />

      {/* Subtle Toast (with optional Undo action) */}
      {toastMessage && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-xl flex items-center gap-3 whitespace-nowrap">
          <span>{toastMessage}</span>
          {toastAction && (
            <button
              type="button"
              onClick={toastAction.onClick}
              className="px-2.5 py-0.5 -mr-1 rounded-full bg-emerald-500 text-zinc-950 font-bold hover:bg-emerald-400 transition-colors"
            >
              {toastAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
