import type { BubblePlacement } from './pet-state.js';

type Bounds = { x: number; y: number; width: number; height: number };

/** All values are Electron DIP; do not apply the display scale factor again. */
export function bubbleLayout(pet: Bounds, area: Bounds): { bounds: Bounds; placement: BubblePlacement } {
  const width = Math.min(200, area.width);
  const height = Math.min(64, area.height);
  const preferredY = pet.y - height + 12;
  const placement = preferredY < area.y ? 'below' : 'above';
  return {
    placement,
    bounds: {
      x: Math.round(Math.min(Math.max(pet.x + (pet.width - width) / 2, area.x), area.x + area.width - width)),
      y: Math.round(Math.min(Math.max(placement === 'below' ? pet.y + pet.height - 12 : preferredY, area.y), area.y + area.height - height)),
      width,
      height,
    },
  };
}

export function bubbleBounds(pet: Bounds, area: Bounds) {
  return bubbleLayout(pet, area).bounds;
}
