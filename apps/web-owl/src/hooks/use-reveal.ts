import { onMounted, onWillUnmount } from '@odoo/owl';

/**
 * Slides each `.reveal` element inside `root` into view the first time it
 * scrolls on screen (see `.reveal` in globals.css). An element may set
 * `style="--reveal-delay: 120ms"` to stagger a row. Without
 * IntersectionObserver everything is shown at once. Call from `setup()`.
 */
export function useReveal(root: { el: HTMLElement | null }) {
  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    const targets = root.el?.querySelectorAll<HTMLElement>('.reveal') ?? [];
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of targets) el.classList.add('is-visible');
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    for (const el of targets) observer.observe(el);
  });

  onWillUnmount(() => {
    observer?.disconnect();
    observer = null;
  });
}
