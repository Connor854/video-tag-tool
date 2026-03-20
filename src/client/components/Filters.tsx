import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Filter, X, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import type { VideoFilters } from '../../shared/types';
import { trpc } from '../trpc';

// ── Types ──────────────────────────────────────────────────────────

type MultiSelectKey =
  | 'products'
  | 'colourways'
  | 'contentTags'
  | 'scenes'
  | 'lighting'
  | 'groupTypes'
  | 'shotTypes'
  | 'cameraMotions'
  | 'audioTypes';

type BooleanKey = 'hasLogo' | 'hasPackaging';

export interface FilterState {
  products: string[];
  colourways: string[];
  contentTags: string[];
  scenes: string[];
  lighting: string[];
  groupTypes: string[];
  shotTypes: string[];
  cameraMotions: string[];
  audioTypes: string[];
  hasLogo?: boolean;
  hasPackaging?: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  products: [],
  colourways: [],
  contentTags: [],
  scenes: [],
  lighting: [],
  groupTypes: [],
  shotTypes: [],
  cameraMotions: [],
  audioTypes: [],
};

interface FiltersProps {
  filters: VideoFilters;
  selected: FilterState;
  onChange: (next: FilterState) => void;
}

// ── Helpers ────────────────────────────────────────────────────────

function formatLabel(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function countActive(state: FilterState): number {
  let n = 0;
  for (const key of Object.keys(state) as (keyof FilterState)[]) {
    const v = state[key];
    if (Array.isArray(v)) n += v.length;
    else if (v === true) n += 1;
  }
  return n;
}

// ── Accordion Section ──────────────────────────────────────────────

function AccordionSection({
  title,
  children,
  count,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  count: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="border-b border-gray-200/60">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50/50 transition-colors cursor-pointer"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</span>
        <span className="flex items-center gap-1.5">
          {count > 0 && (
            <span className="w-4.5 h-4.5 flex items-center justify-center rounded-full text-[9px] font-bold bg-teal-600 text-white leading-none">
              {count}
            </span>
          )}
          {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
        </span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ── Multi-select checkbox list ─────────────────────────────────────

function CheckboxList({
  options,
  selected,
  onToggle,
  maxVisible = 8,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  maxVisible?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? options : options.slice(0, maxVisible);
  const hasMore = options.length > maxVisible;

  if (options.length === 0) {
    return <p className="text-xs text-gray-400 py-1">No options available</p>;
  }

  return (
    <div className="space-y-px">
      {visible.map((opt) => {
        const isSelected = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[13px] transition-colors cursor-pointer ${
              isSelected ? 'bg-teal-50 text-teal-800' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span
              className={`flex-shrink-0 w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                isSelected ? 'bg-teal-600 border-teal-600' : 'border-gray-300'
              }`}
            >
              {isSelected && <Check size={9} className="text-white" />}
            </span>
            <span className="truncate leading-tight">{formatLabel(opt)}</span>
          </button>
        );
      })}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[11px] text-teal-600 hover:text-teal-800 px-2 py-1 cursor-pointer"
        >
          {showAll ? 'Show less' : `+${options.length - maxVisible} more`}
        </button>
      )}
    </div>
  );
}

// ── Toggle switch for booleans ─────────────────────────────────────

function ToggleSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-[13px] transition-colors cursor-pointer ${
        value ? 'bg-teal-50 text-teal-800' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span>{label}</span>
      {value ? (
        <ToggleRight size={18} className="text-teal-600" />
      ) : (
        <ToggleLeft size={18} className="text-gray-300" />
      )}
    </button>
  );
}

// ── Active chips bar (rendered above the grid, not inside the rail) ─

export function ActiveFilterChips({
  selected,
  onChange,
}: {
  selected: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const chips: { key: MultiSelectKey | BooleanKey; value: string; label: string }[] = [];
  for (const key of ['products', 'colourways', 'contentTags', 'scenes', 'lighting', 'groupTypes', 'shotTypes', 'cameraMotions', 'audioTypes'] as MultiSelectKey[]) {
    for (const v of selected[key]) {
      chips.push({ key, value: v, label: formatLabel(v) });
    }
  }
  if (selected.hasLogo) chips.push({ key: 'hasLogo', value: 'true', label: 'Logo Visible' });
  if (selected.hasPackaging) chips.push({ key: 'hasPackaging', value: 'true', label: 'Packaging Visible' });

  if (chips.length === 0) return null;

  const removeChip = (chip: typeof chips[number]) => {
    if (chip.key === 'hasLogo' || chip.key === 'hasPackaging') {
      onChange({ ...selected, [chip.key]: undefined });
    } else if (chip.key === 'products') {
      const nextProducts = selected.products.filter((v) => v !== chip.value);
      onChange({ ...selected, products: nextProducts, colourways: nextProducts.length === 0 ? [] : selected.colourways });
    } else {
      const arr = selected[chip.key as MultiSelectKey];
      onChange({ ...selected, [chip.key]: arr.filter((v) => v !== chip.value) });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 bg-white border-b border-gray-100">
      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mr-1">Active:</span>
      {chips.map((chip) => (
        <span
          key={`${chip.key}-${chip.value}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200"
        >
          {chip.label}
          <button
            onClick={() => removeChip(chip)}
            className="hover:bg-teal-200 rounded-full p-0.5 cursor-pointer"
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <button
        onClick={() => onChange(EMPTY_FILTERS)}
        className="text-[11px] text-gray-400 hover:text-gray-600 ml-1 cursor-pointer"
      >
        Clear all
      </button>
    </div>
  );
}

// ── Main filter rail ───────────────────────────────────────────────

export default function Filters({ filters, selected, onChange }: FiltersProps) {
  const activeCount = countActive(selected);
  const prevProductsRef = useRef<string[]>(selected.products);

  // Fetch scoped colourways when product selection exists
  const colourwayQuery = trpc.video.colourwaysForProducts.useQuery(
    { products: selected.products },
    { enabled: selected.products.length > 0, staleTime: 30_000 },
  );
  const availableColourways = colourwayQuery.data ?? [];

  // Auto-clear colourways when product selection changes
  useEffect(() => {
    const prev = prevProductsRef.current;
    const curr = selected.products;
    prevProductsRef.current = curr;
    if (prev === curr) return;
    if (selected.colourways.length > 0 && curr.length === 0) {
      onChange({ ...selected, colourways: [] });
    }
  }, [selected.products]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prune colourways that are no longer valid after options refresh
  useEffect(() => {
    if (selected.colourways.length > 0 && availableColourways.length > 0) {
      const valid = selected.colourways.filter((c) => availableColourways.includes(c));
      if (valid.length !== selected.colourways.length) {
        onChange({ ...selected, colourways: valid });
      }
    }
  }, [availableColourways]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: MultiSelectKey, value: string) => {
    const current = selected[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    if (key === 'products' && next.length === 0) {
      onChange({ ...selected, products: next, colourways: [] });
      return;
    }
    onChange({ ...selected, [key]: next });
  };

  const toggleBool = (key: BooleanKey, value: boolean) => {
    onChange({ ...selected, [key]: value || undefined });
  };

  const hasProductSelected = selected.products.length > 0;

  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
      {/* Rail header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200">
        <div className="flex items-center gap-1.5">
          <Filter size={13} className="text-teal-600" />
          <span className="text-xs font-bold uppercase tracking-wider text-gray-700">Filters</span>
          {activeCount > 0 && (
            <span className="w-4.5 h-4.5 flex items-center justify-center rounded-full text-[9px] font-bold bg-teal-600 text-white leading-none">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            onClick={() => onChange(EMPTY_FILTERS)}
            className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            Reset
          </button>
        )}
      </div>

      {/* ── Product (with nested Colourway) ── */}
      <AccordionSection
        title="Product"
        count={selected.products.length + selected.colourways.length}
        defaultOpen
      >
        <CheckboxList
          options={filters.products}
          selected={selected.products}
          onToggle={(v) => toggle('products', v)}
          maxVisible={12}
        />

        {hasProductSelected && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-100">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-1.5">
              Colourway
              {selected.colourways.length > 0 && (
                <span className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-[8px] font-bold bg-teal-600 text-white leading-none">
                  {selected.colourways.length}
                </span>
              )}
            </p>
            {colourwayQuery.isLoading ? (
              <p className="text-[11px] text-gray-400 py-1">Loading...</p>
            ) : (
              <CheckboxList
                options={availableColourways}
                selected={selected.colourways}
                onToggle={(v) => toggle('colourways', v)}
                maxVisible={8}
              />
            )}
          </div>
        )}
      </AccordionSection>

      {/* ── Presentation / Structure ── */}
      <AccordionSection
        title="Presentation"
        count={selected.contentTags.length}
      >
        <CheckboxList
          options={filters.contentTags}
          selected={selected.contentTags}
          onToggle={(v) => toggle('contentTags', v)}
        />
      </AccordionSection>

      {/* ── Scene & Environment ── */}
      <AccordionSection
        title="Scene / Environment"
        count={selected.scenes.length + selected.lighting.length}
      >
        {filters.scenes.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Scene</p>
            <CheckboxList
              options={filters.scenes}
              selected={selected.scenes}
              onToggle={(v) => toggle('scenes', v)}
            />
          </>
        )}
        {filters.lightingTypes.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 mt-2.5">Lighting</p>
            <CheckboxList
              options={filters.lightingTypes}
              selected={selected.lighting}
              onToggle={(v) => toggle('lighting', v)}
            />
          </>
        )}
      </AccordionSection>

      {/* ── People & Talent ── */}
      <AccordionSection
        title="People / Talent"
        count={selected.groupTypes.length}
      >
        <CheckboxList
          options={filters.groupTypes}
          selected={selected.groupTypes}
          onToggle={(v) => toggle('groupTypes', v)}
        />
      </AccordionSection>

      {/* ── Camera & Shot ── */}
      <AccordionSection
        title="Camera / Shot"
        count={selected.shotTypes.length + selected.cameraMotions.length}
      >
        {filters.shotTypes.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Shot Type</p>
            <CheckboxList
              options={filters.shotTypes}
              selected={selected.shotTypes}
              onToggle={(v) => toggle('shotTypes', v)}
            />
          </>
        )}
        {filters.cameraMotions.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 mt-2.5">Camera Motion</p>
            <CheckboxList
              options={filters.cameraMotions}
              selected={selected.cameraMotions}
              onToggle={(v) => toggle('cameraMotions', v)}
            />
          </>
        )}
      </AccordionSection>

      {/* ── Audio ── */}
      <AccordionSection
        title="Audio"
        count={selected.audioTypes.length}
      >
        <CheckboxList
          options={filters.audioTypes}
          selected={selected.audioTypes}
          onToggle={(v) => toggle('audioTypes', v)}
        />
      </AccordionSection>

      {/* ── Brand Signals ── */}
      <AccordionSection
        title="Brand Signals"
        count={(selected.hasLogo ? 1 : 0) + (selected.hasPackaging ? 1 : 0)}
      >
        <div className="space-y-0.5">
          <ToggleSwitch
            label="Logo Visible"
            value={selected.hasLogo ?? false}
            onChange={(v) => toggleBool('hasLogo', v)}
          />
          <ToggleSwitch
            label="Packaging Visible"
            value={selected.hasPackaging ?? false}
            onChange={(v) => toggleBool('hasPackaging', v)}
          />
        </div>
      </AccordionSection>
    </aside>
  );
}
