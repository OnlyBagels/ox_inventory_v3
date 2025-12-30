<script lang="ts">
import TooltipField from '$lib/components/tooltip/TooltipField.svelte';
import { tooltip } from '$lib/state/tooltip.svelte.js';
import { cn } from '$lib/utils';
import { formatWeight } from '$lib/utils/formatWeight';
import { GetItemData, calculateItemWeight } from '@common/item';
</script>

<div
  class={cn(
    "fixed p-3 gap-3 hidden z-[55] pointer-events-none",
    "bg-black/95 rounded-lg border border-white/10 shadow-2xl",
    tooltip.visible && 'inline-flex flex-col'
  )}
  style={`top:${tooltip.y}px;left:${tooltip.x}px;`}
>
  <!-- Header -->
  <div class="flex items-center justify-between gap-3 pb-2 border-b border-white/10">
    <p class="font-semibold text-white/95 text-sm">{tooltip.item?.label}</p>
    <div class="px-2 py-0.5 bg-white/10 text-white/70 uppercase text-[10px] font-semibold rounded tracking-wide">
      {tooltip.item?.category}
    </div>
  </div>

  <!-- Content -->
  <div class='flex flex-col gap-3'>
    {#if tooltip.item?.description}
      <p class="text-white/60 text-xs leading-relaxed">{tooltip.item?.description}</p>
    {/if}

    <!-- Weight info (v2-style: includes ammo, components, metadata) -->
    {#if tooltip.item}
      {@const baseWeight = tooltip.item.weight ?? GetItemData(tooltip.item.name)?.properties?.weight ?? 0}
      {@const totalWeight = calculateItemWeight(tooltip.item)}
      {#if baseWeight || totalWeight}
        <div class="flex items-center gap-2 text-xs">
          <span class="text-white/50">Weight:</span>
          <span class="text-white/80 font-medium">{formatWeight(baseWeight)}</span>
          {#if tooltip.item.quantity > 1 || totalWeight !== baseWeight}
            <span class="text-white/50">({formatWeight(totalWeight)} total)</span>
          {/if}
        </div>
      {/if}
    {/if}

    <!-- Custom metadata fields -->
    {#if Object.keys(tooltip.displayMetadata).length > 0}
      <div class='flex flex-col gap-1.5 pt-1 border-t border-white/5'>
        {#each Object.entries(tooltip.displayMetadata) as [key, label]}
          <TooltipField {label} value={tooltip.item?.[key]} />
        {/each}
      </div>
    {/if}
  </div>
</div>
