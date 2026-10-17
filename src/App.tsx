import React, { useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { arrayMove } from '@dnd-kit/sortable';
import {
  Bookmark,
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
  Sun,
  X,
} from 'lucide-react';
import { auth, db, googleProvider, setAnalyticsUser, trackEvent } from './firebase';
import {
  ALL_MEAL_CATEGORIES,
  BookmarkEntry,
  MealCategory,
  normalizeMealCategory,
  PlaceCandidate,
  RestaurantEntry,
  SharedListPayload,
} from './types';
import { getItemDistanceMiles, UserCoordinates } from './lib/geo';
import { ratingToBaseElo, recomputeMagicScores } from './lib/rankingEngine';
import { AddAndRateModal } from './components/AddAndRateModal';
import { BookmarkList } from './components/BookmarkList';
import { JellyBeanIcon } from './components/JellyBeanIcon';
import { PendingPlacement, SxSArenaModal } from './components/SxSArenaModal';
import { RestaurantList } from './components/RestaurantList';
import { RestaurantMapView } from './components/RestaurantMapView';
import { ShareModal } from './components/ShareModal';
import { SpotDetailModal } from './components/SpotDetailModal';

const LOCAL_STORAGE_KEY = 'palatelo_restaurants_v2';
const LOCAL_BOOKMARKS_KEY = 'palatelo_bookmarks_v2';
const LOCAL_SETTINGS_KEY = 'palatelo_settings_v2';
const SESSION_COORDS_KEY = 'jelly_user_coords_v1';

function sanitizeLoadedRestaurant(raw: any): RestaurantEntry {
  const meal = normalizeMealCategory(raw.meal || raw.meals?.[0]);
  const normalizedMeals: MealCategory[] =
    Array.isArray(raw.meals) && raw.meals.length > 0
      ? Array.from(new Set(raw.meals.map((m: string) => normalizeMealCategory(m))))
      : [meal];
  const initialRating = typeof raw.initialRating === 'number' ? raw.initialRating : 8;
  const elo =
    typeof raw.elo === 'number' && !Number.isNaN(raw.elo)
      ? raw.elo
      : ratingToBaseElo(initialRating);

  return {
    ...raw,
    meal,
    meals: normalizedMeals,
    cuisines: Array.isArray(raw.cuisines) ? raw.cuisines : [],
    initialRating,
    elo,
  };
}

function sanitizeLoadedBookmark(raw: any): BookmarkEntry {
  const meal = normalizeMealCategory(raw.meal || raw.meals?.[0]);
  const normalizedMeals: MealCategory[] =
    Array.isArray(raw.meals) && raw.meals.length > 0
      ? Array.from(new Set(raw.meals.map((m: string) => normalizeMealCategory(m))))
      : [meal];
  return {
    ...raw,
    meal,
    meals: normalizedMeals,
    cuisines: Array.isArray(raw.cuisines) ? raw.cuisines : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.darkMode === 'boolean') return parsed.darkMode;
      }
    } catch {
      // Ignore
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const [restaurants, setRestaurants] = useState<RestaurantEntry[]>(() => {
    try {
      const raw =
        localStorage.getItem(LOCAL_STORAGE_KEY) ||
        localStorage.getItem('palate_personal_restaurants_v1');
      if (raw) {
        const parsed = (JSON.parse(raw) as any[]).map(sanitizeLoadedRestaurant);
        parsed.sort((a, b) => a.rankIndex - b.rankIndex);
        return recomputeMagicScores(parsed);
      }
    } catch {
      // Ignore
    }
    return [];
  });

  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_BOOKMARKS_KEY);
      if (raw) {
        const parsed = (JSON.parse(raw) as any[]).map(sanitizeLoadedBookmark);
        parsed.sort((a, b) => b.createdAt - a.createdAt);
        return parsed;
      }
    } catch {
      // Ignore
    }
    return [];
  });

  // Shared List Read-Only Mode (?list=<shareId>)
  const [sharedList, setSharedList] = useState<SharedListPayload | null>(null);
  const [sharedListLoading, setSharedListLoading] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('list'));
  });

  const [defaultCity, setDefaultCity] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (raw) return JSON.parse(raw).defaultCity || '';
    } catch {
      // Ignore
    }
    return '';
  });

  // View & Filter State
  const [activeTab, setActiveTab] = useState<'ranked' | 'want_to_try'>('ranked');
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [selectedMeal, setSelectedMeal] = useState<MealCategory | 'ALL'>('ALL');
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
  const [activeDetailSpot, setActiveDetailSpot] = useState<RestaurantEntry | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
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
          const data = snap.data();
          const loadedRestaurants = Array.isArray(data.restaurants)
            ? data.restaurants.map(sanitizeLoadedRestaurant)
            : [];
          loadedRestaurants.sort((a, b) => a.rankIndex - b.rankIndex);
          const loadedBookmarks = Array.isArray(data.bookmarks)
            ? data.bookmarks.map(sanitizeLoadedBookmark)
            : [];
          setSharedList({
            id: snap.id,
            ownerUid: data.ownerUid || '',
            ownerName: data.ownerName || 'Friend',
            title: data.title,
            restaurants: recomputeMagicScores(loadedRestaurants),
            bookmarks: loadedBookmarks,
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt || Date.now(),
          });
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
    url.searchParams.delete('list');
    window.history.replaceState({}, '', url.toString());
    setSharedList(null);
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      trackEvent('toggle_dark_mode', { dark_mode: next });
      localStorage.setItem(
        LOCAL_SETTINGS_KEY,
        JSON.stringify({ defaultCity, darkMode: next })
      );
      if (user) {
        setDoc(
          doc(db, 'users', user.uid),
          { darkMode: next, updatedAt: Date.now() },
          { merge: true }
        ).catch(() => {});
      }
      return next;
    });
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAnalyticsUser(u?.uid ?? null);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Firestore subscription for Ranked Restaurants
  useEffect(() => {
    if (!user) return;

    const colRef = collection(db, 'users', user.uid, 'restaurants');
    const unsub = onSnapshot(
      colRef,
      async (snapshot) => {
        if (snapshot.empty) {
          const localRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (localRaw) {
            try {
              const localItems = (JSON.parse(localRaw) as any[]).map(sanitizeLoadedRestaurant);
              if (localItems.length > 0) {
                const batch = writeBatch(db);
                for (const item of localItems) {
                  const cleanDoc: Record<string, any> = {};
                  Object.entries(item).forEach(([k, v]) => {
                    if (v !== undefined) cleanDoc[k] = v;
                  });
                  batch.set(doc(db, 'users', user.uid, 'restaurants', item.id), cleanDoc);
                }
                await batch.commit();
                return;
              }
            } catch {
              // Ignore
            }
          }
          setRestaurants([]);
          return;
        }

        const loaded: RestaurantEntry[] = [];
        snapshot.forEach((docSnap) => {
          loaded.push(sanitizeLoadedRestaurant(docSnap.data()));
        });
        loaded.sort((a, b) => a.rankIndex - b.rankIndex);
        const normalized = recomputeMagicScores(loaded);
        setRestaurants(normalized);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
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
    const unsub = onSnapshot(
      colRef,
      async (snapshot) => {
        if (snapshot.empty) {
          const localRaw = localStorage.getItem(LOCAL_BOOKMARKS_KEY);
          if (localRaw) {
            try {
              const localItems = (JSON.parse(localRaw) as any[]).map(sanitizeLoadedBookmark);
              if (localItems.length > 0) {
                const batch = writeBatch(db);
                for (const item of localItems) {
                  const cleanDoc: Record<string, any> = {};
                  Object.entries(item).forEach(([k, v]) => {
                    if (v !== undefined) cleanDoc[k] = v;
                  });
                  batch.set(doc(db, 'users', user.uid, 'bookmarks', item.id), cleanDoc);
                }
                await batch.commit();
                return;
              }
            } catch {
              // Ignore
            }
          }
          setBookmarks([]);
          return;
        }

        const loaded: BookmarkEntry[] = [];
        snapshot.forEach((docSnap) => {
          loaded.push(sanitizeLoadedBookmark(docSnap.data()));
        });
        loaded.sort((a, b) => b.createdAt - a.createdAt);
        setBookmarks(loaded);
        localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(loaded));
      },
      (err) => {
        console.error('Firestore bookmarks subscription error:', err);
      }
    );

    return () => unsub();
  }, [user]);

  const persistOrderedRestaurants = async (ordered: RestaurantEntry[], deletedId?: string) => {
    const recomputed = recomputeMagicScores(ordered);
    setRestaurants(recomputed);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(recomputed));

    if (user) {
      try {
        const batch = writeBatch(db);
        if (deletedId) {
          batch.delete(doc(db, 'users', user.uid, 'restaurants', deletedId));
        }
        for (const item of recomputed) {
          const cleanDoc: Record<string, any> = {};
          Object.entries(item).forEach(([k, v]) => {
            if (v !== undefined) cleanDoc[k] = v;
          });
          batch.set(doc(db, 'users', user.uid, 'restaurants', item.id), cleanDoc);
        }
        await batch.commit();
      } catch (err) {
        console.error('Failed to persist to Firestore:', err);
      }
    }
  };

  const handleAddBookmark = async (candidate: PlaceCandidate) => {
    const primaryMeal: MealCategory =
      candidate.meals && candidate.meals.length > 0 ? candidate.meals[0] : 'Dinner';
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
      meal: primaryMeal,
      meals: candidate.meals?.length ? candidate.meals : [primaryMeal],
      cuisines: candidate.cuisines || [],
      primaryTypeDisplay: candidate.primaryTypeDisplay,
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
      const cleanDoc: Record<string, any> = {};
      Object.entries(newBookmark).forEach(([k, v]) => {
        if (v !== undefined) cleanDoc[k] = v;
      });
      setDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId), cleanDoc).catch(() => {});
    }

    trackEvent('add_bookmark', {
      restaurant_name: candidate.name,
      city: candidate.city || '',
      meal: primaryMeal,
    });
    setIsAddModalOpen(false);
    showToast(`Saved ${candidate.name} to Want to Try`);
  };

  const handleDeleteBookmark = async (bookmarkId: string) => {
    const target = bookmarks.find((b) => b.id === bookmarkId);
    const nextBookmarks = bookmarks.filter((b) => b.id !== bookmarkId);
    setBookmarks(nextBookmarks);
    localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(nextBookmarks));

    if (user) {
      deleteDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkId)).catch(() => {});
    }
    if (target) {
      trackEvent('delete_bookmark', { restaurant_name: target.name });
      showToast(`Removed ${target.name}`);
    }
  };

  const handleStartRankFromBookmark = (bookmark: BookmarkEntry) => {
    setRankingBookmark(bookmark);
    const pseudoEntry: RestaurantEntry = {
      id: `${bookmark.placeId || bookmark.id}__${bookmark.meal}`,
      placeId: bookmark.placeId || bookmark.id,
      name: bookmark.name,
      formattedAddress: bookmark.formattedAddress,
      neighborhood: bookmark.neighborhood,
      city: bookmark.city,
      lat: bookmark.lat,
      lng: bookmark.lng,
      googleMapsUri: bookmark.googleMapsUri,
      priceLevel: bookmark.priceLevel,
      meal: bookmark.meal,
      meals: bookmark.meals,
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

  const handlePublishShareLink = async (): Promise<string | null> => {
    if (!user) {
      showToast('Sign in with Google to create a live share link');
      return null;
    }

    const shareId = user.uid;
    const ownerName = user.displayName ? user.displayName.split(' ')[0] : 'My';
    const cleanRestaurants = restaurants.slice(0, 500).map((r) => {
      const clean: Record<string, any> = {};
      Object.entries(r).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
      });
      return clean;
    });
    const cleanBookmarks = bookmarks.slice(0, 500).map((b) => {
      const clean: Record<string, any> = {};
      Object.entries(b).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
      });
      return clean;
    });

    await setDoc(doc(db, 'sharedLists', shareId), {
      id: shareId,
      ownerUid: user.uid,
      ownerName,
      restaurants: cleanRestaurants,
      bookmarks: cleanBookmarks,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });

    trackEvent('publish_share_link', {
      restaurants_count: cleanRestaurants.length,
      bookmarks_count: cleanBookmarks.length,
    });

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

  const handleSignOut = async () => {
    await signOut(auth);
    trackEvent('logout');
    showToast('Signed out');
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
        deleteDoc(doc(db, 'users', user.uid, 'bookmarks', match.id)).catch(() => {});
      }
    }
  };

  // Called when Q1 (1-10 rating) and Q2 (single meal) are completed
  const handleCompleteQuestions = async (
    candidate: PlaceCandidate,
    initialRating: number,
    selectedMealChoice: MealCategory,
    existingIdToReplace?: string
  ) => {
    setIsAddModalOpen(false);
    setReRankingEntry(null);

    // Check if existingIdToReplace is actually in restaurants (vs. a bookmark conversion)
    const actualExisting = restaurants.find((r) => r.id === existingIdToReplace);
    const effectiveReplaceId = actualExisting ? existingIdToReplace : undefined;

    trackEvent('complete_initial_questions', {
      restaurant_name: candidate.name,
      meal: selectedMealChoice,
      initial_rating: initialRating,
      is_rerank: Boolean(effectiveReplaceId),
    });

    const pool = restaurants.filter((r) => r.id !== effectiveReplaceId);

    // If this is the very first restaurant in the list, save immediately without needing SxS
    if (pool.length === 0) {
      const now = Date.now();
      const prevHistory = actualExisting?.rankedHistory?.length
        ? actualExisting.rankedHistory
        : actualExisting
        ? [{ timestamp: actualExisting.createdAt, initialRating: actualExisting.initialRating }]
        : [];
      const entryId = effectiveReplaceId || `${candidate.placeId}__${selectedMealChoice}`;
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
        meal: selectedMealChoice,
        meals: Array.from(new Set([selectedMealChoice, ...(candidate.meals || [])])),
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
      await persistOrderedRestaurants([newEntry]);
      await cleanupBookmarkIfRanked(candidate.placeId, candidate.name);
      setActiveTab('ranked');
      trackEvent('complete_ranking', {
        restaurant_name: candidate.name,
        meal: selectedMealChoice,
        initial_rating: initialRating,
        magic_score: initialRating,
        rank_position: 1,
        comparisons_count: 0,
        is_rerank: Boolean(effectiveReplaceId),
      });
      showToast(`Added ${candidate.name} (#1)`);
      return;
    }

    // Otherwise launch Q3+ (SxS comparisons)
    setPendingPlacement({
      candidate,
      initialRating,
      meal: selectedMealChoice,
      cuisines: candidate.cuisines,
      existingIdToReplace: effectiveReplaceId,
    });
    setIsSxSOpen(true);
  };

  // Finish Q3+ SxS Placement
  const handleFinishPlacement = async (
    placement: PendingPlacement,
    insertIndexInFullList: number,
    comparisonsDone: number,
    finalCandidateElo: number,
    opponentEloAdjustments: Record<string, number>
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

    // Apply opponent ELO adjustments from the head-to-head matches
    const basePool = restaurants
      .filter((r) => r.id !== placement.existingIdToReplace)
      .map((r) => {
        const delta = opponentEloAdjustments[r.id];
        return delta ? { ...r, elo: (r.elo || ratingToBaseElo(r.initialRating)) + delta } : r;
      });

    const entryId =
      placement.existingIdToReplace ||
      `${placement.candidate.placeId}__${placement.meal}`;

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
      meal: placement.meal,
      meals: Array.from(new Set([placement.meal, ...(placement.candidate.meals || [])])),
      cuisines: existingObj?.cuisines?.length ? existingObj.cuisines : placement.cuisines,
      primaryTypeDisplay: placement.candidate.primaryTypeDisplay,
      initialRating: placement.initialRating,
      elo: finalCandidateElo,
      rankIndex: insertIndexInFullList,
      magicScore: placement.initialRating,
      comparisonsCount: (existingObj?.comparisonsCount || 0) + comparisonsDone,
      notes: existingObj?.notes,
      favoriteDishes: existingObj?.favoriteDishes,
      rankedHistory: [...prevHistory, { timestamp: now, initialRating: placement.initialRating }],
      createdAt: existingObj?.createdAt || now,
      updatedAt: now,
    };

    const clampedIdx = Math.max(0, Math.min(basePool.length, insertIndexInFullList));
    const nextList = [...basePool];
    nextList.splice(clampedIdx, 0, newEntry);
    const recomputed = recomputeMagicScores(nextList);
    const placedItem = recomputed.find((r) => r.id === entryId);

    await persistOrderedRestaurants(recomputed);
    await cleanupBookmarkIfRanked(placement.candidate.placeId, placement.candidate.name);
    setActiveTab('ranked');
    trackEvent('complete_ranking', {
      restaurant_name: newEntry.name,
      meal: newEntry.meal,
      initial_rating: newEntry.initialRating,
      magic_score: placedItem ? placedItem.magicScore : newEntry.initialRating,
      rank_position: clampedIdx + 1,
      comparisons_count: comparisonsDone,
      is_rerank: Boolean(placement.existingIdToReplace),
    });
    showToast(
      `Ranked ${newEntry.name} (${newEntry.meal}) #${clampedIdx + 1} · ${
        placedItem ? placedItem.magicScore.toFixed(1) : newEntry.initialRating.toFixed(1)
      }`
    );
  };

  // Drag-and-drop reorder
  const handleReorderDragEnd = async (activeId: string, overId: string) => {
    if (sharedList) return;
    const oldIndex = restaurants.findIndex((r) => r.id === activeId);
    const newIndex = restaurants.findIndex((r) => r.id === overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const moved = arrayMove(restaurants, oldIndex, newIndex);
    // Interpolate ELO of the moved item to sit cleanly between its new neighbors
    const targetItem = { ...moved[newIndex] };
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
    await persistOrderedRestaurants(moved);
  };

  const handleSaveSpotEdits = async (
    id: string,
    updates: {
      meal: MealCategory;
      cuisines: string[];
      priceLevel?: number;
      notes?: string;
    }
  ) => {
    const updated = restaurants.map((r) =>
      r.id === id
        ? {
            ...r,
            meal: updates.meal,
            meals: Array.from(new Set([updates.meal, ...(r.meals || [])])),
            cuisines: updates.cuisines,
            priceLevel: updates.priceLevel,
            notes: updates.notes,
            updatedAt: Date.now(),
          }
        : r
    );
    trackEvent('edit_spot_details', {
      restaurant_id: id,
      meal: updates.meal,
    });
    await persistOrderedRestaurants(updated);
    showToast('Updated details');
  };

  const handleDeleteRestaurant = async (id: string) => {
    const target = restaurants.find((r) => r.id === id);
    if (!target) return;
    const remaining = restaurants.filter((r) => r.id !== id);
    trackEvent('delete_spot', {
      restaurant_name: target.name,
      meal: target.meal,
    });
    await persistOrderedRestaurants(remaining, id);
    showToast(`Removed ${target.name}`);
  };

  const isReadOnly = Boolean(sharedList);
  const activeRestaurants = sharedList ? sharedList.restaurants : restaurants;
  const activeBookmarks = sharedList ? sharedList.bookmarks || [] : bookmarks;

  const bookmarkedPlaceIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of activeBookmarks) {
      if (b.placeId) set.add(b.placeId);
    }
    return set;
  }, [activeBookmarks]);

  const currentSourceItems = activeTab === 'ranked' ? activeRestaurants : activeBookmarks;

  // City counts across active source items
  const cityCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of currentSourceItems) {
      if (item.city) {
        map.set(item.city, (map.get(item.city) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [currentSourceItems]);

  // Meal counts (respecting active city filter)
  const mealCounts = useMemo(() => {
    const map = new Map<MealCategory, number>();
    for (const m of ALL_MEAL_CATEGORIES) map.set(m, 0);
    for (const item of currentSourceItems) {
      if (selectedCity !== 'ALL' && item.city !== selectedCity) continue;
      map.set(item.meal, (map.get(item.meal) || 0) + 1);
    }
    return map;
  }, [currentSourceItems, selectedCity]);

  // Cuisines available in the currently selected meal & city
  const cuisineCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of currentSourceItems) {
      if (selectedCity !== 'ALL' && item.city !== selectedCity) continue;
      if (selectedMeal !== 'ALL' && item.meal !== selectedMeal) continue;
      for (const c of item.cuisines) {
        map.set(c, (map.get(c) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [currentSourceItems, selectedMeal, selectedCity]);

  const filteredRestaurants = useMemo(() => {
    const base = activeRestaurants.filter((r) => {
      if (selectedCity !== 'ALL' && r.city !== selectedCity) return false;
      if (selectedMeal !== 'ALL' && r.meal !== selectedMeal) return false;
      if (selectedCuisine !== 'ALL' && !r.cuisines.includes(selectedCuisine)) return false;
      if (listSearchQuery.trim()) {
        const q = listSearchQuery.toLowerCase();
        const hay = `${r.name} ${r.formattedAddress} ${r.city || ''} ${r.cuisines.join(' ')} ${r.meal}`.toLowerCase();
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
    selectedMeal,
    selectedCuisine,
    listSearchQuery,
    sortByNearest,
    userLocation,
  ]);

  const filteredBookmarks = useMemo(() => {
    const base = activeBookmarks.filter((b) => {
      if (selectedCity !== 'ALL' && b.city !== selectedCity) return false;
      if (selectedMeal !== 'ALL' && b.meal !== selectedMeal) return false;
      if (selectedCuisine !== 'ALL' && !b.cuisines.includes(selectedCuisine)) return false;
      if (listSearchQuery.trim()) {
        const q = listSearchQuery.toLowerCase();
        const hay = `${b.name} ${b.formattedAddress} ${b.city || ''} ${b.cuisines.join(' ')} ${b.meal}`.toLowerCase();
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
    selectedMeal,
    selectedCuisine,
    listSearchQuery,
    userLocation,
  ]);

  const isFiltered =
    selectedCity !== 'ALL' ||
    selectedMeal !== 'ALL' ||
    selectedCuisine !== 'ALL' ||
    listSearchQuery.trim().length > 0;

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem(
      LOCAL_SETTINGS_KEY,
      JSON.stringify({ defaultCity: defaultCity.trim(), darkMode })
    );
    if (user) {
      setDoc(
        doc(db, 'users', user.uid),
        { defaultCity: defaultCity.trim(), darkMode, updatedAt: Date.now() },
        { merge: true }
      ).catch(() => {});
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
      {/* Shared List Banner (when viewing ?list=<shareId>) */}
      {sharedList && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between">
          <div className="max-w-xl mx-auto w-full flex items-center justify-between gap-2">
            <span>
              Viewing {sharedList.ownerName}&rsquo;s Jelly List ({sharedList.restaurants.length} ranked)
            </span>
            <button
              type="button"
              onClick={exitSharedListView}
              className="px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold transition-colors"
            >
              Exit to My List
            </button>
          </div>
        </div>
      )}

      {/* Ultra-Minimal Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/80">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          {/* Clean Wordmark with Jelly Bean Emblem */}
          <div className="flex items-center gap-2">
            <JellyBeanIcon size={22} />
            <span className="font-display font-extrabold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
              jelly
            </span>
          </div>

          {/* Minimal Controls */}
          <div className="flex items-center gap-1">
            {(activeRestaurants.length > 0 || activeBookmarks.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setIsSearchExpanded((prev) => {
                    if (prev) setListSearchQuery('');
                    return !prev;
                  });
                }}
                className={`p-2 rounded-full transition-colors ${
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

            {activeRestaurants.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  trackEvent('open_share_modal');
                  setIsShareOpen(true);
                }}
                className="p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                aria-label="Share list"
                title="Share list"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              aria-label="Toggle dark mode"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {!isReadOnly && (
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            {!authLoading &&
              !isReadOnly &&
              (user ? (
                <button
                  type="button"
                  onClick={handleSignOut}
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
                {activeRestaurants.length}
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
              <span>Want to Try</span>
              {activeBookmarks.length > 0 && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                  {activeBookmarks.length}
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
                  : 'Filter your want-to-try list...'
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

        {/* Clean Filters: Meal Tabs + Near Me Toggle + City Filter Pill + Cuisine Chips */}
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

              <button
                type="button"
                onClick={() => {
                  setSelectedMeal('ALL');
                  setSelectedCuisine('ALL');
                  trackEvent('filter_meal', { meal: 'ALL' });
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors ${
                  selectedMeal === 'ALL'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-zinc-200/60 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                }`}
              >
                All
              </button>
              {ALL_MEAL_CATEGORIES.map((meal) => {
                const count = mealCounts.get(meal) || 0;
                if (count === 0 && selectedMeal !== meal) return null;
                const active = selectedMeal === meal;
                return (
                  <button
                    key={meal}
                    type="button"
                    onClick={() => {
                      const nextMeal = active ? 'ALL' : meal;
                      setSelectedMeal(nextMeal);
                      setSelectedCuisine('ALL');
                      trackEvent('filter_meal', { meal: nextMeal });
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors ${
                      active
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-zinc-200/60 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {meal}
                  </button>
                );
              })}
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
            onRequestLocation={() => requestUserLocation({ silent: false })}
            onSelectSpot={(spot) => {
              trackEvent('view_spot_detail', {
                restaurant_name: spot.name,
                meal: spot.meal,
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
            selectedMealFilter={selectedMeal}
            totalUnfilteredCount={activeRestaurants.length}
            onReorderDragEnd={handleReorderDragEnd}
            onSelectSpot={(spot) => {
              trackEvent('view_spot_detail', {
                restaurant_name: spot.name,
                meal: spot.meal,
                magic_score: spot.magicScore,
                rank_position: spot.rankIndex + 1,
              });
              setActiveDetailSpot(spot);
            }}
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
            selectedMealFilter={selectedMeal}
            totalUnfilteredCount={activeBookmarks.length}
            readOnly={isReadOnly}
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

      {/* Add & Rate Wizard (Search -> Q1: 1-10 -> Q2: Meal) */}
      <AddAndRateModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setReRankingEntry(null);
          setRankingBookmark(null);
        }}
        existingRestaurants={restaurants}
        bookmarkedPlaceIds={bookmarkedPlaceIds}
        reRankingEntry={reRankingEntry}
        defaultCity={defaultCity}
        userLocation={userLocation}
        onCompleteQuestions={handleCompleteQuestions}
        onAddBookmark={handleAddBookmark}
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
        onClose={() => setActiveDetailSpot(null)}
        onReRank={(spot) => {
          trackEvent('open_rerank_modal', {
            restaurant_name: spot.name,
            meal: spot.meal,
          });
          setReRankingEntry(spot);
          setIsAddModalOpen(true);
        }}
        onSaveEdits={handleSaveSpotEdits}
        onDelete={handleDeleteRestaurant}
      />

      {/* Share List & Top 10 Snapshot Card Modal */}
      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        restaurants={filteredRestaurants.length > 0 ? filteredRestaurants : activeRestaurants}
        bookmarks={activeBookmarks}
        selectedMeal={selectedMeal}
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
        onPublishShareLink={handlePublishShareLink}
      />

      {/* Minimal Settings Modal */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Settings</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={saveSettings} className="p-5 space-y-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1.5">
                  Default Search City
                </label>
                <input
                  type="text"
                  value={defaultCity}
                  onChange={(e) => setDefaultCity(e.target.value)}
                  placeholder="e.g. San Francisco, New York"
                  className="w-full text-xs px-3 py-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
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

              {user && (
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
                  <span className="truncate">{user.email}</span>
                  <button
                    type="button"
                    onClick={() => {
                      handleSignOut();
                      setIsSettingsOpen(false);
                    }}
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

      {/* Subtle Toast */}
      {toastMessage && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  );
};
