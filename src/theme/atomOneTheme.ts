/**
 * Atom One Theme
 *
 * Atom's One Light / One Dark palettes, ported to Astryx. Scaffolded from the
 * Chocolate theme (`astryx theme add chocolate`) — typography, motion, radius,
 * shadows-geometry and component overrides are unchanged; every colour is
 * replaced. Each token is a [light, dark] tuple that `astryx theme build`
 * compiles into `light-dark()` pairs.
 *
 * One Light            One Dark
 *   bg      #fafafa      bg      #282c34
 *   mono-1  #383a42      mono-1  #abb2bf   (foreground)
 *   mono-2  #696c77      mono-2  #828997   (secondary)
 *   mono-3  #a0a1a7      mono-3  #5c6370   (comments / disabled)
 *   cyan    #0184bc      cyan    #56b6c2
 *   blue    #4078f2      blue    #61afef   ← accent
 *   purple  #a626a4      purple  #c678dd
 *   green   #50a14f      green   #98c379
 *   red 1   #e45649      red 1   #e06c75
 *   red 2   #ca1243      red 2   #be5046
 *   orange1 #986801      orange1 #d19a66
 *   orange2 #c18401      orange2 #e5c07b
 *
 * UI greys not defined by the syntax themes are derived along the same ramps
 * the Atom themes generate from — hsl(230, ~6%, L) for light, hsl(220, 13%, L)
 * for dark — so the chrome stays in-family with the editor colours.
 */

import {defineTheme, defineSyntaxTheme} from '@astryxdesign/core/theme';
import {atomOneIconRegistry} from './icons';

/** Atom One syntax palette — the canonical One Light / One Dark token colours. */
const atomOneSyntax = defineSyntaxTheme({
  name: 'xds-atom-one',
  tokens: {
    keyword: ['#a626a4', '#c678dd'], // purple
    string: ['#50a14f', '#98c379'], // green
    comment: ['#a0a1a7', '#5c6370'], // mono-3
    number: ['#986801', '#d19a66'], // orange 1
    function: ['#4078f2', '#61afef'], // blue
    type: ['#c18401', '#e5c07b'], // orange 2
    variable: ['#e45649', '#e06c75'], // red 1
    operator: ['#0184bc', '#56b6c2'], // cyan
    constant: ['#986801', '#d19a66'], // orange 1
    tag: ['#e45649', '#e06c75'], // red 1
    attribute: ['#986801', '#d19a66'], // orange 1
    property: ['#e45649', '#e06c75'], // red 1
    punctuation: ['#383a42', '#abb2bf'], // mono-1
    background: ['#fafafa', '#282c34'],
  },
});

export const atomOneTheme = defineTheme({
  name: 'atom-one',

  typography: {
    scale: {base: 14, ratio: 1.2},
    body: {
      family: 'IBM Plex Sans',
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: 'Sneaky Times',
      fallbacks: 'Georgia, "Times New Roman", Times, serif',
      // Sneaky Times has a single weight; the theme's default bold steps would
      // only trigger synthetic emboldening on a very high-contrast face.
      weights: {3: 'normal', 4: 'normal'},
    },
    code: {
      // macOS Terminal.app's own font — see --font-mono-family in globals.css.
      family: 'ui-monospace',
      fallbacks:
        '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace',
    },
  },

  motion: {fast: 125, medium: 300, slow: 700, ratio: 0.75},

  syntax: atomOneSyntax,

  tokens: {
    // =========================================================================
    // Colors — Atom One Light / Atom One Dark
    // =========================================================================

    // Core semantic. Accent is the One blue rather than the cursor blue
    // (#526fff / #528bff) — it is the hue people read as "Atom One" and it
    // holds contrast far better as link/label text. Light is deepened one step
    // from the canonical #4078f2, which only reaches ~4.05:1 behind the white
    // text of a filled button; #3768d8 clears 4.5:1 on body and surface alike.
    '--color-accent': ['#3768d8', '#61afef'],
    '--color-accent-muted': ['#3768d814', '#61afef20'],
    '--color-neutral': ['#383a420F', '#abb2bf1A'],
    // Body is the canonical editor background in each mode; surface sits one
    // step lighter so cards lift off the page.
    '--color-background-surface': ['#ffffff', '#2c313a'],
    '--color-background-body': ['#fafafa', '#282c34'],
    '--color-overlay': ['#383a4280', '#181a1fCC'],
    '--color-overlay-hover': ['#383a420D', '#abb2bf0D'],
    '--color-overlay-pressed': ['#383a421A', '#abb2bf1A'],
    '--color-background-muted': ['#f0f0f1', '#21252b'],

    // Text. Dark secondary is lifted off One's mono-2 (#828997): it carries
    // body prose here, and mono-2 only reaches 3.7:1 on the card surface.
    '--color-text-primary': ['#383a42', '#abb2bf'], // mono-1
    '--color-text-secondary': ['#696c77', '#939bab'],
    '--color-text-disabled': ['#a0a1a7', '#5c6370'], // mono-3
    '--color-text-accent': ['#3768d8', '#61afef'],
    '--color-on-dark': '#fafafa',
    '--color-on-light': '#383a42',
    '--color-on-accent': ['#ffffff', '#282c34'],
    '--color-on-success': ['#ffffff', '#282c34'],
    '--color-on-error': ['#ffffff', '#282c34'],
    '--color-on-warning': ['#383a42', '#282c34'],

    // Icon
    '--color-icon-accent': ['#3768d8', '#61afef'],
    '--color-icon-primary': ['#383a42', '#abb2bf'],
    '--color-icon-secondary': ['#696c77', '#939bab'],
    '--color-icon-disabled': ['#a0a1a7', '#5c6370'],

    // Surface variants
    '--color-background-card': ['#ffffff', '#2c313a'],
    '--color-background-popover': ['#ffffff', '#2c313a'],
    '--color-background-inverted': ['#383a42', '#abb2bf'],

    // Status / Sentiment — green / red 1 / orange 2
    '--color-success': ['#50a14f', '#98c379'],
    '--color-success-muted': ['#50a14f20', '#98c37920'],
    '--color-error': ['#e45649', '#e06c75'],
    '--color-error-muted': ['#e4564920', '#e06c7520'],
    '--color-warning': ['#c18401', '#e5c07b'],
    '--color-warning-muted': ['#c1840120', '#e5c07b20'],

    // Border. Dark uses One Dark's selection grey (#3e4451) so dividers read
    // lighter than the surface, as they do in the editor's own chrome.
    '--color-border': ['#d4d5d9', '#3e4451'],
    '--color-border-emphasized': ['#b9bac0', '#4b5263'],

    // Effects
    '--color-skeleton': ['#dcdde1', '#3e4451'],
    '--color-shadow': ['#383a421A', '#0000004D'],
    '--color-tint-hover': ['black', 'white'],

    // Categorical — Blue
    '--color-background-blue': ['#4078f233', '#61afef33'],
    '--color-border-blue': ['#4078f2', '#61afef'],
    '--color-icon-blue': ['#4078f2', '#61afef'],
    '--color-text-blue': ['#2f63d9', '#7cbef2'],

    // Categorical — Cyan
    '--color-background-cyan': ['#0184bc33', '#56b6c233'],
    '--color-border-cyan': ['#0184bc', '#56b6c2'],
    '--color-icon-cyan': ['#0184bc', '#56b6c2'],
    '--color-text-cyan': ['#016a98', '#72c4ce'],

    // Categorical — Gray (mono-2 / mono-3)
    '--color-background-gray': ['#696c7733', '#82899733'],
    '--color-border-gray': ['#a0a1a7', '#5c6370'],
    '--color-icon-gray': ['#696c77', '#828997'],
    '--color-text-gray': ['#383a42', '#abb2bf'],

    // Categorical — Green
    '--color-background-green': ['#50a14f33', '#98c37933'],
    '--color-border-green': ['#50a14f', '#98c379'],
    '--color-icon-green': ['#50a14f', '#98c379'],
    '--color-text-green': ['#40813f', '#a9cf8f'],

    // Categorical — Orange (orange 1)
    '--color-background-orange': ['#98680133', '#d19a6633'],
    '--color-border-orange': ['#986801', '#d19a66'],
    '--color-icon-orange': ['#986801', '#d19a66'],
    '--color-text-orange': ['#7a5301', '#dcae82'],

    // Categorical — Pink. One has no pink; blended from red 2 toward purple.
    '--color-background-pink': ['#ca124333', '#d17a9a33'],
    '--color-border-pink': ['#ca1243', '#d17a9a'],
    '--color-icon-pink': ['#ca1243', '#d17a9a'],
    '--color-text-pink': ['#a30e36', '#dc95ae'],

    // Categorical — Purple
    '--color-background-purple': ['#a626a433', '#c678dd33'],
    '--color-border-purple': ['#a626a4', '#c678dd'],
    '--color-icon-purple': ['#a626a4', '#c678dd'],
    '--color-text-purple': ['#851e83', '#d194e5'],

    // Categorical — Red (red 1)
    '--color-background-red': ['#e4564933', '#e06c7533'],
    '--color-border-red': ['#e45649', '#e06c75'],
    '--color-icon-red': ['#e45649', '#e06c75'],
    '--color-text-red': ['#ca1243', '#e88b92'],

    // Categorical — Teal. One has no teal; blended from cyan toward green.
    '--color-background-teal': ['#128a8a33', '#57bfb033'],
    '--color-border-teal': ['#128a8a', '#57bfb0'],
    '--color-icon-teal': ['#128a8a', '#57bfb0'],
    '--color-text-teal': ['#0e6e6e', '#75cdc1'],

    // Categorical — Yellow (orange 2)
    '--color-background-yellow': ['#c1840133', '#e5c07b33'],
    '--color-border-yellow': ['#c18401', '#e5c07b'],
    '--color-icon-yellow': ['#c18401', '#e5c07b'],
    '--color-text-yellow': ['#9a6a01', '#ecce9a'],

    // =========================================================================
    // Radius — square, Carbon-style. Every step is 0 rather than the scale
    // being removed, so component call sites keep working and softening the
    // whole system later is an edit in one place.
    // =========================================================================
    '--radius-none': '0',
    '--radius-inner': '0',
    '--radius-element': '0',
    '--radius-container': '0',
    '--radius-page': '0',
    '--radius-full': '0',

    // =========================================================================
    // Shadows — cool-toned, tinted with One Light's mono-1 / One Dark's #181a1f
    // =========================================================================
    '--shadow-low': '0 2px 4px #383a420D, 0 4px 8px #383a421A',
    '--shadow-med': '0 2px 4px #383a420D, 0 4px 12px #383a421A',
    '--shadow-high': '0 4px 6px #383a421A, 0 12px 24px #383a4226',
    '--shadow-inset-hover': 'inset 0px 0px 0px 2px #4078f230',
    '--shadow-inset-selected': 'inset 0px 0px 0px 2px #4078f250',
    '--shadow-inset-success': 'inset 0px 0px 0px 2px #50a14f50',
    '--shadow-inset-warning': 'inset 0px 0px 0px 2px #c1840150',
    '--shadow-inset-error': 'inset 0px 0px 0px 2px #e4564950',
  },

  components: {
    button: {
      base: {
        // Was pill-shaped; square now like the rest of the system.
        borderRadius: '0',
      },
      'variant:secondary': {
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'var(--color-border-emphasized)',
      },
    },

    card: {
      base: {
        padding: 'var(--spacing-3)',
      },
    },

    section: {
      base: {
        padding: 'var(--spacing-3)',
      },
    },
  },

  icons: atomOneIconRegistry,
});
