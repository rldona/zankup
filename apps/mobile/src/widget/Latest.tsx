/**
 * The home-screen widget (OS-509): the latest activity and today's form, from a snapshot the app keeps
 * (so it draws instantly, even offline). Tapping it opens that activity.
 */
import { FlexWidget, TextWidget } from 'react-native-android-widget';

export type WidgetSnapshot = {
  activityId: number | null;
  title: string;
  subtitle: string;
  figures: string;
  formLabel: string;
  formValue: string;
  dark: boolean;
};

export const EMPTY: WidgetSnapshot = {
  activityId: null,
  title: 'Zankup',
  subtitle: '',
  figures: '',
  formLabel: '',
  formValue: '',
  dark: true,
};

export function LatestWidget({ snapshot: s }: { snapshot: WidgetSnapshot }) {
  const bg = s.dark ? '#111316' : '#ffffff';
  const fg = s.dark ? '#eef0f3' : '#16181d';
  const muted = s.dark ? '#9aa1ad' : '#646a75';
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: s.activityId ? `zankup://activity/${s.activityId}` : 'zankup://' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: bg,
        borderRadius: 20,
        padding: 14,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget text={s.title} maxLines={1} style={{ fontSize: 16, fontWeight: '700', color: fg }} />
        <TextWidget text={s.subtitle} maxLines={1} style={{ fontSize: 12, color: muted }} />
      </FlexWidget>
      <TextWidget text={s.figures} maxLines={1} style={{ fontSize: 15, fontWeight: '600', color: fg }} />
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent' }}>
        <TextWidget text={s.formLabel} style={{ fontSize: 12, color: muted }} />
        <TextWidget text={s.formValue} style={{ fontSize: 12, fontWeight: '700', color: '#20c997' }} />
      </FlexWidget>
    </FlexWidget>
  );
}
