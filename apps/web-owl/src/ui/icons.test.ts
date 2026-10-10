import { describe, expect, it } from 'vitest';
import { ICONS, iconShapes } from './icons';

const DRAWABLE_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);

describe('iconShapes', () => {
  it('yields at least one shape for every registered icon', () => {
    for (const name of Object.keys(ICONS)) {
      expect(iconShapes(name).length, `icon "${name}" has no shapes`).toBeGreaterThan(0);
    }
  });

  it('only yields tags the Icon template knows how to draw', () => {
    for (const name of Object.keys(ICONS)) {
      for (const [tag] of iconShapes(name)) {
        expect(DRAWABLE_TAGS.has(tag), `icon "${name}" uses <${tag}>`).toBe(true);
      }
    }
  });

  it('gives every shape an attribute object', () => {
    for (const [, attrs] of iconShapes('map-pin')) {
      expect(typeof attrs).toBe('object');
    }
  });

  it('falls back to the package icon for an unknown name', () => {
    expect(iconShapes('definitely-not-an-icon')).toEqual(iconShapes('package'));
  });
});
