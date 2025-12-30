<script lang="ts">
import type { ContextMenuButtonResponse } from '$lib/actions/openContextMenu';
import { contextMenu } from '$lib/state/context-menu.svelte.js';
import { fetchNui } from '$lib/utils/fetchNui';
import Icon from '@iconify/svelte';

interface ContextMenuButtonProps {
  buttonId: string;
  label: string;
  icon?: string;
  menu?: ContextMenuButtonResponse[];
}

const { icon, label, buttonId, menu }: ContextMenuButtonProps = $props();

let submenuVisible = $state(false);
let isMouseOverMenu = $state(false);
let parentRef: HTMLElement | null = $state(null);

function buttonClick(e: MouseEvent) {
  e.stopImmediatePropagation();

  fetchNui('contextMenuClick', { itemId: contextMenu.itemId, buttonId });

  contextMenu.close();
}

function onMouseEnterButton() {
  if (!menu) return;
  submenuVisible = true;
}

function onMouseLeaveButton() {
  if (!menu) return;

  if (isMouseOverMenu) {
    return;
  }

  submenuVisible = false;
}

function onMouseEnterMenu() {
  if (!menu) return;

  isMouseOverMenu = true;
}

function onMouseLeaveMenu() {
  if (!menu) return;

  isMouseOverMenu = false;
  submenuVisible = false;
}
</script>

<div class="relative" bind:this={parentRef}>
  <button
    class="px-3 py-2 w-full flex gap-2.5 text-xs items-center text-white/80 hover:text-white hover:bg-white/10 rounded-md transition-colors"
    onclick={buttonClick}
    onmouseenter={onMouseEnterButton}
    onmouseleave={onMouseLeaveButton}
  >
    {#if icon}
      <Icon {icon} width="16" height="16" class="text-white/60" />
    {/if}
    <span class="font-medium">{label}</span>

    {#if menu}
      <div class="ml-auto">
        <Icon icon="hugeicons:arrow-right-01" width="14" height="14" class="text-white/40" />
      </div>
    {/if}
  </button>
  {#if menu && submenuVisible}
    <div
      class="absolute -top-1.5 bg-black/90 backdrop-blur-sm p-1.5 min-w-[120px] w-fit shadow-2xl flex-col gap-0.5 z-[54] rounded-lg border border-white/10"
      style={`left: ${parentRef.clientWidth + 4}px`}
      onmouseenter={onMouseEnterMenu}
      onmouseleave={onMouseLeaveMenu}
    >
      {#each menu as menuBtn}
        <button
          class="px-3 py-2 flex gap-2.5 text-xs items-center text-white/80 hover:text-white hover:bg-white/10 w-full whitespace-nowrap rounded-md transition-colors"
          onclick={buttonClick}
        >
          {#if menuBtn.icon}
            <Icon icon={menuBtn.icon} width="16" height="16" class="text-white/60" />
          {/if}
          <span class="font-medium">{menuBtn.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
