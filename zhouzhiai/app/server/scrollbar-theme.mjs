import {readFileSync} from 'node:fs';

// The SPA imports this same file. Keeping it inside server/ also includes it in
// desktop packages, without relying on a source tree or an unauthenticated URL.
export const scrollbarTheme=readFileSync(new URL('./ui/scrollbars.css',import.meta.url),'utf8');
