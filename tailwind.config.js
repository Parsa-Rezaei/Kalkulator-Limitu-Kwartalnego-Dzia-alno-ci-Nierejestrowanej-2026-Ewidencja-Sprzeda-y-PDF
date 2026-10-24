/** @type {import('tailwindcss').Config} */
module.exports = {
  // Ścieżka nadpisywana przez scripts/build-css.mjs (skanuje index.html bez wbudowanego CSS).
  content: ['./index.html'],
  theme: { extend: {} },
  plugins: []
};
