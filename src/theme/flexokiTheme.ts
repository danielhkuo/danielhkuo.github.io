/**
 * Flexoki Theme
 *
 * Steph Ango's Flexoki (https://stephango.com/flexoki) — an inky palette for
 * prose and code, ported to Astryx. Structure (typography, motion, radius,
 * shadow geometry, component overrides) is carried over from the Atom One
 * theme it replaces; every colour is Flexoki's. Each token is a [light, dark]
 * tuple that `astryx theme build` compiles into `light-dark()` pairs.
 *
 * Flexoki assigns the same roles in both modes, from two ends of one ramp:
 *                 light        dark
 *   bg            paper #FFFCF0 black  #100F0F
 *   bg-2          50    #F2F0E5 950    #1C1B1A
 *   ui            100   #E6E4D9 900    #282726
 *   ui-2          150   #DAD8CE 850    #343331
 *   ui-3          200   #CECDC3 800    #403E3C
 *   tx-3          300   #B7B5AC 700    #575653
 *   tx-2          600   #6F6E69 500    #878580
 *   tx            black #100F0F 200    #CECDC3
 * Accents are the 600 step in light and the 400 step in dark; text variants
 * go one step further (700 / 300) where the 600/400 would miss 4.5:1.
 */

import {defineTheme, defineSyntaxTheme} from '@astryxdesign/core/theme';
import {flexokiIconRegistry} from './icons';

/** Flexoki's own syntax mapping. */
const flexokiSyntax = defineSyntaxTheme({
  name: 'xds-flexoki',
  tokens: {
    keyword: ['#66800B', '#879A39'], // green
    string: ['#24837B', '#3AA99F'], // cyan
    comment: ['#B7B5AC', '#575653'], // tx-3
    number: ['#5E409D', '#8B7EC8'], // purple
    function: ['#BC5215', '#DA702C'], // orange
    type: ['#AD8301', '#D0A215'], // yellow
    variable: ['#205EA6', '#4385BE'], // blue
    operator: ['#6F6E69', '#878580'], // tx-2
    constant: ['#AD8301', '#D0A215'], // yellow
    tag: ['#205EA6', '#4385BE'], // blue
    attribute: ['#AD8301', '#D0A215'], // yellow
    property: ['#205EA6', '#4385BE'], // blue
    punctuation: ['#6F6E69', '#878580'], // tx-2
    background: ['#FFFCF0', '#100F0F'],
  },
});

export const flexokiTheme = defineTheme({
  name: 'flexoki',

  typography: {
    scale: {base: 14, ratio: 1.2},
    body: {
      family: 'Libron',
      fallbacks: 'Georgia, "Times New Roman", Times, serif',
    },
    heading: {
      family: 'TeX Gyre Adventor',
      fallbacks: '"Century Gothic", system-ui, sans-serif',
      // Only Adventor Bold ships (see src/app/fonts.ts).
      weight: 'bold',
    },
    code: {
      // macOS Terminal.app's own font — see --font-mono-family in globals.css.
      family: 'ui-monospace',
      fallbacks:
        '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace',
    },
  },

  motion: {fast: 125, medium: 300, slow: 700, ratio: 0.75},

  syntax: flexokiSyntax,

  tokens: {
    // =========================================================================
    // Colors — Flexoki light / dark
    // =========================================================================

    // Accent is Flexoki blue: 600 on paper (6.4:1). Dark uses 300, not the
    // canonical 400: the accent is link text on the bg-2 cards, where 400 only
    // reaches 4.4:1 (300: 6.1:1; black on it as a fill: 6.8:1).
    '--color-accent': ['#205EA6', '#66A0C8'],
    '--color-accent-muted': ['#205EA614', '#66A0C820'],
    '--color-neutral': ['#100F0F0F', '#CECDC31A'],
    // Page and cards are both bg; cards are drawn by their ui-2 border, the
    // way Flexoki itself separates panes. bg-2 is the recessed step.
    '--color-background-surface': ['#FFFCF0', '#1C1B1A'],
    '--color-background-body': ['#FFFCF0', '#100F0F'],
    '--color-overlay': ['#100F0F80', '#100F0FCC'],
    '--color-overlay-hover': ['#100F0F0D', '#CECDC30D'],
    '--color-overlay-pressed': ['#100F0F1A', '#CECDC31A'],
    '--color-background-muted': ['#F2F0E5', '#1C1B1A'],

    '--color-text-primary': ['#100F0F', '#CECDC3'], // tx
    '--color-text-secondary': ['#6F6E69', '#878580'], // tx-2
    '--color-text-disabled': ['#B7B5AC', '#575653'], // tx-3
    '--color-text-accent': ['#205EA6', '#66A0C8'],
    '--color-on-dark': '#FFFCF0',
    '--color-on-light': '#100F0F',
    '--color-on-accent': ['#FFFCF0', '#100F0F'],
    '--color-on-success': ['#FFFCF0', '#100F0F'],
    '--color-on-error': ['#FFFCF0', '#100F0F'],
    '--color-on-warning': ['#100F0F', '#100F0F'],

    // Icon
    '--color-icon-accent': ['#205EA6', '#66A0C8'],
    '--color-icon-primary': ['#100F0F', '#CECDC3'],
    '--color-icon-secondary': ['#6F6E69', '#878580'],
    '--color-icon-disabled': ['#B7B5AC', '#575653'],

    // Surface variants
    '--color-background-card': ['#FFFCF0', '#1C1B1A'],
    '--color-background-popover': ['#FFFCF0', '#1C1B1A'],
    '--color-background-inverted': ['#100F0F', '#CECDC3'],

    // Status / Sentiment — green / red / yellow
    '--color-success': ['#66800B', '#879A39'],
    '--color-success-muted': ['#66800B20', '#879A3920'],
    '--color-error': ['#AF3029', '#D14D41'],
    '--color-error-muted': ['#AF302920', '#D14D4120'],
    '--color-warning': ['#AD8301', '#D0A215'],
    '--color-warning-muted': ['#AD830120', '#D0A21520'],

    // Border — ui-2, and ui-3 when emphasised.
    '--color-border': ['#DAD8CE', '#343331'],
    '--color-border-emphasized': ['#CECDC3', '#403E3C'],

    // Effects
    '--color-skeleton': ['#E6E4D9', '#282726'],
    '--color-shadow': ['#100F0F1A', '#0000004D'],
    '--color-tint-hover': ['black', 'white'],

    // Categorical — Blue
    '--color-background-blue': ['#205EA633', '#4385BE33'],
    '--color-border-blue': ['#205EA6', '#4385BE'],
    '--color-icon-blue': ['#205EA6', '#4385BE'],
    '--color-text-blue': ['#1A4F8C', '#66A0C8'],

    // Categorical — Cyan
    '--color-background-cyan': ['#24837B33', '#3AA99F33'],
    '--color-border-cyan': ['#24837B', '#3AA99F'],
    '--color-icon-cyan': ['#24837B', '#3AA99F'],
    '--color-text-cyan': ['#1C6C66', '#5ABDAC'],

    // Categorical — Green
    '--color-background-green': ['#66800B33', '#879A3933'],
    '--color-border-green': ['#66800B', '#879A39'],
    '--color-icon-green': ['#66800B', '#879A39'],
    '--color-text-green': ['#536907', '#A0AF54'],

    // Categorical — Orange
    '--color-background-orange': ['#BC521533', '#DA702C33'],
    '--color-border-orange': ['#BC5215', '#DA702C'],
    '--color-icon-orange': ['#BC5215', '#DA702C'],
    '--color-text-orange': ['#9D4310', '#EC8B49'],

    // Categorical — Pink (Flexoki magenta)
    '--color-background-pink': ['#A02F6F33', '#CE5D9733'],
    '--color-border-pink': ['#A02F6F', '#CE5D97'],
    '--color-icon-pink': ['#A02F6F', '#CE5D97'],
    '--color-text-pink': ['#87285E', '#E47DA8'],

    // Categorical — Purple
    '--color-background-purple': ['#5E409D33', '#8B7EC833'],
    '--color-border-purple': ['#5E409D', '#8B7EC8'],
    '--color-icon-purple': ['#5E409D', '#8B7EC8'],
    '--color-text-purple': ['#4F3685', '#A699D0'],

    // Categorical — Red
    '--color-background-red': ['#AF302933', '#D14D4133'],
    '--color-border-red': ['#AF3029', '#D14D41'],
    '--color-icon-red': ['#AF3029', '#D14D41'],
    '--color-text-red': ['#942822', '#E8705F'],

    // Categorical — Teal (Flexoki has no teal; cyan)
    '--color-background-teal': ['#24837B33', '#3AA99F33'],
    '--color-border-teal': ['#24837B', '#3AA99F'],
    '--color-icon-teal': ['#24837B', '#3AA99F'],
    '--color-text-teal': ['#1C6C66', '#5ABDAC'],

    // Categorical — Yellow
    '--color-background-yellow': ['#AD830133', '#D0A21533'],
    '--color-border-yellow': ['#AD8301', '#D0A215'],
    '--color-icon-yellow': ['#AD8301', '#D0A215'],
    '--color-text-yellow': ['#8E6B01', '#DFB431'],

    // Categorical — Gray (tx-2 / tx-3)
    '--color-background-gray': ['#6F6E6933', '#87858033'],
    '--color-border-gray': ['#B7B5AC', '#575653'],
    '--color-icon-gray': ['#6F6E69', '#878580'],
    '--color-text-gray': ['#100F0F', '#CECDC3'],

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
    // Shadows — tinted with Flexoki black
    // =========================================================================
    '--shadow-low': '0 2px 4px #100F0F0D, 0 4px 8px #100F0F1A',
    '--shadow-med': '0 2px 4px #100F0F0D, 0 4px 12px #100F0F1A',
    '--shadow-high': '0 4px 6px #100F0F1A, 0 12px 24px #100F0F26',
    '--shadow-inset-hover': 'inset 0px 0px 0px 2px #205EA630',
    '--shadow-inset-selected': 'inset 0px 0px 0px 2px #205EA650',
    '--shadow-inset-success': 'inset 0px 0px 0px 2px #66800B50',
    '--shadow-inset-warning': 'inset 0px 0px 0px 2px #AD830150',
    '--shadow-inset-error': 'inset 0px 0px 0px 2px #AF302950',
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

  icons: flexokiIconRegistry,
});
