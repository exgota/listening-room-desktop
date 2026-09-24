# Vendored fonts

Latin subsets copied from npm (Fontsource, SIL Open Font License 1.1; licences beside each
file). `site/build.mjs` inlines them into `dist/page.html` as data URLs, so the page loads no
font from the network.

| File | npm package | Version | Used by |
| --- | --- | --- | --- |
| archivo-latin-standard-normal.woff2 | @fontsource-variable/archivo (wdth 62–125, wght 100–900) | 5.3.0 | Type |
| inter-tight-latin-wght-normal.woff2 | @fontsource-variable/inter-tight (wght 100–900) | 5.3.0 | Rig |
| jost-latin-wght-normal.woff2 | @fontsource-variable/jost (wght 100–900) | 5.3.0 | Pocket |
| instrument-serif-latin-400-normal.woff2, -italic | @fontsource/instrument-serif | 5.3.0 | Plate |
| ibm-plex-mono-latin-400-normal.woff2, -500 | @fontsource/ibm-plex-mono | 5.3.0 | Rig, Plate annotations |
