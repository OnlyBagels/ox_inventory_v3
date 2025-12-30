<script lang="ts">
import { cn } from '$lib/utils';
import { SLOT_GAP, SLOT_SIZE } from '$lib/constants/inventory';

interface ItemImageProps {
  icon?: string;
  rotate?: boolean;
  width: number;
  height: number;
  dragImg?: HTMLElement;
}

const { width, height, rotate, icon, dragImg = $bindable() }: ItemImageProps = $props();
</script>

<div
  class={cn(
    'absolute pointer-events-none bg-no-repeat bg-center',
    rotate && 'origin-center'
  )}
  style={`
    background-image: url('${icon}');
    background-size: 65%;
    width: ${SLOT_SIZE * (rotate ? height : width) - 2}px;
    height: ${SLOT_SIZE * (rotate ? width : height) - 2}px;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(${rotate ? '-90deg' : '0deg'});
 `}
></div>
