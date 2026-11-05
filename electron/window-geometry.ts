type Bounds = { x: number; y: number; width: number; height: number };

/** All values are Electron DIP; do not apply the display scale factor again. */
export function bubbleBounds(pet: Bounds, area: Bounds) {
  const width = Math.min(200, area.width);
  const height = Math.min(64, area.height);
  const preferredY = pet.y - height + 12;
  return {
    x: Math.round(Math.min(Math.max(pet.x + (pet.width - width) / 2, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(preferredY < area.y ? pet.y + pet.height - 12 : preferredY, area.y), area.y + area.height - height)),
    width,
    height,
  };
}
