import React from 'react';
import { Demo } from '../ui';
import { SpectrumExplorer } from './SpectrumExplorer';

export const SpectrumDemo: React.FC = () => (
  <Demo title="The gut-feeling spectrum" hint="Drag along the bar">
    <SpectrumExplorer />
  </Demo>
);
