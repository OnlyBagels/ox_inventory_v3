<script lang="ts">
const { label, value } = $props<{ label: string; value: string | number }>();
</script>

{#if value !== undefined}
  <div class="flex items-center gap-2 text-xs">
    <span class="px-1.5 py-0.5 bg-white/10 text-white/60 uppercase text-[10px] font-semibold rounded">
      {label}
    </span>
    <span class="text-white/80">{value}</span>
  </div>
{/if}
