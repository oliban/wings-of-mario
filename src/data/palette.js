// The NES 2C02 master palette. Art should draw hues from here (or close neighbours)
// so the whole game reads as one coherent console rather than unrelated sprite sets.
export const NES = [
  '#656565', '#002d69', '#131f7f', '#3c137c', '#600b62', '#730a37', '#710f07', '#5a1a00',
  '#342800', '#0b3400', '#003c00', '#003d10', '#003840', '#000000', '#000000', '#000000',
  '#aeaeae', '#0f63b3', '#4051d0', '#7841cc', '#a736a9', '#c03470', '#bd3c30', '#9f4a00',
  '#6d5c00', '#366d00', '#077704', '#00793d', '#00727d', '#000000', '#000000', '#000000',
  '#fefeff', '#5db3ff', '#8fa1ff', '#c890ff', '#f785fa', '#ff83c0', '#ff8b7f', '#ef9a49',
  '#bdac2c', '#85bc2f', '#55c753', '#3cc98c', '#3ec2cd', '#4e4e4e', '#000000', '#000000',
  '#ffffff', '#bcdfff', '#d1d8ff', '#e8d1ff', '#fbcdfe', '#ffcce5', '#ffcfca', '#f8d5ac',
  '#e4e594', '#cfef96', '#bdf4ab', '#b3f3cc', '#b5ebf2', '#b8b8b8', '#000000', '#000000',
];

export const nes = (i) => NES[i];

// Sky colors per theme, used by the renderer for the base clear.
export const SKY = {
  overworld: '#5c94fc',
  underground: '#000000',
  castle: '#000000',
  water: '#2038ec',
  athletic: '#5c94fc',
  // The original's night sky is not a dark blue: BackgroundColors selects $0f,
  // which is black, and 3-1, 3-2 and 3-3 all resolve to it. This was '#0d1b3e'
  // and unused by anything; matching the original is the point of the exercise.
  night: '#000000',
  // Harry's levels are painted on paper, so their sky is the paper. Kept dark
  // enough that the HUD's white text still reads against it.
  paper: '#9c9aa6',
};

// Shared ink colors so every art module outlines consistently.
export const INK = {
  outline: '#1a1008',
  outlineSoft: '#2b1d10',
  shadow: '#00000055',
  white: '#ffffff',
  black: '#000000',
};
