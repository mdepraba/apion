import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app is a fixed viewport with panes that scroll inside it: the page itself
 * must never grow a scrollbar. That held until a tall endpoint was selected,
 * when the whole page started scrolling instead of the detail pane.
 *
 * The cause is a CSS grid rule rather than anything React does. A `1fr` track
 * is `minmax(auto, 1fr)`, and an `auto` minimum refuses to shrink below the
 * content's min-content height, so a tall child pushes the grid past the height
 * its parent gave it. `min-height: 0` on the child does not help, because the
 * floor being hit belongs to the track.
 *
 * Every track in the chain from the shell down to the detail pane therefore has
 * to say `minmax(0, 1fr)`. These read the source rather than the rendered page
 * because jsdom performs no layout, so a rendering test here would pass whether
 * the rule was right or wrong.
 */

const ROUTES = join(import.meta.dirname);

function source(...segments: string[]): string {
  return readFileSync(join(ROUTES, ...segments), 'utf8');
}

/** Every `grid-rows-[...]` / `grid-cols-[...]` track list in a file. */
function trackLists(text: string): string[] {
  return [...text.matchAll(/grid-(?:rows|cols)-\[([^\]]+)\]/g)].map(
    (match) => match[1],
  );
}

describe('the scroll chain', () => {
  const files = {
    'the app shell': source('_app.tsx'),
    'the contract workspace': source(
      '_app',
      'projects',
      '$slug',
      'versions',
      '$versionId.tsx',
    ),
  };

  for (const [name, text] of Object.entries(files)) {
    it(`gives every flexible track in ${name} a zero minimum`, () => {
      const lists = trackLists(text);
      expect(lists.length).toBeGreaterThan(0);

      for (const list of lists) {
        // A bare `1fr` is the bug: it floors at the content's height.
        expect(list.split('_')).not.toContain('1fr');
      }
    });
  }

  it('keeps the shell exactly as tall as the viewport', () => {
    expect(files['the app shell']).toContain('grid h-full');
  });

  it('scrolls the main region rather than the document', () => {
    expect(files['the app shell']).toContain(
      '<main id="main" className="min-h-0 overflow-auto">',
    );
  });

  it('scrolls the endpoint pane rather than the page it sits in', () => {
    expect(files['the contract workspace']).toContain(
      'className="min-h-0 overflow-y-auto"',
    );
  });
});
