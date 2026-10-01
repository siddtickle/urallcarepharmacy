import { storeStatus } from '../lib/hours';

interface PublicReview {
  author: string;
  rating: number;
  text: string;
  date: string; // ISO
}
interface ReviewsPayload {
  rating: number;
  count: number;
  reviews: PublicReview[];
}

const $all = <T extends Element>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

function initMenu() {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-btn]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!btn || !menu) return;
  const set = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    menu.classList.toggle('is-open', open);
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
      set(false);
      btn.focus();
    }
  });
}

function renderStatus() {
  const s = storeStatus();
  for (const el of $all<HTMLElement>('[data-status]')) {
    el.dataset.open = String(s.open);
    el.querySelector('[data-status-label]')!.textContent = s.label;
    el.querySelector('[data-status-detail]')!.textContent = s.detail;
  }
}

function setStars(el: Element, rating: number) {
  (el as HTMLElement).style.setProperty('--pct', String((rating / 5) * 100));
  el.setAttribute('aria-label', `${rating} out of 5 stars`);
}

function starsMarkup(rating: number, size = 16) {
  const star = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`.repeat(5);
  return `<span class="stars" style="--pct:${(rating / 5) * 100}" role="img" aria-label="${rating} out of 5 stars"><span>${star}</span><span class="fill">${star}</span></span>`;
}

function reviewCard(r: PublicReview): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'review';
  const when = new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  fig.innerHTML = `${starsMarkup(r.rating)}<blockquote></blockquote><figcaption><strong></strong> · Google · ${when}</figcaption>`;
  fig.querySelector('blockquote')!.textContent = `“${r.text}”`;
  fig.querySelector('strong')!.textContent = r.author;
  return fig;
}

async function loadReviews(api: string) {
  const grid = document.querySelector<HTMLElement>('[data-review-grid]');
  try {
    const res = await fetch(`${api}/api/reviews`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as ReviewsPayload;
    if (data.count > 0) {
      for (const el of $all('[data-rating]')) el.textContent = data.rating.toFixed(1);
      for (const el of $all('[data-review-count]')) el.textContent = String(data.count);
      for (const el of $all('[data-stars]')) setStars(el, data.rating);
    }
    if (grid) {
      grid.replaceChildren(...data.reviews.slice(0, 4).map(reviewCard));
      if (!data.reviews.length) grid.remove();
    }
  } catch {
    // Keep the fallback rating; hide the empty review cards. The "Read all reviews" button still works.
    grid?.remove();
  }
}

function initContactForm(form: HTMLFormElement, api: string) {
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const show = (kind: 'ok' | 'err', msg: string) => {
    status.hidden = false;
    status.className = `form-status ${kind}`;
    status.textContent = msg;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!data.name?.trim() || !data.message?.trim()) return show('err', 'Please add your name and a message.');
    if (!data.email?.trim() && !data.phone?.trim()) return show('err', 'Please add an email address or phone number so we can reply.');
    if (data.contactPref === 'email' && !data.email?.trim()) return show('err', 'You chose email for our reply. Please add your email address.');
    if (data.email && !form.querySelector<HTMLInputElement>('#cf-email')!.checkValidity()) return show('err', 'That email address doesn’t look right.');

    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch(`${api}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, turnstileToken: data['cf-turnstile-response'] ?? '' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'send_failed');
      form.reset();
      show('ok', 'Thanks! Your message reached our team. We’ll reply soon. For anything urgent, please call 301-485-0000.');
    } catch (err) {
      const code = (err as Error).message;
      show(
        'err',
        code === 'rate_limited'
          ? 'You’ve sent several messages already. Please call us at 301-485-0000.'
          : code === 'verification_failed'
            ? 'We couldn’t verify the form. Please wait a moment and try again.'
            : 'Sorry, your message didn’t go through. Please try again or call 301-485-0000.',
      );
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send message';
      (window as unknown as { turnstile?: { reset: () => void } }).turnstile?.reset();
    }
  });
}

export function init() {
  initMenu();
  renderStatus();
  setInterval(renderStatus, 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && renderStatus());

  const form = document.querySelector<HTMLFormElement>('[data-contact-form]');
  const api = form?.dataset.api ?? '';
  if (form) initContactForm(form, api);
  loadReviews(api);
}
