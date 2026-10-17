import React, { useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { arrayMove } from '@dnd-kit/sortable';
import {
  Download,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { auth, db, googleProvider, setAnalyticsUser, trackEvent } from './firebase';
import {
  ALL_MEAL_CATEGORIES,
  MealCategory,
  normalizeMealCategory,
  PlaceCandidate,
  RestaurantEntry,
} from './types';
import { ratingToBaseElo, recomputeMagicScores } from './lib/rankingEngine';
import { AddAndRateModal } from './components/AddAndRateModal';
import { PendingPlacement, SxSArenaModal } from './components/SxSArenaModal';
import { RestaurantList } from './components/RestaurantList';
import { SpotDetailModal } from './components/SpotDetailModal';

const LOCAL_STORAGE_KEY = 'palatelo_restaurants_v2';
const LOCAL_SETTINGS_KEY = 'palatelo_settings_v2';

const STARTER_SAMPLE_SPOTS: Omit<RestaurantEntry, 'rankIndex' | 'magicScore'>[] = [
  {
    id: 'ChIJBVY2Bxh-j4ARa2zO8Jd6H2A__Breakfast',
    placeId: 'ChIJBVY2Bxh-j4ARa2zO8Jd6H2A',
    name: 'Tartine Bakery',
    formattedAddress: '600 Guerrero St, San Francisco, CA',
    neighborhood: 'Mission',
    city: 'San Francisco',
    googleMapsUri: 'https://www.google.com/maps/search/?api=1&query=Tartine+Bakery+San+Francisco',
    priceLevel: 2,
    meal: 'Breakfast',
    meals: ['Breakfast', 'Coffee', 'Dessert'],
    cuisines: ['Bakery', 'French'],
    primaryTypeDisplay: 'Bakery',
    initialRating: 10,
    elo: 1920,
    comparisonsCount: 5,
    createdAt: Date.now() - 86400000 * 10,
    updatedAt: Date.now() - 86400000 * 10,
  },
  {
    id: 'sample_lilia__Dinner',
    placeId: 'sample_lilia',
    name: 'Lilia',
    formattedAddress: '567 Union Ave, Brooklyn, NY',
    neighborhood: 'Williamsburg',
    city: 'New York',
    googleMapsUri: 'https://www.google.com/maps/search/?api=1&query=Lilia+Brooklyn+NY',
    priceLevel: 3,
    meal: 'Dinner',
    meals: ['Dinner'],
    cuisines: ['Italian'],
    primaryTypeDisplay: 'Italian',
    initialRating: 9,
    elo: 1860,
    comparisonsCount: 5,
    createdAt: Date.now() - 86400000 * 8,
    updatedAt: Date.now() - 86400000 * 8,
  },
  {
    id: 'sample_nopa__Dinner',
    placeId: 'sample_nopa',
    name: 'Nopa',
    formattedAddress: '560 Divisadero St, San Francisco, CA',
    neighborhood: 'NoPa',
    city: 'San Francisco',
    googleMapsUri: 'https://www.google.com/maps/search/?api=1&query=Nopa+San+Francisco',
    priceLevel: 3,
    meal: 'Dinner',
    meals: ['Dinner', 'Breakfast', 'Drinks'],
    cuisines: ['American', 'Mediterranean'],
    primaryTypeDisplay: 'Californian',
    initialRating: 9,
    elo: 1790,
    comparisonsCount: 4,
    createdAt: Date.now() - 86400000 * 6,
    updatedAt: Date.now() - 86400000 * 6,
  },
  {
    id: 'sample_mensho__Dinner',
    placeId: 'sample_mensho',
    name: 'Mensho Tokyo SF',
    formattedAddress: '672 Geary St, San Francisco, CA',
    neighborhood: 'Tenderloin',
    city: 'San Francisco',
    googleMapsUri: 'https://www.google.com/maps/search/?api=1&query=Mensho+Tokyo+San+Francisco',
    priceLevel: 2,
    meal: 'Dinner',
    meals: ['Dinner'],
    cuisines: ['Japanese', 'Ramen'],
    primaryTypeDisplay: 'Ramen',
    initialRating: 8,
    elo: 1730,
    comparisonsCount: 4,
    createdAt: Date.now() - 86400000 * 4,
    updatedAt: Date.now() - 86400000 * 4,
  },
  {
    id: 'sample_farolito__Lunch',
    placeId: 'sample_farolito',
    name: 'El Farolito',
    formattedAddress: '2779 Mission St, San Francisco, CA',
    neighborhood: 'Mission',
    city: 'San Francisco',
    googleMapsUri: 'https://www.google.com/maps/search/?api=1&query=El+Farolito+Mission+St+San+Francisco',
    priceLevel: 1,
    meal: 'Lunch',
    meals: ['Lunch', 'Dinner'],
    cuisines: ['Mexican'],
    primaryTypeDisplay: 'Mexican',
    initialRating: 8,
    elo: 1670,
    comparisonsCount: 3,
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
];

function sanitizeLoadedRestaurant(raw: any): RestaurantEntry {
  const meal = normalizeMealCategory(raw.meal || raw.meals?.[0]);
  const normalizedMeals: MealCategory[] = Array.isArray(raw.meals) && raw.meals.length > 0
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

  const [defaultCity, setDefaultCity] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (raw) return JSON.parse(raw).defaultCity || '';
    } catch {
      // Ignore
    }
    return '';
  });

  // Filters
  const [selectedMeal, setSelectedMeal] = useState<MealCategory | 'ALL'>('ALL');
  const [selectedCuisine, setSelectedCuisine] = useState<string | 'ALL'>('ALL');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [reRankingEntry, setReRankingEntry] = useState<RestaurantEntry | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [isSxSOpen, setIsSxSOpen] = useState(false);
  const [activeDetailSpot, setActiveDetailSpot] = useState<RestaurantEntry | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
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

  // Called when Q1 (1-10 rating) and Q2 (single meal) are completed
  const handleCompleteQuestions = async (
    candidate: PlaceCandidate,
    initialRating: number,
    selectedMeal: MealCategory,
    existingIdToReplace?: string
  ) => {
    setIsAddModalOpen(false);
    setReRankingEntry(null);

    trackEvent('complete_initial_questions', {
      restaurant_name: candidate.name,
      meal: selectedMeal,
      initial_rating: initialRating,
      is_rerank: Boolean(existingIdToReplace),
    });

    const pool = restaurants.filter((r) => r.id !== existingIdToReplace);

    // If this is the very first restaurant in the list, save immediately without needing SxS
    if (pool.length === 0) {
      const now = Date.now();
      const existingObj = restaurants.find((r) => r.id === existingIdToReplace);
      const prevHistory = existingObj?.rankedHistory?.length
        ? existingObj.rankedHistory
        : existingObj
        ? [{ timestamp: existingObj.createdAt, initialRating: existingObj.initialRating }]
        : [];
      const entryId = existingIdToReplace || `${candidate.placeId}__${selectedMeal}`;
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
        meal: selectedMeal,
        meals: Array.from(new Set([selectedMeal, ...(candidate.meals || [])])),
        cuisines: candidate.cuisines,
        primaryTypeDisplay: candidate.primaryTypeDisplay,
        initialRating,
        elo: ratingToBaseElo(initialRating),
        rankIndex: 0,
        magicScore: initialRating,
        comparisonsCount: 0,
        rankedHistory: [...prevHistory, { timestamp: now, initialRating }],
        createdAt: existingObj?.createdAt || now,
        updatedAt: now,
      };
      await persistOrderedRestaurants([newEntry]);
      trackEvent('complete_ranking', {
        restaurant_name: candidate.name,
        meal: selectedMeal,
        initial_rating: initialRating,
        magic_score: initialRating,
        rank_position: 1,
        comparisons_count: 0,
        is_rerank: Boolean(existingIdToReplace),
      });
      showToast(`Added ${candidate.name} (#1)`);
      return;
    }

    // Otherwise launch Q3+ (SxS comparisons)
    setPendingPlacement({
      candidate,
      initialRating,
      meal: selectedMeal,
      cuisines: candidate.cuisines,
      existingIdToReplace,
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

  const handleLoadStarterSamples = async () => {
    const seeded: RestaurantEntry[] = STARTER_SAMPLE_SPOTS.map((s, idx) => ({
      ...s,
      rankIndex: idx,
      magicScore: s.initialRating,
    }));
    await persistOrderedRestaurants(seeded);
    showToast('Loaded sample places');
  };

  // Meal counts (based on primary `meal` of each entry)
  const mealCounts = useMemo(() => {
    const map = new Map<MealCategory, number>();
    for (const m of ALL_MEAL_CATEGORIES) map.set(m, 0);
    for (const r of restaurants) {
      map.set(r.meal, (map.get(r.meal) || 0) + 1);
    }
    return map;
  }, [restaurants]);

  // Cuisines available in the currently selected meal tab
  const cuisineCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of restaurants) {
      if (selectedMeal !== 'ALL' && r.meal !== selectedMeal) continue;
      for (const c of r.cuisines) {
        map.set(c, (map.get(c) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [restaurants, selectedMeal]);

  const filteredRestaurants = useMemo(() => {
    return restaurants.filter((r) => {
      if (selectedMeal !== 'ALL' && r.meal !== selectedMeal) return false;
      if (selectedCuisine !== 'ALL' && !r.cuisines.includes(selectedCuisine)) return false;
      if (listSearchQuery.trim()) {
        const q = listSearchQuery.toLowerCase();
        const hay = `${r.name} ${r.formattedAddress} ${r.cuisines.join(' ')} ${r.meal}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [restaurants, selectedMeal, selectedCuisine, listSearchQuery]);

  const isFiltered =
    selectedMeal !== 'ALL' || selectedCuisine !== 'ALL' || listSearchQuery.trim().length > 0;

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
    const blob = new Blob([JSON.stringify(restaurants, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jelly-rankings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-24 transition-colors duration-200">
      {/* Ultra-Minimal Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/80">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          {/* Clean Wordmark */}
          <div className="flex items-center gap-2">
            <span className="font-display font-extrabold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
              jelly
            </span>
            {restaurants.length > 0 && (
              <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 tabular-nums">
                {restaurants.length}
              </span>
            )}
          </div>

          {/* Minimal Controls */}
          <div className="flex items-center gap-1.5">
            {restaurants.length > 0 && (
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

            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              aria-label="Toggle dark mode"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-full text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            {!authLoading &&
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

            <button
              type="button"
              onClick={() => {
                trackEvent('open_add_modal');
                setReRankingEntry(null);
                setIsAddModalOpen(true);
              }}
              className="ml-0.5 sm:ml-1 px-3.5 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-zinc-950 text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 transition-all shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Feed */}
      <main className="max-w-xl mx-auto px-4 pt-4 space-y-3.5">
        {/* Expandable Search Input */}
        {isSearchExpanded && (
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={listSearchQuery}
              onChange={(e) => setListSearchQuery(e.target.value)}
              placeholder="Filter your ranked list..."
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

        {/* Clean Meal Tabs */}
        {restaurants.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
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

            {/* Subtle Secondary Cuisine Chips (Wrapped cleanly so no word is ever clipped) */}
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

        {/* Ranked Restaurant List */}
        <RestaurantList
          restaurants={filteredRestaurants}
          isFiltered={isFiltered}
          selectedMealFilter={selectedMeal}
          totalUnfilteredCount={restaurants.length}
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
            setIsAddModalOpen(true);
          }}
        />
      </main>

      {/* Add & Rate Wizard (Search -> Q1: 1-10 -> Q2: Meal) */}
      <AddAndRateModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setReRankingEntry(null);
        }}
        existingRestaurants={restaurants}
        reRankingEntry={reRankingEntry}
        defaultCity={defaultCity}
        onCompleteQuestions={handleCompleteQuestions}
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

                {restaurants.length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleLoadStarterSamples();
                      setIsSettingsOpen(false);
                    }}
                    className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-medium"
                  >
                    Load 5 Sample Spots
                  </button>
                )}
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
