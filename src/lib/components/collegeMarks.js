// Readers can compare up to three colleges. Each keeps one shape, in ink, in every chart, legend and table:
// the charts already use the categorical hues for school type and for the flow chart's highlights, so a
// shape (not a color) tells the colleges apart, which also holds up for color-blind readers.
import * as d3 from 'd3';

export const MAX_COLLEGES = 3;
export const COLLEGE_SYMBOLS = [d3.symbolDiamond, d3.symbolSquare, d3.symbolTriangle];
export const COLLEGE_SHAPE_NAMES = ['diamond', 'square', 'triangle'];
export const COLLEGE_GLYPHS = ['◆', '■', '▲']; // the same shapes as text, for tooltips

/** SVG path for college `i`'s shape, centered on 0,0, with the given area in px². */
export const collegePath = (i, area = 90) => d3.symbol(COLLEGE_SYMBOLS[i % COLLEGE_SYMBOLS.length], area)();
