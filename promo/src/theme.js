import { continueRender, delayRender, staticFile } from 'remotion';

export const C = {
  bg: '#070605',
  card: '#12110f',
  card2: '#1a1815',
  text: '#f5f1e8',
  text2: '#c9c2b2',
  muted: '#8c8577',
  gold: '#e9bd6a',
  goldDeep: '#a8742a',
  silver: '#d5d8dd',
  bronze: '#d5905b',
  up: '#22c781',
  down: '#ff6b6b',
  goldGrad: 'linear-gradient(180deg, #fbe7b5 0%, #e3b25c 48%, #a8742a 100%)',
  silverGrad: 'linear-gradient(180deg, #ffffff 0%, #d9dce1 50%, #8b9097 100%)',
};
export const DISPLAY = 'Anton, Impact, sans-serif';
export const LABEL = 'Oswald, "Arial Narrow", sans-serif';

// Load the same fonts the website uses before any frame renders.
let loaded = false;
export function loadFonts() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  const handle = delayRender('fonts');
  const faces = [
    new FontFace('Anton', `url(${staticFile('fonts/anton-400.woff2')})`, { weight: '400' }),
    new FontFace('Oswald', `url(${staticFile('fonts/oswald-500.woff2')})`, { weight: '500' }),
    new FontFace('Oswald', `url(${staticFile('fonts/oswald-600.woff2')})`, { weight: '600 700' }),
  ];
  Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))))
    .then(() => continueRender(handle))
    .catch((e) => { console.error(e); continueRender(handle); });
}

export const gradText = (grad) => ({ backgroundImage: grad, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' });
