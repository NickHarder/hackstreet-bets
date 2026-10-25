import React from 'react';
import { Composition } from 'remotion';
import { Promo, PROMO_FRAMES } from './Promo.jsx';

export const Root = () => (
  <Composition id="Promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={30} width={1080} height={1920} />
);
