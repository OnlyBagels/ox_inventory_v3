<script lang="ts">
interface DurabilityCircleProps {
  durability?: number;
}

const { durability }: DurabilityCircleProps = $props();

// Calculate color based on durability percentage
const getColor = (d: number) => {
  if (d > 60) return '#22c55e'; // green
  if (d > 30) return '#eab308'; // yellow
  return '#ef4444'; // red
};
</script>

{#if durability !== undefined && durability > 0}
  <svg class="w-4 h-4 -rotate-90" viewBox="0 0 36 36">
    <!-- Background circle -->
    <circle
      stroke="rgba(255,255,255,0.15)"
      stroke-width="5"
      fill="none"
      r="14"
      cx="18"
      cy="18"
    />
    <!-- Progress circle -->
    <circle
      stroke={getColor(durability)}
      stroke-width="5"
      stroke-dasharray={`${(durability / 100) * (2 * Math.PI * 14)}, ${2 * Math.PI * 14}`}
      stroke-linecap="round"
      fill="none"
      r="14"
      cx="18"
      cy="18"
    />
  </svg>
{/if}
