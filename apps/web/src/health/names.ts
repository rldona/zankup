import type { HealthSourceName, MessageKey } from '@zankup/core';

import { t } from '../i18n';

export const sourceName = (source: HealthSourceName) => t(`health.source.${source}` as MessageKey);
