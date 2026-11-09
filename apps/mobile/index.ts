/**
 * Entry: the router, plus what Android may start without the UI: the background sync task
 * (OS-506) and the home-screen widget (OS-509) must be registered before anything renders.
 */
import 'expo-router/entry';

import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { defineBackgroundSync } from './src/background';
import { widgetTaskHandler } from './src/widget/handler';

defineBackgroundSync();
registerWidgetTaskHandler(widgetTaskHandler);
