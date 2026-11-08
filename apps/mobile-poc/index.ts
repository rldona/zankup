// Time origin for the startup measurement: the JS bundle starts running here.
(globalThis as { __bundleStart?: number }).__bundleStart = Date.now();

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
