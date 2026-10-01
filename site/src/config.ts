// Store facts used across the site. Edit here, not in the page markup.
export const store = {
  name: 'AllCare Pharmacy, Orthopedic and Medical Supplies',
  shortName: 'AllCare Pharmacy',
  street: '6341 Livingston Road',
  city: 'Oxon Hill',
  region: 'MD',
  postalCode: '20745',
  phone: '301-485-0000',
  phoneHref: 'tel:+13014850000',
  fax: '301-485-1259',
  email: 'urallcarepharmacy@gmail.com',
  facebook: 'https://www.facebook.com/UrAllCarePharmacy/',
  // Google Maps listing for "AllCare Pharmacy & Medical Supplies"
  mapsUrl: 'https://maps.google.com/?cid=11211760498866517960',
  mapEmbed:
    'https://www.google.com/maps?q=AllCare+Pharmacy+%26+Medical+Supplies,+6341+Livingston+Rd,+Oxon+Hill,+MD+20745&output=embed',
  // Replace with the "Ask for reviews" link from the Google Business Profile when you have it.
  writeReviewUrl: 'https://maps.google.com/?cid=11211760498866517960',
  lat: 38.802347,
  lng: -76.988253,
  // Shown until the live numbers load from Google.
  fallbackRating: 4.6,
  fallbackReviewCount: 97,
};

// Where the backend (Cloudflare Worker) lives. Set PUBLIC_API_BASE at build time.
export const apiBase: string = import.meta.env.PUBLIC_API_BASE ?? 'https://api.urallcarepharmacy.com';
export const turnstileSiteKey: string = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA';
