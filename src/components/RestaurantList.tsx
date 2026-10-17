import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus } from 'lucide-react';
import { MealCategory, RestaurantEntry } from '../types';
import { formatDistanceMiles, getItemDistanceMiles, UserCoordinates } from '../lib/geo';
import { JellyBeanIcon } from './JellyBeanIcon';
import { ScoreBadge } from './ScoreBadge';

interface SortableRestaurantRowProps {
  restaurant: RestaurantEntry;
  displayPosition: number;
  isFiltered: boolean;
  sortByNearest?: boolean;
  readOnly?: boolean;
  selectedMealFilter: MealCategory | 'ALL';
  userLocation?: UserCoordinates | null;
  onSelectSpot: (restaurant: RestaurantEntry) => void;
}

const SortableRestaurantRow: React.FC<SortableRestaurantRowProps> = ({
  restaurant,
  displayPosition,
  isFiltered,
  sortByNearest = false,
  readOnly = false,
  selectedMealFilter,
  userLocation = null,
  onSelectSpot,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: restaurant.id,
    disabled: isFiltered || sortByNearest || readOnly,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : 1,
  };

  const rankNum =
    sortByNearest
      ? restaurant.rankIndex + 1
      : isFiltered
      ? displayPosition
      : restaurant.rankIndex + 1;

  const primaryCuisine = restaurant.cuisines[0] || restaurant.primaryTypeDisplay;
  const locationLabel =
    restaurant.neighborhood ||
    restaurant.city ||
    restaurant.formattedAddress.split(',')[1]?.trim() ||
    restaurant.formattedAddress.split(',')[0]?.trim();

  const rawMiles = getItemDistanceMiles(restaurant, userLocation);
  const distLabel =
    rawMiles !== null
      ? sortByNearest && rawMiles >= 100
        ? `${Math.round(rawMiles)} mi`
        : formatDistanceMiles(rawMiles)
      : null;

  const subtitleParts = [
    selectedMealFilter === 'ALL' ? restaurant.meal : null,
    primaryCuisine,
    locationLabel,
    distLabel,
  ].filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelectSpot(restaurant)}
      className={`group flex items-center justify-between gap-3 px-3.5 sm:px-4 py-3.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50/90 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer select-none ${
        isDragging
          ? 'shadow-xl ring-1 ring-emerald-500/50 rounded-2xl z-30 bg-white dark:bg-zinc-900'
          : ''
      }`}
    >
      {/* Left: Drag Handle + Rank Number + Name/Subtitle */}
      <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
        {!isFiltered && !sortByNearest && !readOnly && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="p-1 -ml-1.5 rounded-lg text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-grab active:cursor-grabbing touch-none transition-colors"
            title="Drag to reorder"
            aria-label={`Drag ${restaurant.name}`}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}

        <span
          className="w-6 text-right font-bold text-sm tabular-nums text-zinc-400 dark:text-zinc-500 shrink-0"
          title={sortByNearest ? `Overall Rank #${rankNum}` : undefined}
        >
          {sortByNearest ? `#${rankNum}` : rankNum}
        </span>

        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] sm:text-base text-zinc-900 dark:text-zinc-100 truncate leading-snug">
            {restaurant.name}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
            {subtitleParts.join(' · ')}
          </div>
        </div>
      </div>

      {/* Right: Clean Beli-style circular score badge */}
      <ScoreBadge score={restaurant.magicScore} size="md" />
    </div>
  );
};

interface RestaurantListProps {
  restaurants: RestaurantEntry[];
  isFiltered: boolean;
  sortByNearest?: boolean;
  readOnly?: boolean;
  selectedMealFilter: MealCategory | 'ALL';
  totalUnfilteredCount: number;
  userLocation?: UserCoordinates | null;
  onReorderDragEnd: (activeId: string, overId: string) => void;
  onSelectSpot: (restaurant: RestaurantEntry) => void;
  onOpenAddModal: () => void;
}

export const RestaurantList: React.FC<RestaurantListProps> = ({
  restaurants,
  isFiltered,
  sortByNearest = false,
  readOnly = false,
  selectedMealFilter,
  totalUnfilteredCount,
  userLocation = null,
  onReorderDragEnd,
  onSelectSpot,
  onOpenAddModal,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderDragEnd(String(active.id), String(over.id));
    }
  };

  if (restaurants.length === 0) {
    return (
      <div className="py-16 px-6 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 space-y-4">
        <div className="flex justify-center">
          <JellyBeanIcon size={36} />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {totalUnfilteredCount === 0
            ? 'No places ranked yet.'
            : 'No places match this filter.'}
        </p>
        {totalUnfilteredCount === 0 && !readOnly && (
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-zinc-900 dark:bg-emerald-500 text-white dark:text-zinc-950 text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            <span>Add your first place</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={restaurants.map((r) => r.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/90 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden shadow-2xs">
          {restaurants.map((restaurant, idx) => (
            <SortableRestaurantRow
              key={restaurant.id}
              restaurant={restaurant}
              displayPosition={idx + 1}
              isFiltered={isFiltered}
              sortByNearest={sortByNearest}
              readOnly={readOnly}
              selectedMealFilter={selectedMealFilter}
              userLocation={userLocation}
              onSelectSpot={onSelectSpot}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

