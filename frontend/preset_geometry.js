// A preset keeps every item's transform relative to the group's ground anchor so
// the whole group can be dropped anywhere. Positions are save-space centimetres;
// scene space uses the same centimetres with Y and Z swapped, matching the rest
// of the editor. Keeping both conversions here is what makes them testable.
export const NO_ANCHOR = Object.freeze({x: 0, y: 0, z: 0});

export function scenePositionToSave(position, anchor = NO_ANCHOR) {
  return {x: (position.x - anchor.x) * 100,
          y: (position.z - anchor.z) * 100,
          z: (position.y - anchor.y) * 100};
}

export function savePositionToScene(position, anchor = NO_ANCHOR) {
  return {x: position.x / 100 + anchor.x,
          y: position.z / 100 + anchor.y,
          z: position.y / 100 + anchor.z};
}

// The anchor sits at the bottom of the group so a preset lands on the surface
// the pointer is over rather than sinking in by half its height.
export function groundAnchor(bounds) {
  return {x: (bounds.min.x + bounds.max.x) / 2, y: bounds.min.y, z: (bounds.min.z + bounds.max.z) / 2};
}
